/**
 * 사람 수기평가 대상 '도장' — AI 평가된 콜 중 배치 카드 조건에 맞는 것에 manual_review 표식.
 *
 * preview(/api/batch/preview) 선별 로직과 동일 기준을 UPDATE 로 적용한다.
 *   - 통화시간 범위(공통 scope) 안 + 조건(저품질 평균점수 미달 / 신뢰도 불확실·모순 / 고점) 매칭 → 도장
 *   - 사유는 카드·세부규칙 수준 한글 라벨(상세 배지용): "저품질 검증 · 평균점수 미달" 등
 *   - 누적: 한 번 찍히면 유지(manual_review_at 은 최초 시각), 재실행은 사유만 갱신, 해제 안 함
 *   - qaIds 주면 그 콜들만 재계산(실시간/판정직후), 없으면 in-scope 전체
 * 무작위 표본(편향)·필수항목·근속·리스크는 v1 도장 대상 아님(데이터/정의 대기).
 */
import { logger } from './logger.mjs';

const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

/** 브랜드 배치 설정(qa_batch_configs) — org 우선, 없으면 0(전체/기본). 없으면 null. */
export async function readBatchConfig(pool, orgId) {
    const { rows } = await pool.query(
        `SELECT config FROM public.qa_batch_configs
          WHERE org_id = ANY($1) ORDER BY (org_id = $2) DESC LIMIT 1`,
        [[orgId, 0], orgId]
    );
    return rows[0]?.config || null;
}

/**
 * 카드 조건에 맞는 콜에 manual_review 도장 + 사유. 매칭 콜 수 반환.
 * @param {object} pool pg pool
 * @param {number} orgId 브랜드 org_id
 * @param {{qaIds?: string[]}} opts qaIds 지정 시 그 콜들만 재계산
 */
export async function applyManualReviewStamps(pool, orgId, { qaIds = null } = {}) {
    const cfg = await readBatchConfig(pool, orgId);
    if (!cfg) return 0;
    const on = cfg.on || {}, q = cfg.quality || {}, bias = cfg.bias || {}, conf = cfg.confidence || {}, scope = cfg.scope || {};

    const minSec = Math.max(0, Math.round(num(scope.minMin, 0) * 60));
    const maxMinV = num(scope.maxMin, 0);
    const maxSec = maxMinV > 0 && maxMinV * 60 > minSec ? Math.round(maxMinV * 60) : 2147483647;

    const qOn = !!(on.quality && q.avgBelow);
    const qRel = q.avgMode === 'rel';
    const qRelPts = num(q.avgRel, 0);
    const qAbs = num(q.avgAbs, 0);
    const bHighOn = !!(on.bias && bias.highScore);
    const bHigh = num(bias.highThreshold, 101);
    const uncOn = !!(on.confidence && conf.uncertain);
    const conOn = !!(on.confidence && conf.contradiction);
    const excluded = Array.isArray(conf.excluded) ? conf.excluded.map(Number).filter(Number.isInteger) : [];

    if (!qOn && !bHighOn && !uncOn && !conOn) return 0; // 활성(지원) 조건 없음

    const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, uncOn, conOn, excluded];
    let orgClause = '';
    if (orgId !== 0) { params.push(orgId); orgClause = `AND c.org_id = $${params.length}`; }
    let idClause = '';
    if (Array.isArray(qaIds) && qaIds.length) { params.push(qaIds); idClause = `AND c."ID" = ANY($${params.length})`; }

    const sql = `
      WITH agg AS (
        SELECT avg(c."TOTAL_SCORE"::numeric) AS org_avg FROM qa_calls c
         WHERE c.is_sandbox = false ${orgClause}
           AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
      ), matched AS (
        SELECT c."ID" AS id,
          ($3 AND (($4 AND a.org_avg IS NOT NULL AND c."TOTAL_SCORE" <= a.org_avg - $5) OR (NOT $4 AND c."TOTAL_SCORE" < $6))) AS q,
          ($7 AND c."TOTAL_SCORE" >= $8) AS b,
          ($9 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cj.judgments,'[]'::jsonb)) e
                   WHERE NOT ((e->>'order_no')::int = ANY($11::int[])) AND (e->>'uncertain')::boolean)) AS cf_unc,
          ($10 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cj.judgments,'[]'::jsonb)) e
                   WHERE NOT ((e->>'order_no')::int = ANY($11::int[])) AND (e->>'contradiction')::boolean)) AS cf_con
        FROM qa_calls c
        LEFT JOIN qa_confidence_judgments cj ON cj.qa_id = c."ID"
        CROSS JOIN agg a
        WHERE c.is_sandbox = false ${orgClause}
          AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
          ${idClause}
      )
      UPDATE qa_calls t SET
        manual_review = true,
        manual_review_reasons =
            (CASE WHEN m.q      THEN jsonb_build_array('저품질 검증 · 평균점수 미달') ELSE '[]'::jsonb END)
         || (CASE WHEN m.cf_unc THEN jsonb_build_array('AI 신뢰도 검증 · 불확실 표현') ELSE '[]'::jsonb END)
         || (CASE WHEN m.cf_con THEN jsonb_build_array('AI 신뢰도 검증 · 근거-점수 모순') ELSE '[]'::jsonb END)
         || (CASE WHEN m.b      THEN jsonb_build_array('AI 편향점검 · 비정상 고점') ELSE '[]'::jsonb END),
        manual_review_at = COALESCE(t.manual_review_at, now())
      FROM matched m
      WHERE t."ID" = m.id AND (m.q OR m.b OR m.cf_unc OR m.cf_con)
      RETURNING t."ID"`;

    try {
        const { rowCount } = await pool.query(sql, params);
        return rowCount;
    } catch (e) {
        logger.warn(`[manual-review] 도장 실패(${e?.message || e})`);
        return 0;
    }
}

/** judgeConfidence 등에서 여러 콜(여러 org일 수 있음)을 org별로 묶어 도장. */
export async function stampByQaIds(pool, qaIds) {
    const ids = (qaIds || []).filter(Boolean);
    if (!ids.length) return 0;
    const { rows } = await pool.query(
        `SELECT DISTINCT org_id FROM qa_calls WHERE "ID" = ANY($1)`,
        [ids]
    );
    let total = 0;
    for (const r of rows) {
        total += await applyManualReviewStamps(pool, r.org_id ?? 0, { qaIds: ids });
    }
    return total;
}
