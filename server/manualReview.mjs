/**
 * 사람 수기평가 대상 '도장' — AI 평가된 콜 중 배치 카드 조건에 맞는 것에 manual_review 표식.
 *
 * preview(/api/batch/preview) 선별 로직과 동일 기준을 UPDATE 로 적용한다.
 *   - 통화시간 범위(공통 scope) 안 + 조건(저품질 평균점수 미달 / 신뢰도 불확실·모순 / 고점) 매칭 → 도장
 *   - 사유는 카드·세부규칙 수준 한글 라벨(상세 배지용): "저품질 검증 · 평균점수 미달" 등
 *   - 누적: 한 번 찍히면 유지(manual_review_at 은 최초 시각), 재실행은 사유만 갱신, 해제 안 함
 *   - qaIds 주면 그 콜들만 재계산(실시간/판정직후), 없으면 in-scope 전체
 * 지원 조건: 저품질(평균점수 미달)·신뢰도(불확실/모순)·편향(비정상 고점·무작위 표본)·근속(신입/장기근속).
 * 필수항목·리스크(금칙어·고객신호)는 아직 도장 대상 아님(데이터/정의 대기).
 */
import { logger } from './logger.mjs';

const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

/** 브랜드 배치 설정(qa_batch_configs) — org 우선, 없으면 0(전체/기본). 없으면 null. */
async function readBatchConfig(pool, orgId) {
    // 통합DB: qa_batch_configs.tenant_id(citext). org 우선, 없으면 '__default__'(전체/기본).
    const { rows } = await pool.query(
        `SELECT config FROM qa_batch_configs
          WHERE tenant_id = ANY($1) ORDER BY (tenant_id = $2) DESC LIMIT 1`,
        [[orgId, '__default__'], orgId]
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
    const on = cfg.on || {}, q = cfg.quality || {}, bias = cfg.bias || {}, conf = cfg.confidence || {}, scope = cfg.scope || {}, tenure = cfg.tenure || {};

    const minSec = Math.max(0, Math.round(num(scope.minMin, 0) * 60));
    const maxMinV = num(scope.maxMin, 0);
    const maxSec = maxMinV > 0 && maxMinV * 60 > minSec ? Math.round(maxMinV * 60) : 2147483647;

    const qOn = !!(on.quality && q.avgBelow);
    const qRel = q.avgMode === 'rel';
    const qRelPts = num(q.avgRel, 0);
    const qAbs = num(q.avgAbs, 0);
    const bHighOn = !!(on.bias && bias.highScore);
    const bHigh = num(bias.highThreshold, 101);
    const bHighRel = bias.highMode === 'rel';        // 평균점수 이상: 상대값(평균 대비 +N) | 절대값
    const bHighRelPts = num(bias.highRel, 0);
    const uncOn = !!(on.confidence && conf.uncertain);
    const conOn = !!(on.confidence && conf.contradiction);
    const excluded = Array.isArray(conf.excluded) ? conf.excluded.map(Number).filter(Number.isInteger) : [];
    // ⑤ 무작위 표본(편향점검) — 결정적 해시 샘플링: 콜별 고정이라 멱등(재실행해도 같은 집합, 누적 없음).
    const rOn = !!(on.bias && bias.random);
    const rPct = num(bias.randomPct, 0);
    // ④ 근속(대상자 특정) — 상담사 입사일(trainee_registrations.hire_date) 기준.
    //   신입=입사 N개월 이내, 장기근속=N년차↑. agent_user_id→trainee_registrations.user_id 조인.
    const tjOn = !!(on.tenure && tenure.junior);
    const tjM = Math.max(0, Math.round(num(tenure.juniorMonths, 6)));
    const tsOn = !!(on.tenure && tenure.senior);
    const tsY = Math.max(0, Math.round(num(tenure.seniorYears, 5)));

    if (!qOn && !bHighOn && !uncOn && !conOn && !rOn && !tjOn && !tsOn) return 0; // 활성(지원) 조건 없음

    const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, uncOn, conOn, excluded, rOn, rPct, tjOn, tjM, tsOn, tsY, bHighRel, bHighRelPts];
    // 통합DB: 헤더=common.calls(c), 점수/is_sandbox/manual_review*=qa_evaluations(e), 판정=eval_annotation(cj, call_id),
    //   입사일=테넌트별 memberships(mm). 내부 id=call_id(bigint). hashtext 표본은 source_id(=구 ID) 로 preview 와 동일.
    let orgClause = '';
    if (orgId !== '__default__') { params.push(orgId); orgClause = `AND c.tenant_id = $${params.length}`; }
    let idClause = '';
    if (Array.isArray(qaIds) && qaIds.length) { params.push(qaIds); idClause = `AND c.call_id = ANY($${params.length}::bigint[])`; }

    const sql = `
      WITH agg AS (
        SELECT avg(e."TOTAL_SCORE"::numeric) AS org_avg
          FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
         WHERE e.is_sandbox = false ${orgClause}
           AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
      ), matched AS (
        SELECT c.call_id AS id,
          ($3 AND (($4 AND a.org_avg IS NOT NULL AND e."TOTAL_SCORE" <= a.org_avg - $5) OR (NOT $4 AND e."TOTAL_SCORE" < $6))) AS q,
          ($7 AND (($18 AND a.org_avg IS NOT NULL AND e."TOTAL_SCORE" >= a.org_avg + $19) OR (NOT $18 AND e."TOTAL_SCORE" >= $8))) AS b,
          ($9 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cj.judgments,'[]'::jsonb)) je
                   WHERE NOT ((je->>'order_no')::int = ANY($11::int[])) AND (je->>'uncertain')::boolean)) AS cf_unc,
          ($10 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cj.judgments,'[]'::jsonb)) je
                   WHERE NOT ((je->>'order_no')::int = ANY($11::int[])) AND (je->>'contradiction')::boolean)) AS cf_con,
          ($12 AND (((hashtext(c.source_id) % 100) + 100) % 100) < $13) AS r,
          ($14 AND mm.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND mm.hire_date::date >= (CURRENT_DATE - make_interval(months => $15))) AS te_j,
          ($16 AND mm.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND mm.hire_date::date <= (CURRENT_DATE - make_interval(years  => $17))) AS te_s
        FROM common.calls c
        JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
        LEFT JOIN trustguard.eval_annotation cj ON cj.call_id = c.call_id
        LEFT JOIN common.memberships mm ON mm.user_id = c.agent_user_id AND mm.tenant_id = c.tenant_id
        CROSS JOIN agg a
        WHERE e.is_sandbox = false ${orgClause}
          AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
          ${idClause}
      )
      UPDATE trustguard.qa_evaluations t SET
        manual_review = true,
        manual_review_reasons =
            (CASE WHEN m.q      THEN jsonb_build_array('점수·표본 검증 · 평균점수 미달') ELSE '[]'::jsonb END)
         || (CASE WHEN m.cf_unc THEN jsonb_build_array('AI 신뢰도 검증 · 불확실 표현') ELSE '[]'::jsonb END)
         || (CASE WHEN m.cf_con THEN jsonb_build_array('AI 신뢰도 검증 · 근거-점수 모순') ELSE '[]'::jsonb END)
         || (CASE WHEN m.b      THEN jsonb_build_array('점수·표본 검증 · 평균점수 이상') ELSE '[]'::jsonb END)
         || (CASE WHEN m.r      THEN jsonb_build_array('점수·표본 검증 · 무작위 표본') ELSE '[]'::jsonb END)
         || (CASE WHEN m.te_j   THEN jsonb_build_array('대상자 특정 · 신입 상담사') ELSE '[]'::jsonb END)
         || (CASE WHEN m.te_s   THEN jsonb_build_array('대상자 특정 · 장기 근속') ELSE '[]'::jsonb END),
        manual_review_at = COALESCE(t.manual_review_at, now())
      FROM matched m
      WHERE t.call_id = m.id AND (m.q OR m.b OR m.cf_unc OR m.cf_con OR m.r OR m.te_j OR m.te_s)
      RETURNING t.call_id`;

    try {
        const { rowCount } = await pool.query(sql, params);
        return rowCount;
    } catch (e) {
        logger.warn(`[manual-review] 도장 실패(${e?.message || e})`);
        return 0;
    }
}

/** judgeConfidence 등에서 여러 콜(여러 tenant일 수 있음)을 tenant별로 묶어 도장. 통합DB: qaIds=call_id(bigint). */
export async function stampByQaIds(pool, qaIds) {
    const ids = (qaIds || []).filter((v) => v != null);
    if (!ids.length) return 0;
    const { rows } = await pool.query(
        `SELECT DISTINCT tenant_id FROM common.calls WHERE call_id = ANY($1::bigint[])`,
        [ids]
    );
    let total = 0;
    for (const r of rows) {
        total += await applyManualReviewStamps(pool, r.tenant_id ?? '__default__', { qaIds: ids });
    }
    return total;
}
