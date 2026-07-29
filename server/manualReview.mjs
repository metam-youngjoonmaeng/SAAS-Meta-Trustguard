/**
 * 사람 수기평가 대상 '도장' — AI 평가된 콜 중 배치 카드 조건에 맞는 것에 manual_review 표식.
 *
 * preview(/api/batch/preview) 선별 로직과 동일 기준을 UPDATE 로 적용한다.
 *   - 통화시간 범위(공통 scope) 안 + 조건(저품질 평균점수 미달 / 신뢰도 불확실·모순 / 고점) 매칭 → 도장
 *   - 사유는 카드·세부규칙 수준 한글 라벨(상세 배지용): "저품질 검증 · 평균점수 미달" 등
 *   - 누적: 한 번 찍히면 유지(manual_review_at 은 최초 시각), 재실행은 사유만 갱신, 해제 안 함
 *   - qaIds 주면 그 콜들만 재계산(실시간/판정직후), 없으면 in-scope 전체
 * 지원 조건: 저품질(평균점수 미달)·신뢰도(ai_confidence 임계 미달)·편향(비정상 고점·무작위 표본)·
 *   근속(신입/장기근속). 리스크(금칙어·고객신호)는 아직 도장 대상 아님(정의 대기).
 *
 * ★ 신뢰도 출처 = qa_call_item_score.ai_confidence (평가 백엔드가 응답에 실어 보내는 항목별 신뢰도).
 *   구 구현은 Gemini 를 직접 호출해 qa_call_annotation.judgments 에 { uncertain / contradiction } 을
 *   재판정하는 2차 레이어였고, 마이그레이션 75 에서 제거했다(평가 백엔드 라우팅을 우회했고 실사용 0).
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
    // ② 신뢰도 — 평가 백엔드가 준 항목별 신뢰도(qa_call_item_score.ai_confidence)가 임계 미달인 콜.
    //   임계값 미설정(null)이면 조건 자체를 끈다. 기본값을 두지 않는 것은 의도 —
    //   백엔드 스케일(0~1 vs 0~100) 규약 확정 전에 기본값을 넣으면 값이 들어오는 순간 전건 도장이 된다.
    const cThresholdRaw = Number(conf.threshold);
    const cThreshold = Number.isFinite(cThresholdRaw) ? cThresholdRaw : null;
    const confOn = !!(on.confidence && cThreshold !== null);
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

    if (!qOn && !bHighOn && !confOn && !rOn && !tjOn && !tsOn) return 0; // 활성(지원) 조건 없음

    const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, confOn, cThreshold, excluded, rOn, rPct, tjOn, tjM, tsOn, tsY, bHighRel, bHighRelPts];
    let orgClause = '';
    if (orgId !== 0) { params.push(orgId); orgClause = `AND c.org_id = $${params.length}`; }
    let idClause = '';
    if (Array.isArray(qaIds) && qaIds.length) { params.push(qaIds); idClause = `AND c."ID" = ANY($${params.length})`; }

    const sql = `
      WITH agg AS (
        SELECT avg(c."TOTAL_SCORE"::numeric) AS org_avg FROM qa_calls c
         WHERE TRUE ${orgClause}
           AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
      ), matched AS (
        SELECT c."ID" AS id,
          ($3 AND (($4 AND a.org_avg IS NOT NULL AND c."TOTAL_SCORE" <= a.org_avg - $5) OR (NOT $4 AND c."TOTAL_SCORE" < $6))) AS q,
          ($7 AND (($18 AND a.org_avg IS NOT NULL AND c."TOTAL_SCORE" >= a.org_avg + $19) OR (NOT $18 AND c."TOTAL_SCORE" >= $8))) AS b,
          ($9 AND EXISTS (SELECT 1 FROM qa_call_item_score er
                   WHERE er."ID" = c."ID" AND er.ai_confidence IS NOT NULL
                     AND er.ai_confidence < $10::numeric
                     AND NOT (er.order_no = ANY($11::int[])))) AS cf,
          ($12 AND (((hashtext(c."ID") % 100) + 100) % 100) < $13) AS r,
          ($14 AND tr.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND tr.hire_date::date >= (CURRENT_DATE - make_interval(months => $15))) AS te_j,
          ($16 AND tr.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND tr.hire_date::date <= (CURRENT_DATE - make_interval(years  => $17))) AS te_s
        FROM qa_calls c
        LEFT JOIN trainee_registrations tr ON tr.user_id = c.agent_user_id
        CROSS JOIN agg a
        WHERE TRUE ${orgClause}
          AND c.duration_sec IS NOT NULL AND c.duration_sec >= $1 AND c.duration_sec < $2
          ${idClause}
      )
      UPDATE qa_calls t SET
        manual_review = true,
        manual_review_reasons =
            (CASE WHEN m.q      THEN jsonb_build_array('점수·표본 검증 · 평균점수 미달') ELSE '[]'::jsonb END)
         || (CASE WHEN m.cf     THEN jsonb_build_array('AI 신뢰도 검증 · 신뢰도 미달') ELSE '[]'::jsonb END)
         || (CASE WHEN m.b      THEN jsonb_build_array('점수·표본 검증 · 평균점수 이상') ELSE '[]'::jsonb END)
         || (CASE WHEN m.r      THEN jsonb_build_array('점수·표본 검증 · 무작위 표본') ELSE '[]'::jsonb END)
         || (CASE WHEN m.te_j   THEN jsonb_build_array('대상자 특정 · 신입 상담사') ELSE '[]'::jsonb END)
         || (CASE WHEN m.te_s   THEN jsonb_build_array('대상자 특정 · 장기 근속') ELSE '[]'::jsonb END),
        manual_review_at = COALESCE(t.manual_review_at, now())
      FROM matched m
      WHERE t."ID" = m.id AND (m.q OR m.b OR m.cf OR m.r OR m.te_j OR m.te_s)
      RETURNING t."ID"`;

    try {
        const { rowCount } = await pool.query(sql, params);
        return rowCount;
    } catch (e) {
        logger.warn(`[manual-review] 도장 실패(${e?.message || e})`);
        return 0;
    }
}

// stampByQaIds(여러 콜을 org별로 묶어 도장)는 유일 호출자였던 judgeConfidence.mjs 와 함께 제거(75).
//   지금은 실시간 도장(icsQaPoller — 단일 org 컨텍스트)과 '지금 실행'(POST /api/batch/run)만 남아
//   applyManualReviewStamps 를 직접 호출한다. org 혼재 묶음 도장이 다시 필요해지면 되살릴 것.
