/**
 * AI 평가 신뢰도 판정 백필/재판정 (배치관리 ②).
 *
 *   qa_call_item_score(점수+근거) ──(Gemini 판정)──▶ qa_call_annotation(항목별 플래그)
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
import { stampByQaIds } from './manualReview.mjs';

const { Pool } = pg;

/**
 * 신뢰도 판정 백필/재판정 — CLI(main)와 API(POST /api/batch/rejudge) 공용.
 * 현재 프롬프트 버전으로 아직 판정 안 된 콜만 처리(멱등). 프롬프트 편집 시 version 증가 →
 * 기존 판정이 stale 되어 자동으로 재판정 대상이 된다.
 *
 * @param {import('pg').Pool} pool  외부에서 주입(API 는 자기 pool 재사용, CLI 는 새로 생성).
 * @param {{limit?:number, orgId?:number, onProgress?:(p:{done:number,total:number})=>void}} opts
 * @returns {Promise<{total:number, done:number, failed:number, flagged:number, stamped:number, version:number, model:string}>}
 */
export async function runJudgeBackfill(pool, { limit = 500, orgId = '__default__', onProgress } = {}) {
    if (!judgeEnabled()) throw new Error('GEMINI_API_KEY 미설정 — 판정 불가');
    const model = judgeModel();
    // v1: 전체/기본('__default__') 프롬프트로 판정. (브랜드별 프롬프트는 후속 — orgId 인자화.)
    const { systemPrompt, version } = await resolvePrompt(pool, orgId);

    // 통합DB: 내부 id = common.calls.call_id(bigint). is_sandbox=qa_evaluations, 항목=eval_item_score, 판정=eval_annotation(call_id).
    const { rows: targets } = await pool.query(
        `SELECT c.call_id AS id
           FROM common.calls c
           JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
          WHERE e.is_sandbox = false
            AND EXISTS (SELECT 1 FROM eval_item_score er WHERE er.call_id = c.call_id)
            AND NOT EXISTS (
                SELECT 1 FROM eval_annotation j
                 WHERE j.call_id = c.call_id AND j.prompt_version = $1)
          ORDER BY c.cdate DESC
          LIMIT $2`,
        [version, limit]
    );
    logger.info(`[judge-bf] 대상 콜 ${targets.length}건 (model=${model}, prompt_v=${version})`);
    if (!targets.length) return { total: 0, done: 0, failed: 0, flagged: 0, stamped: 0, version, model };

    let done = 0, failed = 0, flagged = 0;
    const judgedIds = [];
    for (const t of targets) {
        const { rows: items } = await pool.query(
            `SELECT er.order_no, er.item, er.ai_eval AS score, er.reason_text,
                    er.max_score::int AS max
               FROM eval_item_score er
              WHERE er.call_id = $1
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
                // 병합 테이블(마이그레이션 71) — 배치는 판정 컬럼만 SET.
                // comments(사람이 남긴 코멘트)는 EXCLUDED 에 없으므로 절대 덮이지 않는다.
                `INSERT INTO eval_annotation
                     (call_id, judgments, has_uncertain, has_weak, has_contradiction, prompt_version, model, judged_at)
                 VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, now())
                 ON CONFLICT (call_id) DO UPDATE SET
                     judgments = EXCLUDED.judgments, has_uncertain = EXCLUDED.has_uncertain,
                     has_weak = EXCLUDED.has_weak, has_contradiction = EXCLUDED.has_contradiction,
                     prompt_version = EXCLUDED.prompt_version, model = EXCLUDED.model, judged_at = now()`,
                [t.id, JSON.stringify(judged), hasU, hasW, hasC, version, model]
            );
            done += 1;
            judgedIds.push(t.id);
            if (done % 10 === 0) logger.info(`[judge-bf] ${done}/${targets.length} …`);
            onProgress?.({ done, total: targets.length });
        } catch (e) {
            failed += 1;
            logger.warn(`[judge-bf] ${t.id} 판정 실패: ${e?.message || e}`);
        }
    }
    logger.info(`[judge-bf] 완료 — 판정 ${done}, 실패 ${failed}, 신뢰도이슈 ${flagged}건`);

    // 판정 결과를 수기평가 대상 도장에 반영(신뢰도 사유 갱신).
    let stamped = 0;
    try {
        stamped = await stampByQaIds(pool, judgedIds);
        logger.info(`[judge-bf] 수기평가 대상 도장 갱신 — ${stamped}건`);
    } catch (e) { logger.warn(`[judge-bf] 도장 갱신 실패: ${e?.message || e}`); }

    return { total: targets.length, done, failed, flagged, stamped, version, model };
}

// CLI 진입점: docker exec ... node /app/server/judgeConfidence.mjs [limit]
async function main() {
    if (!judgeEnabled()) {
        console.error('[judge-bf] GEMINI_API_KEY 미설정 — 판정 불가. 중단.');
        process.exit(1);
    }
    const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 500;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=trustguard,common,public' });
    try {
        const r = await runJudgeBackfill(pool, { limit });
        console.log(`[judge-bf] 완료 — 판정 ${r.done}, 실패 ${r.failed}, 신뢰도이슈 ${r.flagged}, 도장 ${r.stamped}건`);
    } finally {
        await pool.end();
    }
}

// 직접 실행(CLI)일 때만 main(). import 되면 실행하지 않음.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => { console.error('[judge-bf] 실패:', e); process.exit(1); });
}
