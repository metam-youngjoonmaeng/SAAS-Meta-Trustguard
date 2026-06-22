/**
 * AI 평가 신뢰도 판정 백필/재판정 (배치관리 ②).
 *
 *   qa_evaluation_rows(점수+근거) ──(Gemini 판정)──▶ qa_confidence_judgments(항목별 플래그)
 *
 * precompute: 콜당 1회 판정해 저장 → 배치 미리보기/선별은 저장값만 필터(빠름).
 * 멱등: 아직 판정 안 됐거나(prompt_version 불일치) 한 콜만 처리. 재판정 = 프롬프트 version 증가 후 재실행.
 * GEMINI_API_KEY + DATABASE_URL 필요.
 *
 * 실행:  docker exec 09-meta-trustguard-api node /app/server/judgeConfidence.mjs [limit]
 */
import pg from 'pg';
import { logger } from './logger.mjs';
import { judgeEnabled, judgeModel, resolvePrompt, judgeReasons } from './geminiJudge.mjs';

const { Pool } = pg;

async function main() {
    if (!judgeEnabled()) {
        console.error('[judge-bf] GEMINI_API_KEY 미설정 — 판정 불가. 중단.');
        process.exit(1);
    }
    const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 500;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const model = judgeModel();
    // v1: 전체/기본(org 0) 프롬프트로 판정. (브랜드별 프롬프트는 후속 — orgId 인자화.)
    const { systemPrompt, version } = await resolvePrompt(pool, 0);

    // 판정 대상: 평가행이 있고(non-sandbox), 현재 프롬프트 버전으로 아직 판정 안 된 콜.
    const { rows: targets } = await pool.query(
        `SELECT c."ID" AS id
           FROM qa_calls c
          WHERE c.is_sandbox = false
            AND EXISTS (SELECT 1 FROM qa_evaluation_rows er WHERE er."ID" = c."ID")
            AND NOT EXISTS (
                SELECT 1 FROM qa_confidence_judgments j
                 WHERE j.qa_id = c."ID" AND j.prompt_version = $1)
          ORDER BY c."CDATE" DESC
          LIMIT $2`,
        [version, limit]
    );
    console.log(`[judge-bf] 대상 콜 ${targets.length}건 (model=${model}, prompt_v=${version})`);
    if (!targets.length) { await pool.end(); return; }

    let done = 0, failed = 0, flagged = 0;
    for (const t of targets) {
        const { rows: items } = await pool.query(
            `SELECT er.order_no, er.item, er.ai_eval AS score, er.reason_text,
                    NULLIF(regexp_replace(coalesce(cl.validation_time,''), '[^0-9]', '', 'g'), '')::int AS max
               FROM qa_evaluation_rows er
               LEFT JOIN qa_checklist_rows cl ON cl."ID" = er."ID" AND cl.order_no = er.order_no
              WHERE er."ID" = $1
              ORDER BY er.order_no`,
            [t.id]
        );
        if (!items.length) continue;
        try {
            const judged = await judgeReasons(items, { systemPrompt });
            const hasU = judged.some((j) => j.uncertain);
            const hasW = judged.some((j) => j.weak);
            const hasC = judged.some((j) => j.contradiction);
            if (hasU || hasW || hasC) flagged += 1;
            await pool.query(
                `INSERT INTO qa_confidence_judgments
                     (qa_id, judgments, has_uncertain, has_weak, has_contradiction, prompt_version, model, judged_at)
                 VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, now())
                 ON CONFLICT (qa_id) DO UPDATE SET
                     judgments = EXCLUDED.judgments, has_uncertain = EXCLUDED.has_uncertain,
                     has_weak = EXCLUDED.has_weak, has_contradiction = EXCLUDED.has_contradiction,
                     prompt_version = EXCLUDED.prompt_version, model = EXCLUDED.model, judged_at = now()`,
                [t.id, JSON.stringify(judged), hasU, hasW, hasC, version, model]
            );
            done += 1;
            if (done % 10 === 0) console.log(`[judge-bf] ${done}/${targets.length} …`);
        } catch (e) {
            failed += 1;
            logger.warn(`[judge-bf] ${t.id} 판정 실패: ${e?.message || e}`);
        }
    }
    console.log(`[judge-bf] 완료 — 판정 ${done}, 실패 ${failed}, 신뢰도이슈 ${flagged}건`);
    await pool.end();
}

main().catch((e) => { console.error('[judge-bf] 실패:', e); process.exit(1); });
