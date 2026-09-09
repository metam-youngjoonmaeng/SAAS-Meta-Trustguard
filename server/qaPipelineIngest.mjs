/**
 * QA Pipeline (qa-pipeline /evaluate) pull 어댑터.
 *
 * AgentCore qa-pipeline 의 `POST /evaluate` 를 호출 → 18 항목(#3 미산출) 평가 결과를
 * 대시보드 컬렉션관리부 9-order 구조로 환산 → `ingestCollectionCallToDb` 로 적재.
 *
 * 매핑·환산 규칙은 qa-pipeline 운영 매퍼(v2/serving/dashboard_output.py)의
 *   - DASHBOARD_ITEM_MAPPING (order_no → 파이프라인 item_number 목록)
 *   - JOB_MAX_SCORES (role → {order_no: 직무만점})
 *   - _compute_order_eval (ai_eval = round(Σscore / Σmax_score × 직무만점, 1))
 * 를 그대로 옮긴 것. 이중 환산 금지 — order 환산 1회만 수행한 뒤
 * collectionCallIngest 의 evaluations[].ai_eval 로 넘긴다(0..직무만점 범위).
 *
 * 점수 정책:
 *   - score 가 null/skipped 이거나 응답에 없는 item_number(예: #3)는 해당 order 의
 *     분자/분모에서 제외 → ai_eval NOT NULL 제약 보호. 분모(Σmax_score)가 0 이면 order 생략.
 *   - 배점 불일치는 비율(Σscore/Σmax_score) 환산으로 흡수 — 파이프라인 응답의 max_score 를
 *     동적 분모로 사용하므로 카탈로그 변경에 자기정합(상수 미사용).
 *   - 행(=order) 생략 시 대시보드 총점 derive 는 존재 order 의 직무만점 합 대비 백분율이므로 정합 유지.
 *   - report.final_score.after_overrides 와 derive 총점(존재 order 기준 백분율)을 비교,
 *     괴리(>3점) 시 warnings 에 수집(적재는 derive 값).
 */

import { ingestCollectionCallToDb } from './collectionCallIngest.mjs';
import { buildRubricFromDefs, buildRubricFromDomainDefaults } from './rubricSync.mjs';
import { getOrgFewshot } from './ragFewshotConfig.mjs';
// 순환 import(skillLearn ↔ 본 모듈)이지만 양쪽 다 함수 선언 export 를 런타임에만 호출 — ESM 안전.
import { getActiveSkillOverlays } from './skillLearn.mjs';
import {
    captureSticky,
    insertItemScoreRows,
    insertTranscriptRows,
    restoreSticky,
} from './itemScoreIngest.mjs';
import { round1, safeStr, asNumber } from './util/common.mjs';
import { RUBRIC_ITEM_BASE, RUBRIC_REGISTER_TIMEOUT_MS } from './util/rubricConst.mjs';
import { LEGACY_STANDARD_ORG_IDS } from './checklistCategorySummary.mjs';

const DEFAULT_BASE_URL = 'http://localhost:8081';
// EC2 원격 백엔드 (V3 qa-pipeline, 8081 직접 접근) — call.pipeline_target==='ec2' 시 사용.
const DEFAULT_EC2_BASE_URL = 'http://54.235.200.151:8081';
// 컨테이너에서 호스트의 로컬 파이프라인 접근 주소 — force-local 시 기본 타깃.
const DEFAULT_LOCAL_FORCE_URL = 'http://host.docker.internal:8081';

// ─── 파이프라인 HTTP 타임아웃 — **용도별**. 임의 통일 금지 ───────────────────────
// 평가는 항목당 LLM 콜이 붙어 실측 수백 초다. 조회 타임아웃(15초)으로 통일하면 정상 평가가
// 중간에 끊긴다. 반대로 조회에 600초를 주면 파이프라인이 죽었을 때 라우트가 10분간 매달린다.
const EVALUATE_TIMEOUT_MS = 600_000; // /evaluate · /evaluate/stream (장시간 — LLM 다건)
const QUERY_TIMEOUT_MS = 15_000; // 단순 조회(/v2/mtg-rag/{r}/coverage)
const GOLDEN_INDEX_TIMEOUT_MS_DEFAULT = 600_000; // 골든 색인 청크(요약 LLM + 임베딩 Titan)

/** 평가 백엔드 base URL 해석 — opts.baseUrl > call.pipeline_target('ec2') > env > 로컬 기본값 */
export function resolvePipelineBaseUrl(call, opts = {}) {
    if (opts.baseUrl) return opts.baseUrl;
    // 로컬 실험 강제 — env QA_PIPELINE_FORCE_LOCAL=1 이면 call.pipeline_target('ec2') 를 무시하고
    // 무조건 로컬로. 대시보드 옛 번들이 ec2 를 보내도 로컬로 강제됨.
    // ★ QA_PIPELINE_BASE_URL 을 신뢰하지 않음 — EC2 모드가 이 env 를 EC2 주소로 재활용했을 수 있어
    //    force-local 이 조용히 EC2 로 새는 것을 방지. 전용 QA_PIPELINE_FORCE_LOCAL_URL > 컨테이너 호스트 기본값.
    // 운영 복귀 시 env(QA_PIPELINE_FORCE_LOCAL) 만 해제하면 기존 동작(pipeline_target 기준) 복원.
    const _forceLocal = String(process.env.QA_PIPELINE_FORCE_LOCAL ?? '').trim().toLowerCase();
    if (_forceLocal === '1' || _forceLocal === 'true') {
        return process.env.QA_PIPELINE_FORCE_LOCAL_URL || DEFAULT_LOCAL_FORCE_URL;
    }
    if (isEc2Target(call)) {
        return process.env.QA_PIPELINE_BASE_URL_EC2 || DEFAULT_EC2_BASE_URL;
    }
    return process.env.QA_PIPELINE_BASE_URL || DEFAULT_BASE_URL;
}

/** call.pipeline_target === 'ec2' 여부 (대소문자 무시) */
function isEc2Target(call) {
    return String(call?.pipeline_target ?? '').trim().toLowerCase() === 'ec2';
}

/**
 * base URL 단일 경로 — resolvePipelineBaseUrl + 후행 슬래시 정규화.
 * 이 모듈의 파이프라인 호출은 전부 이 함수로만 base 를 얻는다(원격 차단 로직은 위 함수가 소유).
 */
function pipelineBase(call, opts = {}) {
    return resolvePipelineBaseUrl(call, opts).replace(/\/+$/, '');
}

/**
 * 파이프라인 HTTP 호출 단일 헬퍼 — URL·메서드·헤더·타임아웃 조립을 한 곳으로.
 *
 * **Response 를 그대로 돌려준다.** 호출부 5곳의 에러 계약이 서로 다르기 때문이다
 * (throw / console.warn 후 무시 / {error} 객체 반환 / status+body 집계 / SSE 본문 스트리밍).
 * 헬퍼가 상태코드를 판정해 예외로 바꾸면 그 계약이 통째로 바뀐다 — res.ok·res.status·res.body
 * 판정과 예외 메시지는 호출부에 그대로 남긴다.
 *
 * 타임아웃: 호출부가 용도별 상수로 **명시**한다(기본값 없음 — 빠뜨리면 즉시 드러나게).
 *   · `signal` 을 넘기면 그걸 쓴다 — SSE 는 응답 본문 스트리밍 구간까지 타임아웃이 살아 있어야
 *     하고 스트림 종료 시 타이머를 걷어야 하므로 호출부가 AbortController 를 소유한다.
 *   · 그 외는 `AbortSignal.timeout` — 요청부터 본문 파싱까지 한 데드라인으로 덮는다(unref 타이머).
 *
 * `accept` 에 기본값을 두지 않는 이유: 종전 5개 호출지점 중 3개(/v2/rubrics · examples ·
 * coverage)는 Accept 헤더를 아예 보내지 않았다. 기본값을 채우면 와이어가 달라진다 —
 * 수렴은 코드 형태만 바꾸고 요청 바이트는 건드리지 않는다.
 */
async function pipelineFetch(url, { method = 'GET', json, accept, timeoutMs, signal } = {}) {
    const headers = {};
    if (accept) headers.Accept = accept;
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
        method,
        headers,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        signal: signal || AbortSignal.timeout(timeoutMs),
    });
}

/**
 * 격리키(스킬 스토어 / fewshot 검색 / MTG RAG 인덱스) 조립 규칙 — **이 모듈의 단일 정의**.
 *   getOrgFewshot(tenant_rag_config) 결과의 rubric_id → 없으면 합성 `inline-org{N}`.
 * `skillLearn.mjs::resolveSkillRubricId` 와 같은 규칙이다(그쪽은 export 되지 않아 import 불가).
 * 골든 색인(ingestGoldenSetToRag)·커버리지(fetchGoldenIndexCoverage)·평가 동봉(store_key)이
 * 같은 값을 봐야 색인 키와 검색 키가 어긋나지 않는다 — 그래서 세 곳이 이 함수 하나만 본다.
 */
function isolationKeyOf(fx, orgId) {
    return fx && fx.rubric_id ? fx.rubric_id : `inline-org${orgId}`;
}

/** 위 규칙 + DB 조회. 조회 실패는 합성키 폴백(평가·색인을 멈추지 않는다). */
async function resolveIsolationKey(pool, orgId) {
    try {
        return isolationKeyOf(await getOrgFewshot(pool, orgId), orgId);
    } catch {
        return isolationKeyOf(null, orgId);
    }
}

// 대시보드 order_no → 파이프라인 item_number 목록 (dashboard_output.py:72-82)
const DASHBOARD_ITEM_MAPPING = {
    1: [1], // 첫인사
    2: [9, 17, 18], // 본인확인
    3: [2], // 종료인사 (끝인사)
    4: [], // 음성 — STT 기반 평가 불가 → order 생략
    5: [6, 7], // 언어표현
    6: [4, 5], // 기반형성
    7: [8, 12, 13], // 회수스킬
    8: [10, 11, 15, 16], // 업무정확도
    9: [14], // 이력등록
};

// 직무별 order 만점 (dashboard_output.py:98-106 / collectionCallIngest ROLE_MAX_MATRIX 와 동치)
const JOB_MAX_SCORES = {
    PDS1: { 1: 3, 2: 4, 3: 3, 4: 5, 5: 5, 6: 16, 7: 20, 8: 20, 9: 10 },
    PDS2: { 1: 3, 2: 4, 3: 3, 4: 4, 5: 3, 6: 20, 7: 20, 8: 20, 9: 10 },
    PDS3: { 1: 3, 2: 4, 3: 3, 4: 4, 5: 10, 6: 10, 7: 20, 8: 20, 9: 10 },
    수동대인: { 1: 3, 2: 4, 3: 3, 4: 4, 5: 10, 6: 10, 7: 20, 8: 20, 9: 10 },
    인바운드: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 10, 6: 20, 7: 15, 8: 15, 9: 10 },
};
JOB_MAX_SCORES['전체'] = JOB_MAX_SCORES.PDS1;

const ORDER_DERIVE_TOLERANCE = 3; // after_overrides vs derive 총점 괴리 임계(점)

const CUSTOMER_MARKERS = ['고객', 'customer', 'client', 'caller'];
const AGENT_MARKERS = ['상담', 'agent', 'tm', '직원', 'counsel'];



function safeList(value) {
    return Array.isArray(value) ? value : [];
}


/**
 * 항목 점수 전용 파서 — '채점 안 됨'(null)과 '0점'을 구분한다.
 *
 * ★ 2026-08-26 버그: 파이프라인은 인프라 실패 항목을 `score: null` 로 보내
 *   (`v2/pure_llm/evaluator.py` · `v2/agents/custom_rubric/runner.py` — 분자·분모 양쪽 제외 규약)
 *   호출부가 `if (score === null) → 행 생략` 으로 받도록 설계돼 있었다. 그런데 `asNumber` 는
 *   **`Number(null) === 0`** 이라 null 을 0 으로 바꿔 그 가드를 통째로 무력화했다.
 *   결과: LLM 응답 누락 항목이 '0점'으로 굳어 그 항목 배점만큼 총점이 깎였다
 *   (실측 CJ #6 설명력 −7 → 콜 총점 97 → 90).
 *   `asNumber` 자체는 손대지 않는다 — `max_score` 판정(감점전용 항목 식별: `dm !== 0`)이
 *   null→0 폴백에 의존하고 있어 전역 변경은 그쪽 동작을 바꾼다.
 */
function asScore(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return asNumber(value);
}

/**
 * /evaluate 응답에서 item_number → 평가 dict 인덱스 구축.
 * 1순위 report.item_scores[], 없으면 report.evaluation.categories[].items[] 평탄화.
 * 동일 item_number 중복 시 먼저 본 행 유지(1순위 소스 우선).
 */
function indexEvaluations(resp) {
    const byItem = new Map();
    const report = resp && typeof resp === 'object' ? resp.report : null;

    const itemScores = safeList(report?.item_scores);
    let source = '';
    if (itemScores.length) {
        source = 'report.item_scores';
        for (const ev of itemScores) {
            const n = asNumber(ev?.item_number);
            if (n === null) continue;
            if (!byItem.has(n)) byItem.set(n, ev);
        }
    } else {
        source = 'report.evaluation.categories[].items';
        const cats = safeList(report?.evaluation?.categories);
        for (const cat of cats) {
            for (const ev of safeList(cat?.items)) {
                const n = asNumber(ev?.item_number);
                if (n === null) continue;
                if (!byItem.has(n)) byItem.set(n, ev);
            }
        }
    }
    return { byItem, source };
}

/**
 * 항목 평가 dict 에서 item_name 추출 (item_scores 는 'item', evaluations[] 는 'item_name').
 */
function itemNameOf(ev) {
    const name = safeStr(ev?.item).trim() || safeStr(ev?.item_name).trim();
    return name || `item_${ev?.item_number}`;
}

/**
 * /evaluate 응답에서 금지어/사전 매칭·규칙 인용 표현을 항목별로 수집.
 *   RAG 로그 링버퍼 kind:'forbidden' 적재용. 점수 환산이 아니라 표시용 구조화 데이터만 추출.
 *   소스 경로 (report.item_scores[] / evaluations[].evaluation 양쪽 동형, indexEvaluations 사용):
 *     1) deductions[].rule_ref      → 규칙 참조 + reason/quote (표준 #6/#7 사전 1차필터 감점 포함)
 *     2) ecom_rag_verify.violations[] (이커머스) / 은행 미러 verdicts·violations
 *                                   → verdict / agent_quote / rule_ref / reason
 *     3) evidence[]                 → RAG 위반 시 추가된 상담사 인용 (speaker/quote)
 *   항목당 매칭이 하나도 없으면 결과에서 제외.
 * @param {object} resp /evaluate (또는 stream result) 응답
 * @returns {Array<{item_number:number,item_name:string,matches:Array<{term:string,rule_ref:string,verdict:string,quote:string}>}>}
 */
export function extractForbiddenFromResult(resp) {
    const out = [];
    const { byItem } = indexEvaluations(resp);
    for (const [itemNumber, ev] of byItem) {
        if (!ev || typeof ev !== 'object') continue;
        const matches = [];

        // 1) deductions[].rule_ref — 실제 사전/규칙 매칭(rule_ref)이 있을 때만 채택.
        //    순수 LLM 커스텀 루브릭(asdf 등 사전·규칙 없음)은 감점마다 reason(자유서술 사유)을
        //    남기지만 rule_ref 는 없음 → rule_ref 게이트로 LLM 판정 사유가 '금지어/사전 매칭' 으로
        //    오인 적재되는 것을 차단. RAG·사전 탭은 실제 사전/규칙 매칭(kolon/ecom/bank 의 rule_ref
        //    보유 감점)만 표시(무회귀). reason/quote 만 있고 rule_ref 없는 감점은 forbidden 아님.
        for (const d of safeList(ev.deductions)) {
            if (!d || typeof d !== 'object') continue;
            const ruleRef = safeStr(d.rule_ref).trim();
            if (!ruleRef) continue;
            const reason = safeStr(d.reason).trim();
            const quote = safeStr(d.quote || d.evidence_quote).trim();
            matches.push({ term: '', rule_ref: ruleRef, verdict: reason, quote });
        }

        // 2) ecom_rag_verify.violations[] (이커머스) / 은행 미러 verdicts·violations.
        const ragVerify = ev.ecom_rag_verify || ev.bank_rag_verify || null;
        if (ragVerify && typeof ragVerify === 'object') {
            const violations = [...safeList(ragVerify.violations), ...safeList(ragVerify.verdicts)];
            for (const v of violations) {
                if (!v || typeof v !== 'object') continue;
                const verdict = safeStr(v.verdict).trim();
                const ruleRef = safeStr(v.rule_ref).trim();
                const quote = safeStr(v.agent_quote || v.quote).trim();
                const term = safeStr(v.question || v.reason).trim();
                if (!verdict && !ruleRef && !quote && !term) continue;
                matches.push({ term, rule_ref: ruleRef, verdict, quote });
            }
        }

        // 3) evidence[] — 위 1/2 에서 실제 금지어/규칙 매칭(rule_ref/violation)이 있을 때만
        //    보조 인용으로 추가. 매칭이 없으면 evidence 만으로 forbidden 항목을 만들지 않는다.
        //    (순수 LLM 평가는 항목마다 근거 인용을 남기므로, 게이트 없이 두면 전 항목이
        //     '금지어/사전 매칭' 으로 오인 적재되어 RAG·사전 탭이 오염됨.)
        if (matches.length) {
            for (const q of safeList(ev.evidence)) {
                if (!q || typeof q !== 'object') continue;
                const quote = safeStr(q.quote).trim();
                if (!quote) continue;
                matches.push({ term: '', rule_ref: '', verdict: safeStr(q.speaker).trim(), quote });
            }
        }

        if (!matches.length) continue;
        out.push({ item_number: itemNumber, item_name: itemNameOf(ev), matches });
    }
    return out;
}

/**
 * evidence[] 에서 첫 상담사 발화 추출. 상담사 마커 우선, 고객 마커 제외, 그 외 첫 발화 fallback.
 * (dashboard_output.py:_first_agent_quote 와 동치)
 */
function firstAgentQuote(evals) {
    let fallback = '';
    for (const ev of evals) {
        for (const q of safeList(ev?.evidence)) {
            if (!q || typeof q !== 'object') continue;
            const quote = safeStr(q.quote).trim();
            if (!quote) continue;
            const speaker = safeStr(q.speaker).toLowerCase();
            if (AGENT_MARKERS.some((m) => speaker.includes(m))) return quote;
            if (CUSTOMER_MARKERS.some((m) => speaker.includes(m))) continue;
            if (!fallback) fallback = quote;
        }
    }
    return fallback;
}

/**
 * evidence[] 에서 첫 고객 발화 추출.
 */
function firstCustomerQuote(evals) {
    for (const ev of evals) {
        for (const q of safeList(ev?.evidence)) {
            if (!q || typeof q !== 'object') continue;
            const quote = safeStr(q.quote).trim();
            if (!quote) continue;
            const speaker = safeStr(q.speaker).toLowerCase();
            if (CUSTOMER_MARKERS.some((m) => speaker.includes(m))) return quote;
        }
    }
    return '';
}

/**
 * judgment → reason_text. "평가 이유" = LLM 판정 사유(judgment)만.
 *   감점 사유 prose 는 judgment 와 중복이라 미포함 — 감점은 행의 AI평가 점수(예 0/5)가
 *   "어떤 항목에서 얼마 감점"을 그대로 표현하므로 평가 이유 셀은 판정 사유만 깔끔히 노출.
 *   단 judgment 가 비어있는 항목만 감점 사유로 폴백(정보 손실 방지·중복 없음).
 */
function buildReasonText(present) {
    const head = [];
    for (const ev of present) {
        const name = itemNameOf(ev);
        const judgment = safeStr(ev?.judgment).trim();
        if (judgment) {
            head.push(`[${name}] ${judgment}`);
            continue;
        }
        // judgment 부재 시에만 감점 사유 폴백 (judgment 있으면 중복이라 생략).
        const reasons = safeList(ev?.deductions)
            .map((d) => (d && typeof d === 'object' ? safeStr(d.reason).trim() : ''))
            .filter(Boolean);
        head.push(reasons.length ? `[${name}] ${reasons.join('; ')}` : `[${name}]`);
    }
    return head.join(' / ');
}

/**
 * /evaluate 응답 → collectionCallIngest 입력 body 로 변환.
 * @returns {{ body: object, warnings: string[], deriveTotal: number, source: string }}
 */
function mapEvaluateResponse(resp, call) {
    const warnings = [];
    const role = safeStr(call?.role || 'PDS1').trim() || 'PDS1';
    const jobMax = JOB_MAX_SCORES[role] || JOB_MAX_SCORES.PDS1;
    if (!JOB_MAX_SCORES[role]) {
        warnings.push(`알 수 없는 role='${role}' → PDS1 직무만점 매트릭스로 대체`);
    }

    const { byItem, source } = indexEvaluations(resp);
    if (byItem.size === 0) {
        warnings.push('응답에서 평가 항목(item_scores / categories.items)을 찾지 못함');
    }

    const evaluations = [];
    let sumOrderEarned = 0;
    let sumOrderMax = 0;

    for (let orderNo = 1; orderNo <= 9; orderNo += 1) {
        const itemNumbers = DASHBOARD_ITEM_MAPPING[orderNo] || [];
        const orderMax = jobMax[orderNo];
        if (orderMax === undefined) continue;

        const present = [];
        let sumScore = 0;
        let sumMax = 0;
        for (const num of itemNumbers) {
            const ev = byItem.get(num);
            if (!ev) {
                // 응답에 없는 item_number(#3 영구제거 등) → 행 제외
                if (itemNumbers.length) {
                    warnings.push(`order ${orderNo}: item_number #${num} 응답에 없음 → 환산 분모 제외`);
                }
                continue;
            }
            const score = ev.score;
            const maxScore = asNumber(ev.max_score);
            if (score === null || score === undefined) {
                warnings.push(`order ${orderNo}: item_number #${num} score=null/skipped → 환산 분모 제외`);
                continue;
            }
            const sc = asNumber(score);
            if (sc === null || maxScore === null || maxScore <= 0) {
                warnings.push(`order ${orderNo}: item_number #${num} score/max_score 비정상 → 환산 분모 제외`);
                continue;
            }
            sumScore += sc;
            sumMax += maxScore;
            present.push(ev);
        }

        if (sumMax <= 0) {
            // order 4(음성, 매핑 비어있음) 포함 — 분모 0 이면 order 생략(행 제외)
            continue;
        }

        const aiEval = round1((sumScore / sumMax) * orderMax);
        sumOrderEarned += aiEval;
        sumOrderMax += orderMax;

        evaluations.push({
            order_no: orderNo,
            ai_eval: aiEval,
            reason_text: buildReasonText(present),
            agent_utterance: firstAgentQuote(present),
            customer_utterance: firstCustomerQuote(present),
            validation_time: `배점 ${orderMax}`,
        });
    }

    // derive 총점(존재 order 기준 백분율) vs 파이프라인 final_score.after_overrides 비교
    const deriveTotal = sumOrderMax > 0 ? round1((100 * sumOrderEarned) / sumOrderMax) : 0;
    const afterOverrides = asNumber(resp?.report?.final_score?.after_overrides);
    if (afterOverrides !== null && Math.abs(afterOverrides - deriveTotal) > ORDER_DERIVE_TOLERANCE) {
        warnings.push(
            `총점 괴리: final_score.after_overrides=${afterOverrides} vs derive(존재 order 백분율)=${deriveTotal} (적재는 derive)`
        );
    }

    const cdate =
        safeStr(call?.cdate).trim() ||
        safeStr(call?.call_datetime).trim() ||
        new Date().toISOString();

    const body = {
        call: {
            id: safeStr(call?.qa_id ?? call?.consultation_id ?? call?.id).trim(),
            cdate,
            department: safeStr(call?.department).trim() || undefined,
            role,
            call_seq: call?.call_seq !== undefined ? safeStr(call.call_seq) : undefined,
            uid: call?.uid !== undefined ? safeStr(call.uid) : undefined,
        },
        evaluations,
    };

    return { body, warnings, deriveTotal, source };
}

/**
 * qa-pipeline POST /evaluate 호출.
 * body = { transcript, consultation_id, metadata:{source,qa_id,org_id,department,role} }
 * @returns {Promise<object>} 파싱된 /evaluate 응답 JSON
 */
function buildEvaluatePayload(call) {
    const consultationId = safeStr(call?.consultation_id ?? call?.qa_id ?? call?.id).trim();
    // 토론(페르소나 앙상블) 토글 — 대시보드발 평가는 테스트 모드라 기본 'single'(토론 OFF).
    // qa-pipeline server_v2 가 body.persona_mode='single' 을 요청 단위로 인식해 토론을 끔.
    // call.persona_mode 또는 env QA_PIPELINE_PERSONA_MODE 로 오버라이드 가능('ensemble'=토론 ON).
    const personaMode =
        safeStr(call?.persona_mode).trim() || safeStr(process.env.QA_PIPELINE_PERSONA_MODE).trim() || 'single';
    // rubric_id 가 있으면 metadata 에 추가 — 서버가 custom_rubric 트랙(5000번대 항목 + kms 노드)으로 분기.
    const rubricId = safeStr(call?.rubric_id).trim();
    // RAG/스킬 오버레이 토글 — 대시보드발 평가는 경량 모드라 기본 둘 다 비활성(true).
    // RAG 검색(LLM 쿼리 요약 + Titan 임베딩 + AOSS)이 평가당 수십 초를 점유하던 병목 제거.
    // call.disable_rag/disable_skills 또는 env QA_PIPELINE_DISABLE_RAG/DISABLE_SKILLS='false' 로 재활성.
    const disableRag =
        call?.disable_rag !== undefined
            ? Boolean(call.disable_rag)
            : safeStr(process.env.QA_PIPELINE_DISABLE_RAG).trim().toLowerCase() !== 'false';
    const disableSkills =
        call?.disable_skills !== undefined
            ? Boolean(call.disable_skills)
            : safeStr(process.env.QA_PIPELINE_DISABLE_SKILLS).trim().toLowerCase() !== 'false';
    // ★ 2026-08-25 LLM 백엔드 선택 — OpenAI(기본) / vLLM(자체 호스팅, 사내 10.13.6.237).
    //   ★ 2026-08-27 Azure OpenAI 추가.
    //   call.llm_backend → env QA_PIPELINE_LLM_BACKEND → 미동봉(=파이프라인 서버 기본값) 순.
    //   ※ 미동봉이 곧 "서버가 정한다" 이므로 빈 값을 억지로 'openai' 로 채우지 않는다 —
    //     채우면 파이프라인의 LLM_BACKEND 변경이 대시보드발 평가에만 안 먹는 비대칭이 생긴다.
    //   ※ 파이프라인은 모델 잠금(QA_LLM_MODEL_LOCK)이 켜져 있어도 잠금 예외 목록
    //     (nodes/llm.py::_lock_exempt_backends)에 든 백엔드는 통과시킨다. 목록은
    //     env QA_LLM_LOCK_EXEMPT_BACKENDS 로 정하며 파이프라인 .env 에 `vllm,azure` 로
    //     설정돼 있다(2026-08-27). bedrock 백엔드는 2026-09-02 파이프라인에서 제거됐다.
    const llmBackend =
        safeStr(call?.llm_backend).trim().toLowerCase() ||
        safeStr(process.env.QA_PIPELINE_LLM_BACKEND).trim().toLowerCase();
    // vLLM 접속 정보 — backend 가 vllm 일 때만 의미가 있다. 미동봉이면 파이프라인이
    // 자기 QA_VLLM_* env 로 떨어진다. 크리덴셜이 아니라 사내 주소라 로깅 위험이 없다.
    const vllmBaseUrl =
        safeStr(call?.vllm?.base_url).trim() || safeStr(process.env.QA_PIPELINE_VLLM_BASE_URL).trim();
    const vllmModel = safeStr(call?.vllm?.model).trim() || safeStr(process.env.QA_PIPELINE_VLLM_MODEL).trim();
    const vllmCfg = {};
    if (vllmBaseUrl) vllmCfg.base_url = vllmBaseUrl;
    if (vllmModel) vllmCfg.model = vllmModel;
    // ★ 2026-08-27 Azure OpenAI 접속 정보 — backend 가 azure 일 때만 의미가 있다.
    //
    //   **API 키·엔드포인트는 여기로 오지 않는다.** 파이프라인 서버 env(AZURE_OPENAI_ENDPOINT /
    //   AZURE_OPENAI_API_KEY)가 유일한 출처다. 파이프라인은 요청 body 의 `azure.api_key` 도
    //   받을 수 있지만(nodes/azure_llm.py::set_request_azure_creds), MTG 경로에서는 의도적으로
    //   보내지 않는다 — 이유:
    //     · MTG 는 다수 운영자가 쓰는 대시보드다. 키를 브라우저에 두면 사용자 수만큼 사본이 생긴다.
    //     · 이 payload 는 /api/ingest/qa-pipeline-jobs 로 들어온 call 객체에서 조립된다.
    //       같은 라우터의 다른 경로(brandRoutes 등)는 감사로그에 req.body 를 통째로 적재한다 —
    //       키가 body 에 있으면 라우트 하나만 잘못 손대도 DB 에 평문으로 남는다.
    //     · 배포명은 크리덴셜이 아니므로 요청 단위 선택을 허용한다(모델 선택에 해당).
    //   키를 프론트에서 받고 싶어지면 여기 azureCfg 에 api_key/endpoint 를 더하면 되지만,
    //   위 감사로그 경로를 먼저 확인할 것.
    //
    //   배포명: call.azure.deployment → env QA_PIPELINE_AZURE_DEPLOYMENT → 미동봉(=파이프라인
    //   AZURE_OPENAI_DEPLOYMENT). 'auto' 는 파이프라인이 '서버 기본 배포' 신호로 해석한다.
    const azureDeployment =
        safeStr(call?.azure?.deployment).trim() || safeStr(process.env.QA_PIPELINE_AZURE_DEPLOYMENT).trim();
    const azureApiVersion = safeStr(call?.azure?.api_version).trim();
    const azureCfg = {};
    if (azureDeployment) azureCfg.deployment = azureDeployment;
    if (azureApiVersion) azureCfg.api_version = azureApiVersion;
    // ★ 2026-09-07 OpenAI 모델 선택 — 기본은 파이프라인 env(OPENAI_MODEL=gpt-5.6-luna).
    //   프론트에서 고른 값만 실어 보낸다. 비우면 미동봉 = "서버가 정한다" = luna.
    //
    //   크리덴셜이 아니라 모델명이므로 요청 단위 선택을 허용한다(azure 배포명과 동일 판단).
    //   **API 키는 여기로 오지 않는다** — 파이프라인 env(OPENAI_API_KEY)가 유일한 출처다.
    //   위 azureCfg 주석의 감사로그 경로(req.body 통째 적재) 이유가 그대로 적용된다.
    //
    //   ※ 값 검증은 파이프라인 ingress 가 허용목록(openai_llm.SELECTABLE_MODELS)으로 한다.
    //     이 통로는 파이프라인의 모델 잠금을 지나므로 목록 외 값은 그쪽에서 버려진다.
    const openaiModel =
        safeStr(call?.openai?.model).trim() || safeStr(process.env.QA_PIPELINE_OPENAI_MODEL).trim();
    const openaiCfg = {};
    if (openaiModel) openaiCfg.model = openaiModel;

    return {
        transcript: call?.transcript,
        consultation_id: consultationId,
        persona_mode: personaMode,
        disable_rag: disableRag,
        disable_skills: disableSkills,
        ...(llmBackend ? { llm_backend: llmBackend } : {}),
        ...(llmBackend === 'vllm' && Object.keys(vllmCfg).length > 0 ? { vllm: vllmCfg } : {}),
        ...(llmBackend === 'azure' && Object.keys(azureCfg).length > 0 ? { azure: azureCfg } : {}),
        // ★ 2026-09-07 — backend 가 openai 이거나 **미지정**(서버 기본이 openai)일 때만 싣는다.
        //   vllm/azure 를 고른 상태에서 보내면 그 백엔드와 무관한 모델명이 payload 에 남아
        //   나중에 로그를 읽는 사람이 "openai 로 돌았다" 고 오독한다.
        ...(!['vllm', 'azure'].includes(llmBackend) && Object.keys(openaiCfg).length > 0
            ? { openai: openaiCfg }
            : {}),
        metadata: {
            source: 'qa_dashboard',
            qa_id: safeStr(call?.qa_id ?? call?.id).trim() || undefined,
            org_id: call?.org_id !== undefined ? safeStr(call.org_id) : undefined,
            department: call?.department !== undefined ? safeStr(call.department) : undefined,
            role: call?.role !== undefined ? safeStr(call.role) : undefined,
            // PURE 트랙 진입 신호 — 백엔드 _resolve_pure_mode 가 metadata.eval_mode 로 읽어
            // build_graph_v2_pure 선택(coverage/KMS/persona/pentagon 미수행). 미동봉이면 기존 풀 그래프.
            eval_mode: safeStr(call?.eval_mode).trim() || undefined,
            rubric_id: rubricId || undefined,
            // 격리키 명시 — 스킬 스토어 / 루브릭 fewshot 검색 / MTG RAG 인덱스가 공유하는 키.
            // 산출·무회귀 근거는 evaluateStandardCall 의 store_key 블록 주석 참조(그 함수만 세팅).
            // 미동봉이면 파이프라인이 metadata.rubric_id → 합성 inline-org{N} 순으로 폴백(종전 거동).
            store_key: safeStr(call?.store_key).trim() || undefined,
            // 루브릭 few-shot 항목 게이트 — "이 항목 이름들만" RAG few-shot 허용(브랜드 한정 실험).
            // 백엔드 rubric_fewshot_gate 가 state.metadata 에서 읽어 custom_rubric 경로① 게이트.
            // 미동봉이면 백엔드 게이트 비활성(전 항목 통과, 기존 거동). 항목 이름 기반=재번호 안전.
            rubric_fewshot_item_names:
                Array.isArray(call?.rubric_fewshot_item_names) && call.rubric_fewshot_item_names.length
                    ? call.rubric_fewshot_item_names
                    : undefined,
            // 활성 테넌트 평가항목을 요청에 직접 동봉 — 원격(EC2) 백엔드도 프론트 기준 그대로 평가.
            rubric_inline:
                call?.rubric_inline && typeof call.rubric_inline === 'object' ? call.rubric_inline : undefined,
            // 코오롱 표준 트랙 전용: 항목별 DB 프롬프트({item_number: prompt_template}) 동봉.
            // 백엔드 표준 노드(load_prompt/load_group_b_prompt)가 set_prompt_overrides 로 받아
            // 정적 파일 대신 대시보드 DB 프롬프트로 평가(EC2 file 모드 반영). rubric_inline 과 달리
            // custom_rubric 트랙을 트리거하지 않아 코오롱 3-페르소나 표준 엔진을 그대로 유지.
            prompt_overrides:
                call?.prompt_overrides && typeof call.prompt_overrides === 'object'
                    ? call.prompt_overrides
                    : undefined,
            // 표준 트랙 만점/단계 동적 오버라이드 — prompt_overrides 와 동형({order_no: 값}).
            // 백엔드가 contextvar 로 받아 분모(max_overrides=만점) / snap allowed_steps(step_overrides)
            // 를 동적 반영. 미동봉(직접 API 호출 등)이면 백엔드 정적 카탈로그 사용 → 무회귀.
            max_overrides:
                call?.max_overrides && typeof call.max_overrides === 'object' ? call.max_overrides : undefined,
            step_overrides:
                call?.step_overrides && typeof call.step_overrides === 'object' ? call.step_overrides : undefined,
            // Additive 트랙: 코오롱 표준 #1~18 은 prompt_overrides 로 튜닝 노드 유지하고,
            // 카탈로그 비매칭 추가항목(order_no≥19)만 별도 채점하도록 동봉. rubric_inline 과
            // 달리 custom_rubric full-custom flip 을 유발하지 않음 — 백엔드 graph_v2 가
            // additive 모드(표준 8노드 + custom_rubric)로 분기. 추가항목 0개면 미동봉(무회귀).
            additive: call?.additive === true ? true : undefined,
            additive_items:
                Array.isArray(call?.additive_items) && call.additive_items.length
                    ? call.additive_items
                    : undefined,
            // MTG 스킬 overlay 인라인({item_number: md}) — MTG DB(qa_skill_store) 소유 모델.
            // 백엔드 apply 게이트가 파일 스토어보다 최우선 사용 → 배포 스왑·등록 소실과 무관하게
            // 평가 주입이 DB 활성 버전 기준으로 동작. 미동봉이면 백엔드 파일 스토어 거동(무회귀).
            skill_overlays:
                call?.skill_overlays && typeof call.skill_overlays === 'object' ? call.skill_overlays : undefined,
            // KSQI-STT(신규 17항목, 코오롱 9항목 레거시 v2/nodes/ksqi 와 완전 분리) 실행 토글 —
            // organizations.ksqi_stt_enabled(evaluateStandardCall 이 주입) 를 그대로 전달.
            // 항상 명시적 boolean(다른 옵션 필드와 달리 undefined 로 생략하지 않음) — 백엔드가
            // state["ksqi_stt_enabled"] 게이트로 그대로 읽어 신규 모듈 실행 여부를 결정.
            ksqi_stt_enabled: call?.ksqi_stt_enabled === true,
            // KMS 적용 범위 — 화면의 KMS 지정 항목(order_no)을 파이프라인 항목번호로 바꾼 목록.
            // 산출은 resolveKmsItemNumbers, 소비는 v2/pure_llm/kms_scope.kms_items_of.
            //   미동봉      = 범위 미전달 → 파이프라인 env 폴백(QA_PURE_KMS_RAG 등)
            //   []          = 체크 0건 → KMS 끔. **빈 배열도 그대로 보낸다** — 생략하면
            //                 체크를 다 풀어도 env 폴백으로 계속 돌아 "안 꺼진다" 가 된다.
            //   [5005, …]   = 그 항목만 KMS 로 취급(귀속 칩 항목번호도 이 목록에서 나온다)
            kms_items: Array.isArray(call?.kms_items) ? call.kms_items : undefined,
        },
    };
}

async function callQaPipeline(call, { baseUrl } = {}) {
    const url = `${pipelineBase(call, { baseUrl })}/evaluate`;
    const payload = buildEvaluatePayload(call);

    const res = await pipelineFetch(url, {
        method: 'POST',
        json: payload,
        accept: 'application/json',
        timeoutMs: EVALUATE_TIMEOUT_MS,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`qa-pipeline /evaluate 실패: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }
    return res.json();
}

/** SSE 이벤트 블록("event: x\ndata: {...}") 파싱. keepalive 주석(': ') 라인은 무시. */
function parseSseEventBlock(rawBlock) {
    let event = 'message';
    const dataLines = [];
    for (const line of rawBlock.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return null;
    try {
        return { event, data: JSON.parse(dataLines.join('\n')) };
    } catch {
        return { event, data: {} };
    }
}

/**
 * qa-pipeline POST /evaluate/stream (SSE) 호출 — 노드 진행 이벤트를 onProgress 로 중계.
 * payload 는 callQaPipeline 과 동일. 'status' 이벤트({node,status,elapsed})마다 onProgress 호출,
 * 'result' 이벤트(= /evaluate JSON 응답 전체)를 최종 반환. 'error' 이벤트/HTTP 오류는 throw.
 */
async function callQaPipelineStream(call, { baseUrl } = {}, onProgress = null) {
    const url = `${pipelineBase(call, { baseUrl })}/evaluate/stream`;
    const payload = buildEvaluatePayload(call);

    // 타임아웃을 여기서 소유하는 이유: 데드라인이 응답 본문(SSE) 소비 구간까지 살아 있어야 하고,
    // 스트림이 정상 종료되면 타이머를 걷어야 한다(pipelineFetch 의 signal 파라미터 주석 참조).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVALUATE_TIMEOUT_MS);
    try {
        const res = await pipelineFetch(url, {
            method: 'POST',
            json: payload,
            accept: 'text/event-stream',
            signal: controller.signal,
        });
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            throw new Error(`qa-pipeline /evaluate/stream 실패: HTTP ${res.status} — ${text.slice(0, 300)}`);
        }

        let result = null;
        let streamError = null;
        let buf = '';
        const decoder = new TextDecoder('utf-8');
        for await (const chunk of res.body) {
            buf += decoder.decode(chunk, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
                const ev = parseSseEventBlock(buf.slice(0, idx));
                buf = buf.slice(idx + 2);
                if (!ev) continue;
                if (ev.event === 'status') {
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress(ev.data);
                        } catch {
                            /* 진행상황 콜백 오류는 평가에 영향 없음 */
                        }
                    }
                } else if (ev.event === 'rag_hits_ready') {
                    // RAG 라이브 few-shot hit (item별 SSE). status 와 달리 type 래핑으로 흘려
                    // 하위호환 보존 — 기존 status onProgress(ev.data) 시그니처는 불변.
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress({ type: 'rag_hits', data: ev.data });
                        } catch {
                            /* 진행상황 콜백 오류는 평가에 영향 없음 */
                        }
                    }
                } else if (ev.event === 'skill_overlay_ready') {
                    // LLM 스킬 overlay 라이브 (item별 SSE) — 평가에 스킬 룰이 실제 주입됐는지 관측.
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress({ type: 'skill_overlay', data: ev.data });
                        } catch {
                            /* 진행상황 콜백 오류는 평가에 영향 없음 */
                        }
                    }
                } else if (ev.event === 'result') {
                    result = ev.data;
                    // 최종 result 를 onProgress 로 전달 — index.js 가 capturedRawResp 에 담아
                    // 금지어/사전 매칭(kind:'forbidden')을 RAG 로그 링버퍼에 적재. (#033 forbidden 경로)
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress({ type: 'result', data: ev.data });
                        } catch {
                            /* 진행상황 콜백 오류는 평가에 영향 없음 */
                        }
                    }
                } else if (ev.event === 'error') {
                    streamError = safeStr(ev.data?.message || ev.data?.detail || ev.data?.error) || 'stream error';
                }
            }
        }
        if (streamError) throw new Error(`qa-pipeline /evaluate/stream 실패: ${streamError}`);
        if (!result) throw new Error('qa-pipeline /evaluate/stream 이 result 이벤트 없이 종료되었습니다.');
        return result;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 단일 콜: /evaluate 호출 → 매핑 → DB 적재. 콜 배열 순차 처리는 라우트(index.js)가 담당.
 * @returns {Promise<{ok, qa_id, ai_score, total_score, role, department, turns, elapsed_sec, warnings, source}>}
 */
export async function ingestCallFromQaPipeline(pool, call, opts = {}) {
    const started = Date.now();
    const resp = await callQaPipeline(call, opts);
    const { body, warnings, source } = mapEvaluateResponse(resp, call);

    if (!safeStr(body.call.id).trim()) {
        return { ok: false, message: 'call.id(qa_id/consultation_id) 가 필요합니다.', warnings };
    }

    const result = await ingestCollectionCallToDb(pool, body);
    const elapsedSec = round1((Date.now() - started) / 1000);
    if (!result.ok) {
        return { ...result, warnings, source, elapsed_sec: elapsedSec };
    }
    return { ...result, warnings, source, elapsed_sec: elapsedSec };
}

// ============================================================
// 표준 18항목 트랙 (track='standard') — 코오롱 등 표준(default) 8카테고리 18항목 브랜드.
// ------------------------------------------------------------
// 9-order 컬렉션 환산을 우회하고, qa-pipeline /evaluate 의 18 항목을 1:1 로
//   qa_call_item_score(ai_eval=파이프라인 score 직결, max_score=항목 만점, agent_utterance=근거 발화)
//   + qa_calls(org_id 명시, department='고객지원실', role='전체') 에 직접 적재.
// 분석 라우트가 qa_call_item_score.ai_eval 로 Pentagon 5축을 LIVE 도출하므로 스케일링/환산 없음.
// 위 collection 함수/상수(mapEvaluateResponse/DASHBOARD_ITEM_MAPPING/JOB_MAX_SCORES)는 무변경.
// ============================================================

// qa_calls.department 는 CHECK 제약(컬렉션관리부·소비자보호부·고객센터·고객지원실)으로 '기본' 적재 불가.
// 표준 트랙(코오롱·신규 브랜드)은 평가 루브릭이 '기본'이지만 콜 부서는 CHECK-유효한 '고객지원실'로 적재한다.
// (Dashboard 는 단일 부서 브랜드를 부서로 분할하지 않으므로 '기본' 탭에서 모두 노출됨)
const STANDARD_DEPARTMENT = '고객지원실';
const STANDARD_ROLE = '전체';

// 표준 18항목 카탈로그 (SSOT: server/defaultEvalItems.mjs + src/constants.js DEFAULT_CHECKLIST_TEMPLATE).
// src import 불가하여 모듈 내 상수로 정의. max = 만점(#10/#15=10, 나머지=5).
const STANDARD_ITEM_CATALOG = [
    { order_no: 1, category: '인사 예절', item: '첫인사', max: 5 },
    { order_no: 2, category: '인사 예절', item: '끝인사', max: 5 },
    { order_no: 3, category: '경청 및 소통', item: '경청 (말겹침/말자름)', max: 5 },
    { order_no: 4, category: '경청 및 소통', item: '호응 및 공감', max: 5 },
    { order_no: 5, category: '경청 및 소통', item: '대기 멘트', max: 5 },
    { order_no: 6, category: '언어 표현', item: '정중한 표현', max: 5 },
    { order_no: 7, category: '언어 표현', item: '쿠션어 활용', max: 5 },
    { order_no: 8, category: '니즈 파악', item: '문의 파악 및 재확인(복창)', max: 5 },
    { order_no: 9, category: '니즈 파악', item: '고객정보 확인', max: 5 },
    { order_no: 10, category: '설명력 및 전달력', item: '설명의 명확성', max: 10 },
    { order_no: 11, category: '설명력 및 전달력', item: '두괄식 답변', max: 5 },
    { order_no: 12, category: '적극성', item: '문제 해결 의지', max: 5 },
    { order_no: 13, category: '적극성', item: '부연 설명 및 추가 안내', max: 5 },
    { order_no: 14, category: '적극성', item: '사후 안내', max: 5 },
    { order_no: 15, category: '업무 정확도', item: '정확한 안내', max: 10 },
    { order_no: 16, category: '업무 정확도', item: '필수 안내 이행', max: 5 },
    { order_no: 17, category: '개인정보 보호', item: '정보 확인 절차', max: 5 },
    { order_no: 18, category: '개인정보 보호', item: '정보 보호 준수', max: 5 },
];

// #3(경청 말겹침/말자름)은 파이프라인 미산출(qa_rules.py) → 항상 생략 + warnings.
const STANDARD_SKIP_ORDERS = new Set([3]);

// order_no → 카탈로그 슬롯(category/item/max) 역참조 — 루브릭 트랙 환원 시 사용.
const STANDARD_CATALOG_BY_ORDER = new Map(STANDARD_ITEM_CATALOG.map((slot) => [slot.order_no, slot]));


/**
 * 루브릭 항목(rubric.items[i])이 코오롱 표준 카탈로그 슬롯과 일치하는지 — order_no 가 카탈로그에
 * 존재하고 항목명까지 동일해야 표준(#1~18) 으로 본다. 그 외(order_no≥19 등)는 additive 추가항목.
 */
function isStandardCatalogSlot(meta) {
    const slot = STANDARD_CATALOG_BY_ORDER.get(asNumber(meta?.order_no));
    return !!slot && safeStr(slot.item).trim() === safeStr(meta?.item).trim();
}

/**
 * buildRubricFromDefs 의 rubric.items[i] + rowMeta[i] → metadata.additive_items 항목으로 변환.
 * 계약(ADDITIVE_CONTRACT §1) 필드: order_no, name, category, max_score, allowed_steps,
 * criteria_full, prompt_template, scoring_type. 빈 prompt_template 은 placeholder 정화 결과이므로
 * 그대로 빈 문자열로 전달(백엔드 build_rubric_item_block 가 criteria_full 폴백).
 */
function buildAdditiveItem(item, meta) {
    return {
        order_no: asNumber(meta?.order_no),
        name: safeStr(item?.name).trim() || safeStr(meta?.item).trim() || `항목 ${meta?.order_no}`,
        category: safeStr(item?.category).trim(),
        max_score: asNumber(item?.max_score),
        // 표시 분모(만점 폼 필드) — 채점 척도(max_score=프롬프트 점수단계 top)와 분리. rowMeta(meta)
        // 의 max_score 가 운영자 만점 폼 필드. 백엔드가 패스스루로 ItemResult.display_max 노출 →
        // additive 결과행을 "LLM점수(채점) / 만점필드(표시)" 로 표기. 미동봉/표준 결합 시 무회귀.
        display_max: asNumber(meta?.max_score),
        allowed_steps: Array.isArray(item?.allowed_steps) ? item.allowed_steps : undefined,
        criteria_full: safeStr(item?.criteria_full),
        prompt_template: safeStr(item?.prompt_template),
        scoring_type: item?.scoring_type === 'yes_no' ? 'yes_no' : 'numeric',
    };
}

// 만점 + judgment 에 아래 마커가 있으면 "평가 대상 상황 자체가 없었다"는 의미 —
// evidence 발화를 노출하면 혼란 (예: 쿠션어 '거절/불가 상황 미발생'인데 발화 표시).
const NO_OCCURRENCE_MARKERS = ['미발생', '해당없음', '해당 없음', '불필요'];
// 평가 발화는 개수 제한 없이 매칭된 상담사 발화를 모두 저장한다(화면에서 셀 내부 스크롤로 노출).
// 파이프라인이 evidence 부재 시 채워 넣는 시스템 placeholder — 발화가 아니므로 표시 제외.
const SYSTEM_QUOTE_MARKERS = ['근거 인용 미제출', 'LLM 평가 실패', 'evidence 추출 불가'];

/**
 * 단일 항목 평가 dict 에서 evidence 발화를 (개수 제한 없이) 모두 모아 개행 join.
 *   - 상담사 발화 + **고객 발화 모두 포함**, evidence 원래 순서 유지.
 *   - 감점이 없고 judgment 가 미발생/해당없음류면 발화 표시 생략.
 *   - (system) placeholder(근거 인용 미제출 등)는 발화가 아니므로 생략.
 *   - 중복 제거. 프론트 하이라이트는 발화별 부분일치 매칭이라 개행 join 호환.
 *
 * ★ 2026-08-25 — 종전에는 `CUSTOMER_MARKERS` 에 걸리는 발화를 `continue` 로 **버렸다**.
 *   그래서 감점 근거가 고객 반응에 있는 경우(재질문 → 고객 "아까 말씀드렸잖아요")
 *   상담사 질문만 남고 정작 근거가 되는 고객 발화가 화면에서 사라졌다. 사용자 지시로
 *   고객 발화도 포함한다.
 *   순서는 상담사/고객으로 묶지 않고 **evidence 원순서**를 그대로 둔다 — 위 예처럼
 *   문답 한 쌍일 때 시간 순서가 곧 근거의 의미이고, 화자별로 재배열하면 그 맥락이 깨진다.
 *   (프론트 하이라이트는 발화 단위 부분일치라 순서에 영향받지 않는다.)
 *   컬럼명 `agent_utterance` 는 스키마 변경 없이 그대로 둔다.
 */
function agentQuoteOf(ev) {
    const judgment = safeStr(ev?.judgment);
    if (!safeList(ev?.deductions).length && NO_OCCURRENCE_MARKERS.some((m) => judgment.includes(m))) {
        return '';
    }
    const picked = [];
    const seen = new Set();
    for (const q of safeList(ev?.evidence)) {
        if (!q || typeof q !== 'object') continue;
        const quote = safeStr(q.quote).trim();
        if (!quote || seen.has(quote)) continue;
        const speaker = safeStr(q.speaker).toLowerCase();
        if (speaker.includes('system') || SYSTEM_QUOTE_MARKERS.some((m) => quote.includes(m))) continue;
        // 화자 무관(상담사·고객·마커 없음) 전부 채택 — system placeholder 만 위에서 걸렀다.
        seen.add(quote);
        picked.push(quote);
    }
    return picked.join('\n');
}

/**
 * 단일 항목 reason_text → 판정 사유(judgment)만.
 *   "평가 이유" = LLM 판정 사유. 감점 사유 prose 는 judgment 와 중복 + 행의 AI평가 점수(예 0/5)로
 *   이미 표현되므로 미포함 (감점 사유 개편 — 한 셀에 뭉치지 않게 분리/제거).
 *   judgment 부재 시에만 감점 사유로 폴백(정보 손실 방지). 둘 다 없으면 빈 문자열('-' 폴백은 프론트).
 */
function reasonTextOf(ev) {
    const judgment = safeStr(ev?.judgment).trim();
    if (judgment) return judgment;
    // judgment 부재 시에만 감점 사유 폴백 (judgment 있으면 중복이라 생략).
    const reasons = safeList(ev?.deductions)
        .map((d) => (d && typeof d === 'object' ? safeStr(d.reason).trim() : ''))
        .filter(Boolean);
    return reasons.join('; ');
}

/**
 * /evaluate 응답 → 표준 18항목 행 변환. 9-order 환산 없음 — item_number 1:1.
 *   order_no ← item_number(1~18), ai_eval ← score(스케일 없음, snap 은 파이프라인 책임),
 *   category/item/max ← STANDARD_ITEM_CATALOG, validation_time='배점 '+max,
 *   reason_text ← judgment+deductions, agent_utterance ← evidence(상담사 화자).
 *   #3 / score null / 응답 미존재 항목은 생략 + warnings. 백분율은 존재 행 기준.
 * @returns {{ checklist, evaluations, ai_score, warnings, source }}
 */
function mapEvaluateResponseStandard(resp, maxByOrder = null, additiveMeta = null) {
    const warnings = [];
    const { byItem, source } = indexEvaluations(resp);
    if (byItem.size === 0) {
        warnings.push('응답에서 평가 항목(item_scores / categories.items)을 찾지 못함');
    }

    const checklist = [];
    const evaluations = [];
    let sumEarned = 0;
    let sumMax = 0;
    // 전량 평가불가(모든 항목 score=null) 감지용 카운터 — 미적재 게이트 신호(Rubric 매퍼와 동형).
    let nullCount = 0;
    let nonCriteriaNull = false; // null 항목 중 flag!=='no_criteria' 가 하나라도 있으면 true

    for (const slot of STANDARD_ITEM_CATALOG) {
        const orderNo = slot.order_no;
        if (STANDARD_SKIP_ORDERS.has(orderNo)) {
            warnings.push(`order ${orderNo}: 파이프라인 미산출 항목 → 행 생략`);
            continue;
        }
        const ev = byItem.get(orderNo);
        if (!ev) {
            warnings.push(`order ${orderNo}: item_number #${orderNo} 응답에 없음 → 행 생략`);
            continue;
        }
        const score = asScore(ev.score);
        if (score === null) {
            nullCount += 1;
            if (safeStr(ev?.flag).trim() !== 'no_criteria') nonCriteriaNull = true;
            warnings.push(`order ${orderNo}: item_number #${orderNo} score=null/skipped → 행 생략`);
            continue;
        }
        const aiEval = round1(score);
        // 항목 만점: DB 루브릭 max(maxByOrder, 운영자 만점 편집 반영) 우선 → 카탈로그 slot.max 폴백.
        // maxByOrder 미제공/항목 미포함이면 slot.max → 기존과 byte-identical(무회귀). 코오롱은 DB
        // max(#2=5·#4=20 등)가 카탈로그와 일치 → 80 보존, #N 만점 편집 시 그 항목만 분모 동적 반영.
        const _dynMax = maxByOrder ? asNumber(maxByOrder[orderNo]) : null;
        const itemMax = _dynMax !== null && _dynMax > 0 ? _dynMax : slot.max;
        sumEarned += aiEval;
        sumMax += itemMax;

        checklist.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            agent_utterance: agentQuoteOf(ev),
            validation_time: `배점 ${itemMax}`,
        });
        evaluations.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            reason_text: reasonTextOf(ev),
            ai_eval: aiEval,
            manual_eval: aiEval, // 기존 ingest 관행: manual_eval = ai_eval 복사 (NOT NULL)
        });
    }

    // 추가항목(order_no≥19, 코오롱 표준+추가항목 트랙) 행 추가 — 표준 카탈로그(#1~18) 미포함이라
    // 기존엔 행 통째 누락(점수·표시 증발). additiveMeta(MTG 가 동봉한 추가항목 메타)에 한해서만
    // 렌더 → KMS(1001~)/Layer4(2001~)/KSQI(6001~) 가상항목 오출력 방지. 표시 분모 = displayMax
    // (만점 폼 필드) 우선 → ev.display_max(백엔드 에코) → ev.max_score(채점 척도) → 5 폴백.
    // 점수(분자)=ev.score(프롬프트 척도 snap값) 그대로 → "LLM점수 / 만점필드(표시)" 표기.
    if (additiveMeta && typeof additiveMeta === 'object') {
        const addOrders = Object.keys(additiveMeta)
            .map((k) => asNumber(k))
            .filter((n) => n !== null)
            .sort((a, b) => a - b);
        for (const ono of addOrders) {
            const ev = byItem.get(ono);
            if (!ev) {
                warnings.push(`additive order ${ono}: 응답에 없음 → 행 생략`);
                continue;
            }
            const score = asScore(ev.score);
            if (score === null) {
                warnings.push(`additive order ${ono}: score=null/skipped → 행 생략`);
                continue;
            }
            const slot = additiveMeta[ono] || {};
            const aiEval = round1(score);
            const itemMax = (() => {
                const dm = asNumber(slot.display_max);
                if (dm !== null && dm > 0) return dm;
                const be = asNumber(ev.display_max);
                if (be !== null && be > 0) return be;
                const ms = asNumber(ev.max_score);
                return ms !== null && ms > 0 ? ms : 5;
            })();
            // ★ 2026-07-14: 추가항목도 Y/N 이면 총점·체크리스트 제외 (루브릭 매퍼와 동일 정책 —
            //   목록 분모 파서가 체크리스트 행을 배점 합산하므로 행 부재만이 분모 제외 수단).
            //   additiveMeta 에 scoring_type 미동봉이면 기존과 byte-identical (무회귀).
            const isYesNoAdd = safeStr(slot.scoring_type).trim().toLowerCase() === 'yes_no';
            if (!isYesNoAdd) {
                sumEarned += aiEval;
                sumMax += itemMax;
                checklist.push({
                    order_no: ono,
                    category: safeStr(slot.category).trim(),
                    item: safeStr(slot.item).trim() || itemNameOf(ev),
                    agent_utterance: agentQuoteOf(ev),
                    validation_time: `배점 ${itemMax}`,
                });
            }
            evaluations.push({
                order_no: ono,
                category: safeStr(slot.category).trim(),
                item: safeStr(slot.item).trim() || itemNameOf(ev),
                reason_text: reasonTextOf(ev),
                ai_eval: aiEval,
                manual_eval: aiEval,
            });
        }
    }

    // 전량 평가불가(평가는 시도했으나 모든 항목 score=null) 감지 → 미적재 게이트(B 정책)용 신호.
    // 진짜 포기호(byItem.size===0)는 nullCount=0 이라 false. 부분 평가불가는 evaluations.length>0 라 false.
    const allUnevaluable = byItem.size > 0 && evaluations.length === 0 && nullCount > 0;
    const aiScore = sumMax > 0 && Number.isFinite(sumEarned) ? round1((100 * sumEarned) / sumMax) : 0;
    return {
        checklist,
        evaluations,
        ai_score: aiScore,
        raw_total: round1(sumEarned),
        max_total: sumMax,
        warnings,
        source,
        item_count: byItem.size,
        all_unevaluable: allUnevaluable,
        unevaluable_count: nullCount,
        unevaluable_reason: allUnevaluable ? (nonCriteriaNull ? 'unevaluable' : 'no_criteria') : null,
    };
}


/**
 * 루브릭 트랙 /evaluate 응답 → 테넌트 평가항목 행 변환.
 *   응답 항목의 item_number(>=5000) 를 index(번호-5000) → rowMeta[index] 로 환원.
 *   category/item/order_no/만점 모두 테넌트의 eval_item_defs(rowMeta) 그대로 적재 —
 *   코오롱 표준 카탈로그 이름으로 치환하지 않는다 (타 테넌트 화면 집계 정합).
 *   ai_eval=score 직결(스케일 없음), reason_text=judgment+deductions, agent_utterance=evidence(상담사).
 *
 * 5000번대 항목이 하나도 없으면(루브릭 미적용 폴백) null 반환 → 호출부가 표준 매핑으로 폴백.
 * rowMeta 길이 ≠ 응답 5000번대 항목 수면(편집 직후 PUT↔평가 desync 등 index→order_no 비신뢰)
 *   null 반환 → 호출부 표준 1:1 매핑 강제 폴백(점수 오귀속 무음 오류 방지).
 *
 * @param {object} resp /evaluate 응답
 * @param {Array<{order_no:number, category:string, item:string, max_score:number}>} rowMeta 루브릭 index → 테넌트 항목 메타
 * @returns {{ checklist, evaluations, ai_score, raw_total, max_total, warnings, source }|null}
 */
function mapEvaluateResponseRubric(resp, rowMeta) {
    const warnings = [];
    const { byItem, source } = indexEvaluations(resp);

    // 5000번대 항목만 추출(index 오름차순).
    const rubricRows = [];
    for (const [num, ev] of byItem.entries()) {
        if (num >= RUBRIC_ITEM_BASE) rubricRows.push({ index: num - RUBRIC_ITEM_BASE, ev });
    }
    if (rubricRows.length === 0) {
        // 루브릭 미적용 — 호출부가 표준 매핑으로 폴백.
        return null;
    }
    rubricRows.sort((a, b) => a.index - b.index);

    const meta = Array.isArray(rowMeta) ? rowMeta : [];
    // 길이 불일치 = rowMeta(defs 파생) 와 파이프라인이 실제 평가한 루브릭 항목 수가 다름.
    // (편집 직후 PUT↔평가 윈도우 등) index→order_no 매핑을 신뢰할 수 없어 점수 오귀속 위험 →
    // null 반환으로 호출부가 표준 1:1 매핑으로 강제 폴백(무음 오류 방지).
    if (meta.length !== rubricRows.length) {
        return null;
    }

    const checklist = [];
    const evaluations = [];
    let sumEarned = 0;
    let sumMax = 0;
    let rawTotal = 0;
    // 전량 평가불가(모든 항목 score=null) 감지용 카운터 — 미적재 게이트(B 정책) 신호.
    // null 항목은 기존대로 드롭(부분 평가불가는 byte-identical). 전량 null 이면 게이트가 미적재+사유 표면화.
    let nullCount = 0;
    let nonCriteriaNull = false; // null 항목 중 flag!=='no_criteria' 가 하나라도 있으면 true

    for (const { index, ev } of rubricRows) {
        const slot = meta[index];
        const orderNo = asNumber(slot?.order_no);
        if (!slot || orderNo === null) {
            warnings.push(`루브릭 index ${index}: rowMeta 매핑 없음 → 행 생략`);
            continue;
        }
        const score = asScore(ev.score);
        if (score === null) {
            nullCount += 1;
            if (safeStr(ev?.flag).trim() !== 'no_criteria') nonCriteriaNull = true;
            warnings.push(`루브릭 index ${index} → order_no ${orderNo}: score=null/skipped → 행 생략`);
            continue;
        }
        // 항목 표시 분모 = rowMeta(defs) 만점 우선 — '만점 폼 필드' 를 LLM 채점 스케일(ev.max_score)과
        // 완전 분리해 표시한다(신규 브랜드 decouple, 사용자 결정 2026-06-22). 파이프라인엔 프롬프트
        // 최상위 단계가 max_score 로 가서 채점이 깨끗이 snap 되고(ev.score=분자), 분모는 운영자가 편집한
        // 만점(rowMeta.max_score)으로 표시 → "분자(프롬프트 점수) / 분모(만점 폼 필드)".
        // 레거시·ecom·bank 는 buildRubricFromDefs 에서 slot.max_score==ev.max_score 라 동작 무변경.
        // rowMeta 는 평가 시점 스냅샷이라 '평가-시점 만점 동결' 의미도 보존.
        const itemMax = (() => {
            const dm = asNumber(slot.max_score);
            if (dm !== null && dm > 0) return dm;
            const m = asNumber(ev.max_score);
            return m !== null && m > 0 ? m : 5;
        })();
        // ★ 감점 항목(만점 0 · 음수 단계) 식별 — 키움 #5 고객정보확인 · #9 고객배려 및 호응 ·
        //   #10 소비자보호 고지의무는 원문 평가표가 0점/-5점 구조라 defs 만점과 채점 스케일이 모두 0 이다.
        //   위 itemMax 폴백이 이 경우 5 를 돌려주므로 그대로 두면
        //     ① 분모에 5×3=15 가 붙어 콜 만점이 100 → 115 로 부풀고
        //     ② 체크리스트 행의 '배점 5' 가 eval_item_score.max_score=5 로 굳어 감점 -5 가
        //        '5점 만점에 0점' 으로 클램프 표기된다(parseStoredEarned 하한 0).
        //   Y/N 항목과 동일하게 분자에만 반영하고 분모에서 제외한다(체크리스트 행 미생성 →
        //   eval_item_score.max_score=NULL). 감점 점수는 evaluations 로 그대로 적재된다.
        //   만점이 양수인 기존 브랜드(레거시·ecom·bank·코오롱)는 declaredMax>0 이라 무영향.
        const isDeductionItem = (() => {
            const dm = asNumber(slot.max_score);
            if (dm !== 0) return false;
            const m = asNumber(ev.max_score);
            return m === null || m <= 0;
        })();
        const aiEval = round1(score);
        // Y/N(컴플라이언스 체크) 항목은 콜 총점(ai_score)·만점 합산에서 제외 — 점수 무관 순수 모니터링
        // (기획 docs/YN_EVAL_ITEM_PLAN §4.2). 평가 행(evaluations)만 기록 →
        // qa_call_item_score 에 충족(ai_eval>0)/미충족(ai_eval=0)으로 남아 위반율 집계·상세 Y/N 표시에 사용.
        // ★ 2026-07-14: Y/N 항목은 max_score=NULL(분모 제외) — 10.13 배포 대시보드 목록 분모 파서
        //   (parseMaxPointsFromValidationTime)가 체크리스트 행을 무조건 배점(최소 5)으로 합산해
        //   금지어 행이 있으면 합계가 /105 로 표기됨 (0713 RCA: 분모 제외는 행 부재만 가능).
        //   총점(ai_score)은 이미 Y/N 제외라 체크리스트 생략이 점수 무영향.
        const isYesNo = safeStr(slot.scoring_type).trim().toLowerCase() === 'yes_no';
        if (!isYesNo && isDeductionItem) {
            // 감점 항목 — 분자만 가산(음수 그대로). 분모·체크리스트 제외.
            rawTotal += aiEval;
            sumEarned += aiEval;
        } else if (!isYesNo) {
            rawTotal += aiEval;
            sumEarned += aiEval;
            sumMax += itemMax;

            checklist.push({
                order_no: orderNo,
                category: slot.category,
                item: slot.item,
                agent_utterance: agentQuoteOf(ev),
                validation_time: `배점 ${itemMax}`,
            });
        }
        evaluations.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            reason_text: reasonTextOf(ev),
            ai_eval: aiEval,
            manual_eval: aiEval,
        });
    }

    // 전량 평가불가(평가는 시도했으나 모든 항목 score=null) 감지 → 미적재 게이트(B 정책) 신호.
    // 진짜 포기호(byItem.size===0)는 nullCount=0 이라 false. 부분 평가불가는 evaluations.length>0 라 false.
    const allUnevaluable = byItem.size > 0 && evaluations.length === 0 && nullCount > 0;
    const aiScore = sumMax > 0 && Number.isFinite(sumEarned) ? round1((100 * sumEarned) / sumMax) : 0;
    return {
        checklist,
        evaluations,
        ai_score: aiScore,
        raw_total: round1(rawTotal),
        max_total: sumMax,
        warnings,
        source,
        // 포기호(item_count===0) vs 전량 평가불가(item_count>0 + all_unevaluable) 구분 신호.
        item_count: byItem.size,
        all_unevaluable: allUnevaluable,
        unevaluable_count: nullCount,
        unevaluable_reason: allUnevaluable ? (nonCriteriaNull ? 'unevaluable' : 'no_criteria') : null,
    };
}

/**
 * 통합DB: call.org_id(=tenant_id 문자열) 우선, 없으면 call.brand_name → common.tenants.name 조회.
 * 표준 트랙은 브랜드(테넌트) 귀속 필수 — 둘 다 없거나 조회 실패 시 에러.
 * @returns {Promise<string>} 해석된 tenant_id(citext, 소문자)
 */
async function resolveStandardOrgId(pool, call) {
    const direct = safeStr(call?.org_id).trim().toLowerCase();
    if (direct) return direct;

    const brandName = safeStr(call?.brand_name).trim();
    if (!brandName) {
        throw new Error('표준 트랙은 call.org_id(tenant_id) 또는 call.brand_name 이 필요합니다.');
    }
    const { rows } = await pool.query('SELECT tenant_id FROM common.tenants WHERE name = $1 LIMIT 1', [brandName]);
    const found = safeStr(rows?.[0]?.tenant_id).trim();
    if (!found) {
        throw new Error(`브랜드 '${brandName}' 가 common.tenants 에 없습니다. 먼저 브랜드를 등록하세요.`);
    }
    return found;
}

/**
 * 표준 18항목 트랜잭션 적재. qa_call_pentagon_result 는 쓰지 않음(분석 라우트 fallback 생성).
 * 멱등: 자식 DELETE WHERE "ID"=$1 후 재삽입 + qa_calls ON CONFLICT DO UPDATE(org_id/department/role 포함).
 * @returns {Promise<{ok, qa_id, ai_score, total_score, role, department, org_id, turns}>}
 */
export async function ingestStandardCallToDb(pool, call, mapped) {
    const id = safeStr(call?.qa_id ?? call?.consultation_id ?? call?.id).trim();
    if (!id) return { ok: false, message: 'call.id(qa_id/consultation_id) 가 필요합니다.' };

    // 포기호/미응대 게이트: 파이프라인이 평가 산출물(평가행·체크리스트)을 하나도 만들지
    // 못한 콜(상담사 미연결 등)은 QA 대상이 아니므로 qa_calls 에 적재하지 않는다.
    // (화자분리 오인식된 실제 응대콜은 평가행이 산출되므로 정상 적재됨.)
    const hasEval = Array.isArray(mapped?.evaluations) && mapped.evaluations.length > 0;
    const hasChecklist = Array.isArray(mapped?.checklist) && mapped.checklist.length > 0;
    if (!hasEval && !hasChecklist) {
        // (1) 진짜 포기호/미응대: 파이프라인이 항목평가를 0건(item_count===0=item_scores 자체 빔,
        //     상담사 미연결) 산출 → 기존대로 skip(무회귀·byte-identical). asdf·실제 미응대 콜이 여기 해당.
        const itemCount = asNumber(mapped?.item_count) || 0;
        if (itemCount === 0) {
            return { ok: true, skipped: true, qa_id: id, turns: 0,
                     reason: '포기호/미응대(평가 산출물 없음) — 적재 안 함' };
        }
        // (2) 전량 평가불가: 파이프라인이 항목평가는 시도(item_count>0)했으나 전 항목 score=null
        //     (기준 미입력/STT불가 등) → 진짜 포기호와 구분해 미적재(B 정책) + 사유 표면화.
        //     skipped.reason 에 'unevaluable_all' 태깅(리드/PM) → 라우트가 '포기호' 아닌 '평가불가'로 노출.
        //     desync(5000번대 존재, rowMeta 길이 불일치)는 별도 사유로 표면화(점수 오귀속 방지).
        const _ur = mapped?.unevaluable_reason;
        const _sub = _ur === 'no_criteria' ? '기준 미입력' : _ur === 'desync' ? '루브릭 매핑 불일치' : '전항목 평가불가/STT불가';
        return { ok: true, skipped: true, qa_id: id, turns: 0, unevaluable: true,
                 reason: `unevaluable_all(${_sub}) — 적재 안 함` };
    }

    const orgId = await resolveStandardOrgId(pool, call);

    const cdate =
        safeStr(call?.cdate).trim() ||
        safeStr(call?.call_datetime).trim() ||
        new Date().toISOString();
    const callSeq = safeStr(call?.call_seq).trim() || id;
    const uid = safeStr(call?.uid).trim() || id;
    // 점수 적재 = 항목 획득점 합계(raw_total, 예: 80점 만점에 69점) — 시드 데이터의
    // 합계 의미와 일치. 백분율(ai_score)을 그대로 저장하면 만점(80)보다 큰 값이
    // 표기돼 혼란 (86 사례). raw_total 미산출 폴백 시에만 ai_score 사용.
    const score = asNumber(mapped.raw_total) !== null ? mapped.raw_total : mapped.ai_score;

    // 부서 귀속 — input 명시 > 브랜드 기존 콜 최다 부서 > 기본 상수. 하드코딩(고객지원실)
    // 시 테넌트 목록 화면(부서 필터)에 신규 평가가 보이지 않는 문제 방지.
    let department = safeStr(call?.department).trim();
    if (!department) {
        try {
            const { rows } = await pool.query(
                `SELECT e.department
                   FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                  WHERE c.tenant_id = $1 AND e.department IS NOT NULL AND e.department <> ''
                  GROUP BY e.department ORDER BY COUNT(*) DESC, e.department ASC LIMIT 1`,
                [orgId]
            );
            department = safeStr(rows?.[0]?.department).trim();
        } catch {
            department = '';
        }
    }
    if (!department) department = STANDARD_DEPARTMENT;
    const role = safeStr(call?.role).trim() || STANDARD_ROLE;
    // ICS 등 외부 소스 매핑 키(08 Organization.proj_cd 와 동형) — 없으면 null.
    const projCd = safeStr(call?.proj_cd).trim() || null;

    // 담당 상담사 해석: agent_code(ICS user_m.USER_CD) → common.users(로그인아이디 '{code}@{proj}' = 이메일에서 .ics 제거, icsSso 규칙).
    // 매칭 계정이 아직 없으면 agent_user_id=NULL(미지정) — agent_code 는 보관해 추후 SSO 로그인 시 연결/추적.
    const agentCode = safeStr(call?.agent_code).trim() || null;
    // 채널구분 'I'(인바운드)/'O'(아웃바운드) — ICS tb_stt_master.IO_DIVI. 그 외 값/없음은 NULL.
    const ioDiviRaw = safeStr(call?.io_divi).trim().toUpperCase();
    const ioDivi = ioDiviRaw === 'I' || ioDiviRaw === 'O' ? ioDiviRaw : null;
    // 통화 소요시간(초) — ICS CALL_END_DATE-CALL_START_DATE 차. 폴러가 call.duration_sec 로 전달.
    // 음수/비숫자/없음은 null(미상). 배치 "통화시간" 조건이 이 값을 선별에 사용.
    const durRaw = asNumber(call?.duration_sec);
    const durationSec = durRaw !== null && Number.isFinite(durRaw) && durRaw >= 0 ? Math.round(durRaw) : null;
    let agentUserId = null;
    if (agentCode && projCd) {
        try {
            // 통합DB: ICS 계정 이메일 규약 = {userCd}@{projCd}.ics (Stage1 icsSso). email(citext)로 직접 매칭.
            //   (username 은 일부 계정만 세팅돼 신뢰 불가 — 이메일이 ICS 신원 SSOT.)
            const { rows } = await pool.query(
                `SELECT id AS user_id FROM common.users WHERE email = $1 LIMIT 1`,
                [`${agentCode}@${projCd}.ics`]
            );
            agentUserId = rows?.[0]?.user_id ?? null;
        } catch {
            agentUserId = null;
        }
    }

    // 대화 turns — collection 과 동일 정규화(고객/상담사, turn_no).
    const convIn = safeList(call?.transcript).length ? safeList(call.transcript) : safeList(call?.conversation);
    const conversation = [];
    let nextTurn = 1;
    for (const t of convIn) {
        if (!t || typeof t !== 'object') continue;
        const text = safeStr(t.text ?? t.utterance ?? t.content).trim();
        if (!text) continue;
        const speakerRaw = safeStr(t.speaker ?? t.role).trim();
        const speaker = speakerRaw.includes('고객') ? '고객' : '상담사';
        const turnNo = asNumber(t.turn_no) !== null ? Math.trunc(asNumber(t.turn_no)) : nextTurn;
        conversation.push({ turn_no: turnNo, speaker, text });
        nextTurn = Math.max(nextTurn, turnNo) + 1;
    }

    // 통합DB write-split: id(=call.qa_id/consultation_id 텍스트)=source_id, 자연키=(tenant_id, uid).
    //   ① common.calls upsert(tenant_id/uid/source_id/헤더컬럼) RETURNING call_id
    //   ② qa_evaluations upsert(call_id/AI_SCORE/TOTAL_SCORE/department/role/is_sandbox)
    //   ③ 자식(eval_pentagon_result·eval_item_score·common.call_transcript) call_id 삭제·재적재.
    //   proj_cd 는 common.calls 에 별도 컬럼 없음(tenant_id 가 곧 proj_cd) → source_id/uid 로만 보존.
    let callId = null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: cc } = await client.query(
            `INSERT INTO common.calls
                 (tenant_id, uid, source_id, call_seq, cdate, io_divi, duration_sec, agent_code, agent_user_id, channel)
             VALUES ($1,$2,$3,$4, NULLIF(NULLIF($5::text,'0000-00-00 00:00:00'),'0000-00-00')::timestamptz, $6,$7,$8,$9,'call')
             ON CONFLICT (tenant_id, uid) DO UPDATE SET
               source_id = EXCLUDED.source_id,
               call_seq = EXCLUDED.call_seq,
               cdate = EXCLUDED.cdate,
               io_divi = COALESCE(EXCLUDED.io_divi, common.calls.io_divi),
               duration_sec = COALESCE(EXCLUDED.duration_sec, common.calls.duration_sec),
               agent_code = EXCLUDED.agent_code,
               agent_user_id = EXCLUDED.agent_user_id,
               updated_at = now()
             RETURNING call_id`,
            [orgId, uid, id, callSeq, cdate, ioDivi, durationSec, agentCode, agentUserId]
        );
        callId = cc[0].call_id;
        await client.query(
            `INSERT INTO trustguard.qa_evaluations
                 (call_id, "AI_SCORE", "TOTAL_SCORE", department, role, ai_analysis_target, ai_analysis_reason, is_sandbox)
             VALUES ($1,$2,$3,$4,$5,NULL,NULL,false)
             ON CONFLICT (call_id) DO UPDATE SET
               "AI_SCORE" = EXCLUDED."AI_SCORE",
               "TOTAL_SCORE" = EXCLUDED."TOTAL_SCORE",
               department = EXCLUDED.department,
               role = EXCLUDED.role,
               ai_analysis_target = NULL,
               ai_analysis_reason = NULL,
               is_sandbox = false`,
            [callId, score, score, department, role]
        );
        await client.query(`DELETE FROM eval_pentagon_result WHERE call_id = $1`, [callId]);
        // 재적재는 채점 결과를 덮어쓰지만 '스킬 학습 제외' 지정(사람의 결정)은 보존한다.
        const _sticky = await captureSticky(client, callId);
        await client.query(`DELETE FROM eval_item_score WHERE call_id = $1`, [callId]);
        // KMS 필수사항 체크(kiwoom_coverage) 원문 적재 — 평가 결과 [KMS] 탭 데이터 소스.
        //   블록 부재(커버리지 게이트 OFF · 타 브랜드)면 아무것도 하지 않는다 → 무회귀.
        //   재평가 시 전량 교체(콜 1건 = 1행). 60_qa_kms_results.sql 참조.
        if (mapped?.kiwoom_coverage && typeof mapped.kiwoom_coverage === 'object') {
            await client.query(
                `INSERT INTO trustguard.qa_kms_results (call_id, payload, updated_at)
                      VALUES ($1, $2::jsonb, now())
                 ON CONFLICT (call_id) DO UPDATE
                    SET payload = EXCLUDED.payload, updated_at = now()`,
                [callId, JSON.stringify(mapped.kiwoom_coverage)]
            );
        }
        await client.query(`DELETE FROM common.call_transcript WHERE call_id = $1`, [callId]);
        // 전사 + 항목별 평가 적재 — 각각 다중행 INSERT 1회. 항목 점수·근거는 eval_item_score 한 테이블 병합.
        await insertTranscriptRows(client, callId, conversation);
        await insertItemScoreRows(client, callId, mapped.evaluations, mapped.checklist);
        await restoreSticky(client, callId, _sticky);

        // 펜타곤 축별 정성평가 적재 — 백엔드(pure pure_pentagon)가 생성한 축별 {rating,analysis,summary}
        // 를 qa_call_pentagon_result 에 기록 → 분석 라우트(GET /api/analysis)가 점수밴드 보일러플레이트
        // (buildDynamicFallbackReportRows) 대신 LLM 분석을 표시. axis_number→item_type_no, name→item_type,
        // analysis→comment(NOT NULL), summary→summary. 비-pentagon 브랜드(pentagon 미수신)는 미적재 →
        // 읽기 라우트 폴백 유지(무회귀). 99 종합의견 행은 읽기 라우트가 첫 축 summary 로 자동 부여(중복 방지 미적재).
        const pentagonAxes = Array.isArray(mapped?.pentagon?.axes) ? mapped.pentagon.axes : [];
        for (const ax of pentagonAxes) {
            if (!ax || typeof ax !== 'object') continue;
            const axisNo = asNumber(ax.axis_number);
            if (axisNo === null) continue;
            const itemType = safeStr(ax.name).trim() || `축 ${Math.trunc(axisNo)}`;
            const rating = safeStr(ax.rating).trim() || null;
            const summary = safeStr(ax.summary).trim() || null;
            // comment 는 NOT NULL — 분석 비면 요약으로 폴백, 그것도 없으면 적재 스킵(보일러플레이트 회피).
            const comment = safeStr(ax.analysis).trim() || summary || '';
            if (!comment) continue;
            await client.query(
                `INSERT INTO eval_pentagon_result (call_id, item_type_no, item_type, rating, comment, summary)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [callId, Math.trunc(axisNo), itemType, rating, comment, summary]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    // KSQI STT 보고서 적재(보조 축) — 브랜드 채점(위 트랜잭션 COMMIT 완료)과 분리한 별도 트랜잭션.
    // 일반 평가와 동형의 2테이블에 저장: qa_call_ksqi_score(항목 점수·사유 + 근거 evidence jsonb)
    // + qa_call_ksqi_summary(영역 A/B·전체 집계). 재적재는 DELETE 후 INSERT 로 멱등.
    // 테이블 부재/실패는 조용히 스킵해 브랜드 적재에 영향 주지 않는다(보조 모듈 = 메인 무영향 원칙).
    // 스키마는 docker/init/postgres-unified/01_unified_schema.sql (trustguard.eval_ksqi_score/summary).
    // ★ 2026-09-02 — `kind` 컬럼은 13_drop_ksqi_kind.sql 로 제거됐다(판정 방식 SSOT = 파이프라인 rules.py).
    //   그 마이그레이션 헤더가 "코드 → DDL 순서" 를 요구했는데 INSERT 가 kind 를 계속 넣어
    //   `column "kind" of relation "eval_ksqi_score" does not exist` 로 **KSQI 적재가 전량 조용히 스킵**됐다
    //   (토글 ON·파이프라인 12항목 산출 정상인데 상세 ksqi_report=null·목록 has_ksqi=false). kind 를 뺀다.
    if (mapped?.ksqi_report) {
        const kr = mapped.ksqi_report;
        const kc = await pool.connect();
        try {
            await kc.query('BEGIN');
            await kc.query('DELETE FROM eval_ksqi_score WHERE call_id = $1', [callId]);
            await kc.query('DELETE FROM eval_ksqi_summary WHERE call_id = $1', [callId]);
            const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
            const items = Array.isArray(kr.items) ? kr.items : [];
            for (const it of items) {
                const itemNo = Math.trunc(Number(it?.item_number));
                if (!Number.isFinite(itemNo)) continue;
                // 근거 발화는 항목 행에 인라인(구 qa_call_ksqi_evidence 흡수) — 배열 순서가 곧 구 seq.
                const evs = (Array.isArray(it?.evidence) ? it.evidence : []).map((e) => ({
                    speaker: safeStr(e?.speaker),
                    quote: safeStr(e?.quote),
                }));
                await kc.query(
                    `INSERT INTO eval_ksqi_score (call_id, item_number, item_name, area, score, max_score, na, defect, rationale, evidence)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
                     ON CONFLICT (call_id, item_number) DO NOTHING`,
                    [
                        callId,
                        itemNo,
                        safeStr(it?.item_name),
                        safeStr(it?.area),
                        num(it?.score),
                        num(it?.max_score),
                        it?.na === true,
                        it?.defect === true,
                        safeStr(it?.rationale),
                        JSON.stringify(evs),
                    ]
                );
            }
            await kc.query(
                `INSERT INTO eval_ksqi_summary (call_id,
                    area_a_raw, area_a_max, area_a_scaled, area_a_grade, area_a_excellent,
                    area_b_raw, area_b_max, area_b_scaled, area_b_grade, area_b_excellent,
                    overall_raw, overall_max, summary)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [
                    callId,
                    num(kr.area_a?.raw),
                    num(kr.area_a?.max),
                    num(kr.area_a?.scaled),
                    kr.area_a?.grade ?? null,
                    typeof kr.area_a?.excellent === 'boolean' ? kr.area_a.excellent : null,
                    num(kr.area_b?.raw),
                    num(kr.area_b?.max),
                    num(kr.area_b?.scaled),
                    kr.area_b?.grade ?? null,
                    typeof kr.area_b?.excellent === 'boolean' ? kr.area_b.excellent : null,
                    num(kr.overall?.raw),
                    num(kr.overall?.max),
                    safeStr(kr.summary),
                ]
            );
            await kc.query('COMMIT');
        } catch (e) {
            try {
                await kc.query('ROLLBACK');
            } catch {}
            console.warn(`[ingest] KSQI 정규화 테이블 적재 스킵 (ID=${id}, 테이블 부재 가능): ${e.message}`);
        } finally {
            kc.release();
        }
        // 통합DB: 구 qa_calls.ksqi_report(전환기 jsonb 이중기록) 제거 — eval_ksqi_summary/score 가 SSOT.
    }

    return {
        ok: true,
        qa_id: id,
        ai_score: score,
        total_score: score,
        role,
        department,
        org_id: orgId,
        turns: conversation.length,
    };
}

/**
 * 브랜드별 KSQI-STT 토글 = trustguard.tenant_settings.ksqi_stt_enabled (brandRoutes.mjs 와 같은 자리).
 *
 * ★ 2026-09-02 결함 수정 — 종전엔 이 함수가 **무조건 false** 를 돌려주는 스텁이었다(통합DB 전환기 잔재).
 *   시스템 설정의 KSQI 토글(Settings.jsx → PATCH /admin/organizations → tenant_settings)은 정상 저장되고
 *   'KSQI 평가' 탭도 그 값으로 열리는데, 평가 요청엔 항상 `ksqi_stt_enabled:false` 가 실려 파이프라인이
 *   KSQI-STT 를 돌리지 않았다 → resp.ksqi_stt_report 부재 → eval_ksqi_summary 0행 → KSQI 목록(has_ksqi) 영구 공백.
 *   표/컬럼 부재 DB(구 스키마)에서는 종전과 같이 false (무회귀).
 */
let _ksqiToggleColumnCache = null;
async function getOrgKsqiSttEnabled(pool, orgId) {
    const tenantId = String(orgId ?? '').trim().toLowerCase();
    if (!tenantId || !pool) return false;
    try {
        if (_ksqiToggleColumnCache === null) {
            const { rows } = await pool.query(
                `SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'trustguard' AND table_name = 'tenant_settings'
                   AND column_name = 'ksqi_stt_enabled' LIMIT 1`
            );
            _ksqiToggleColumnCache = rows.length > 0;
        }
        // ★ 2026-09-02 — 표 부재 DB(로컬·54.235)는 brandRoutes 와 같은 폴백 자리
        //   trustguard.qa_batch_configs.config.ksqi_stt_enabled 를 읽는다(종전 "false 고정" 이 토글 무효의 원인).
        const { rows } = _ksqiToggleColumnCache
            ? await pool.query(
                  'SELECT ksqi_stt_enabled AS v FROM trustguard.tenant_settings WHERE tenant_id = $1 LIMIT 1',
                  [tenantId]
              )
            : await pool.query(
                  `SELECT (config ->> 'ksqi_stt_enabled')::boolean AS v
                     FROM trustguard.qa_batch_configs WHERE tenant_id = $1 LIMIT 1`,
                  [tenantId]
              );
        return rows[0]?.v === true;
    } catch (e) {
        console.warn(`[ingest] ksqi_stt_enabled 조회 실패 (tenant=${tenantId}) — false 로 진행: ${e.message}`);
        return false;
    }
}

/**
 * 표준 트랙 단일 콜: /evaluate 호출(callQaPipeline 재사용) → 18항목 매핑 → DB 적재.
 *   루브릭 연동(DB 소스): metadata.org_id 를 페이로드에 실으면 백엔드(QA_RUBRIC_SOURCE=db)가
 *   eval_item_defs 를 직접 읽어 custom_rubric 트랙(5000번대) 으로 평가하고,
 *   응답을 index(번호-5000)→orderMap(buildRubricFromDefs 로컬 산출) 으로 표준 18항목에 환원해 적재.
 *   5000번대가 없으면(루브릭 미적용) 기존 표준 매핑으로 자동 폴백.
 *   /evaluate 응답의 kms 블록은 무시(dev프론트 미저장, 백엔드 KMS 노드는 유지).
 * @returns {Promise<{ok, qa_id, ai_score, total_score, role, department, org_id, turns, elapsed_sec, warnings, source}>}
 */
/**
 * KMS 지정 평가항목 → 파이프라인 항목번호 목록.
 *
 * 사용자 지시(2026-08-31): **"kms에 체크한 항목만 돌게 하는거라고"**. 화면(평가항목 관리 >
 * KMS 지정, `qa_batch_configs.config.kms.marked_items`)이 이미 갖고 있는 값을 파이프라인에
 * 그대로 넘긴다 — 종전에는 파이프라인이 서버 전역 env(`QA_PURE_KMS_RAG`,
 * `QA_PURE_KNOWLEDGE_ITEMS`)로만 돌아 브랜드별 지정과 어긋났다.
 *
 * 변환: `marked_items` 는 대시보드 order_no, 파이프라인은 `RUBRIC_ITEM_BASE + index`.
 *   index 는 rowMeta(=buildRubricFromDefs 산출) 에서의 위치다 — order_no 를 그대로 더하면
 *   비활성·삭제 항목이 있는 브랜드에서 어긋난다(order_no 는 연속을 보장하지 않는다).
 *
 * @returns {Promise<number[]|null>} 항목번호 배열(지정 0건이면 빈 배열) · 조회 실패 시 null.
 *   **null 과 빈 배열은 뜻이 다르다** — null = 미전달(파이프라인 env 폴백),
 *   [] = "체크 0건" 명시 OFF. 조회 실패에 [] 를 돌려주면 DB 한 번 삐끗한 것이 KMS 전면
 *   비활성으로 조용히 번진다. 계약 전문은 `v2/pure_llm/kms_scope.py` docstring.
 */
async function resolveKmsItemNumbers(pool, orgId, rowMeta) {
    try {
        const { rows } = await pool.query(
            `SELECT config -> 'kms' -> 'marked_items' AS marks
               FROM qa_batch_configs WHERE tenant_id = $1`,
            [orgId]
        );
        const marks = rows[0]?.marks;
        if (!Array.isArray(marks) || marks.length === 0) return [];
        const wanted = new Set(marks.map((n) => Number(n)).filter((n) => Number.isInteger(n)));
        const meta = Array.isArray(rowMeta) ? rowMeta : [];
        const out = [];
        meta.forEach((m, i) => {
            if (wanted.has(Number(m?.order_no))) out.push(RUBRIC_ITEM_BASE + i);
        });
        return out;
    } catch {
        return null; // 조회 실패 → 미동봉(무회귀). 위 @returns 주석의 사유 참조.
    }
}

/**
 * 엔진 호출 + 매핑만 수행(DB 미저장). 표준 트랙/커스텀 루브릭 분기 포함.
 * ingestStandardCallFromQaPipeline 와 외부 서비스(튜터 딥평가)가 공유하는 순수 평가 단계.
 * @returns {Promise<object>} mapped — { evaluations[], checklist[], raw_total, max_total, ai_score, source, warnings }
 */
export async function evaluateStandardCall(pool, call, opts = {}) {
    const warnings = [];

    // 루브릭 인라인 동봉(EC2/로컬 공통): 활성 테넌트의 eval_item_defs 로 루브릭을
    // 로컬 빌드해 metadata.rubric_inline 으로 요청에 직접 동봉한다. 백엔드
    // _resolve_rubric 이 인라인을 DB/파일 스토어보다 최우선 사용 — 대시보드 PG 에
    // 접근 불가한 원격(EC2) 백엔드에서도 프론트에서 선택한 테넌트의 평가항목
    // 그대로 평가됨을 보장. rowMeta 는 동일 빌드 결과로 산출 → 5000+index 환원 정합.
    //
    // 단, 항목 구성이 코오롱 표준 카탈로그와 동일한 테넌트는 인라인을 빼고 표준
    // 트랙으로 보낸다 — 표준 트랙은 항목별 튜닝 프롬프트(iter03_clean)로 평가
    // 품질·근거 인용이 우수하므로 범용 루브릭 평가로 다운그레이드하지 않는다.
    // 루브릭 빌드 실패 시도 표준 18항목 트랙 폴백(mapEvaluateResponseStandard).
    let rowMeta = [];
    let rubricCall = call;
    let standardMaxByOrder = null; // 코오롱 표준 폴백 매퍼 분모용 DB 루브릭 만점 맵({order_no:max})
    let additiveDisplayMeta = null; // 추가항목(order_no≥19) 표시 메타 맵({order_no:{category,item,display_max}})
    try {
        const orgId = await resolveStandardOrgId(pool, call);
        const { rubric, rowMeta: meta } = await buildRubricFromDefs(pool, orgId);
        if (rubric?.items?.length) {
            // [동작 불가 게이트] 신규 브랜드(id≥4) 한정 — 평가 기준(criterion/prompt) 미입력 활성
            // 항목이 하나라도 있으면 평가 실행 자체를 차단한다(빈 항목을 LLM 이 항목명만 보고 임의
            // 채점하는 사고 방지 — 2026-06-22 사용자 지시). 레거시(1~3)는 백엔드 정적 파일 프롬프트
            // 기반이라 DB criterion/prompt 가 비어도 정상 평가되므로 제외(무회귀). 차단 에러는 아래
            // catch 가 isUnconfiguredBlock 로 식별해 표준 폴백 없이 라우트로 재전파한다.
            if (!LEGACY_STANDARD_ORG_IDS.has(Number(orgId))) {
                const unconfigured = rubric.items.filter(
                    (it) => !safeStr(it.prompt_template).trim() && !safeStr(it.criteria_full).trim()
                );
                if (unconfigured.length) {
                    const names = unconfigured.map((it) => safeStr(it.name).trim() || '(이름없음)').join(', ');
                    const e = new Error(
                        `평가 기준이 입력되지 않은 항목이 있습니다: ${names}. 평가 기준을 입력한 뒤 다시 실행하세요.`
                    );
                    e.isUnconfiguredBlock = true;
                    throw e;
                }
            }
            rowMeta = meta || [];
            const items = rubric.items || [];
            // 항목을 3분류: standard(카탈로그 #1~18 매칭) / extra(order_no≥19 추가항목) / divergent
            // (order_no≤18 인데 카탈로그 비매칭 = 표준에서 벗어난 항목). items[i] 와 rowMeta[i] 는
            // buildRubricFromDefs 동일 루프 산출이라 index 정합.
            const standardIdx = [];
            const extraIdx = [];
            let hasDivergent = false;
            rowMeta.forEach((m, i) => {
                if (isStandardCatalogSlot(m)) standardIdx.push(i);
                else if (asNumber(m?.order_no) >= 19) extraIdx.push(i);
                else hasDivergent = true; // order_no≤18 비매칭 → 표준 트랙 아님(순수 custom)
            });
            // 표준 트랙 자격: 표준 항목이 1개 이상 + 카탈로그에서 벗어난 #1~18 항목 없음
            // (= 기존 .every() 매칭 의미 보존). 추가항목(order_no≥19)이 섞여 있어도 표준 항목은
            // 코오롱 튜닝 노드 유지(rubric_inline 미사용 → flip 방지). divergent 가 있으면(순수 타
            // 테넌트 자체 루브릭) 기존대로 full custom(rubric_inline) — 무회귀.
            // ★레거시(1~3)만 코오롱 표준 트랙 자격. 신규 브랜드(id≥4)는 항목이 카탈로그와
            // 일치해도 표준 트랙 진입 차단 → 아래 else 의 full custom(rubric_inline) 경로로.
            // ★ 코오롱(org3)만 레거시 풀 파이프라인(코오롱 튜닝 8노드 + KMS/coverage/debate/pentagon) 자격.
            //   신한(1)/한화(2)는 더 이상 표준 트랙이 아니라 아래 else 의 신규 순수 LLM 모듈(rubric_inline +
            //   eval_mode=pure)로 — 항목이 코오롱 카탈로그와 일치해도 표준 트랙 진입 차단.
            // 전 브랜드 pure 전환(2026-06-26 리드 결정): 코오롱(org3) 포함 표준(레거시 8노드) 트랙 휴면.
            // 아래 isKolonStandard 블록(prompt/max/step/additive overrides 빌드)은 dead 로 보존(삭제 금지·가역) —
            // 라우팅만 차단해 코오롱도 else 의 pure(rubric_inline + eval_mode=pure) 경로로 보낸다.
            // standardIdx/hasDivergent 산출은 남겨둠(레거시 블록 참조 보존, else 미사용 no-op).
            const isKolonStandard = false;
            if (isKolonStandard) {
                // 표준 트랙: rubric_inline 은 빼되(custom_rubric full flip 미트리거 → 코오롱
                // 3-페르소나 엔진 유지), 표준 항목의 DB 프롬프트를 prompt_overrides
                // ({order_no: prompt_template}) 로 동봉 → 백엔드 표준 노드가 정적 파일 대신 DB
                // 프롬프트로 평가. 빈 프롬프트(placeholder 정화)는 제외 → 백엔드 파일 프롬프트 폴백(무회귀).
                const promptOverrides = {};
                // 만점/단계 동적 동봉 — 활성 표준항목(#1~18 매칭) 전부. prompt_overrides 와 동일하게
                // order_no 키. max_overrides={order_no:max_score}, step_overrides={order_no:allowed_steps}.
                // 백엔드(dynmax-pipeline)가 contextvar 로 받아 분모/snap 단계를 동적 반영. canonical 과
                // 같아도 동봉(일관). 빈 dict 면 미동봉 → 순수 코오롱 경로와 byte-identical(무회귀).
                const maxOverrides = {};
                const stepOverrides = {};
                // 표시 분모(displayMax = 만점 폼 필드) — 채점 척도(max_overrides = 프롬프트 점수 단계)와 분리.
                // 전 브랜드 완전 독립(2026-06-24): 만점만 바꿔도 채점 불변, 표시 분모만 동적. default 코오롱은
                // displayMax==채점 max(결합)라 byte-identical(무회귀).
                const displayMaxByOrder = {};
                for (const i of standardIdx) {
                    const m = rowMeta[i];
                    const tpl = items[i]?.prompt_template;
                    if (tpl && String(tpl).trim()) promptOverrides[m.order_no] = tpl;
                    const maxScore = asNumber(items[i]?.max_score);
                    if (maxScore !== null && maxScore > 0) maxOverrides[m.order_no] = Math.round(maxScore);
                    const steps = items[i]?.allowed_steps;
                    if (Array.isArray(steps) && steps.length) stepOverrides[m.order_no] = steps;
                    const dispMax = asNumber(m?.max_score);
                    if (dispMax !== null && dispMax > 0) displayMaxByOrder[m.order_no] = Math.round(dispMax);
                }
                // 추가항목(extraIdx, order_no≥19) 표시 메타 — 표준 폴백 매퍼가 additive 결과행을
                // "LLM점수(채점) / 만점필드(표시)" 로 렌더하도록 category/item/displayMax 동봉.
                // order_no 집합으로 KMS(1001~)/Layer4(2001~)/KSQI(6001~) 가상항목과 구분 → 이 항목만 렌더.
                const _addMeta = {};
                for (const i of extraIdx) {
                    const m = rowMeta[i];
                    const ono = asNumber(m?.order_no);
                    if (ono === null) continue;
                    const dm = asNumber(m?.max_score);
                    _addMeta[ono] = {
                        category: safeStr(m?.category).trim(),
                        item: safeStr(m?.item).trim(),
                        display_max: dm !== null && dm > 0 ? Math.round(dm) : null,
                    };
                }
                additiveDisplayMeta = Object.keys(_addMeta).length ? _addMeta : null;
                // 추가항목(order_no≥19, 카탈로그 비매칭) → additive_items 로 별도 동봉.
                // rubric_inline 과 달리 custom_rubric full flip 미유발. 추가항목 0개면
                // additive 미동봉 → 순수 코오롱 경로와 byte-identical(무회귀).
                const additiveItems = extraIdx.map((i) => buildAdditiveItem(items[i], rowMeta[i]));
                rubricCall = {
                    ...call,
                    org_id: orgId,
                    prompt_overrides: Object.keys(promptOverrides).length ? promptOverrides : undefined,
                    max_overrides: Object.keys(maxOverrides).length ? maxOverrides : undefined,
                    step_overrides: Object.keys(stepOverrides).length ? stepOverrides : undefined,
                    additive: additiveItems.length ? true : undefined,
                    additive_items: additiveItems.length ? additiveItems : undefined,
                };
                // 폴백 매퍼(mapEvaluateResponseStandard)의 표시 분모 = displayMax(만점 폼 필드).
                // 채점 척도(max_overrides = 프롬프트 점수 단계)와 분리 → "LLM점수(채점) / 만점필드(표시)"로
                // 완전 독립 표기(만점만 바꾸면 분모만 변경, 채점 불변). default 코오롱은 displayMax==채점 max
                // 라 분모 동일(byte-identical). 맵 비면 null → 매퍼가 카탈로그 폴백(무회귀).
                standardMaxByOrder = Object.keys(displayMaxByOrder).length ? { ...displayMaxByOrder } : null;
                // 표준 매핑 폴백 강제: rowMeta 를 비워 mapEvaluateResponseRubric 가 5000번대
                // 미존재로 null 반환 → mapEvaluateResponseStandard(1:1) 사용. 추가항목 결과는
                // aggregator(파이프라인)에서 병합되어 응답에 포함됨(impl-agg 담당).
                rowMeta = [];
            } else {
                // 브랜드 한정 few-shot 토글 — UI 설정(ragFewshotConfig)에서 켠 org 면 rubric_id(안정
                // 검색키)+항목이름 게이트+RAG ON 주입. 미설정/미토글 org 는 기존 거동(rubric_inline 만).
                // rubric_inline 우선 해석은 그대로(평가 항목 불변), rubric_id 는 fewshot_store 검색 키로만 쓰임.
                const _rfx = await getOrgFewshot(pool, orgId);
                // PURE 라우팅 — 코오롱(org3)만 레거시, 그 외 전 브랜드는 신규 순수 LLM 모듈로.
                // eval_mode=pure 동봉 → 백엔드 _resolve_pure_mode 가 build_graph_v2_pure(=v2.pure_llm)
                // 선택(coverage/KMS/persona/pentagon/debate 미수행, 항목당 LLM 단일콜 ~7초).
                // 브랜드별 config(getOrgPure) 의존 폐기 — 신규 브랜드도 자동 pure. RAG 토글(_rfx)과 독립.
                // 전 브랜드 pure (코오롱 org3 포함, 2026-06-26 리드 결정). ★isKolonStandard 만 false 로
                // 두고 이 식을 그대로 두면 org3 일 때 _pure=false → eval_mode 미동봉 → 백엔드 full-custom
                // flip(코오롱 의도 반대). 두 곳을 함께 고쳐야 코오롱이 진짜 pure 로 간다.
                const _pure = true;
                // KMS 적용 범위 — 화면의 KMS 지정 항목만 돌게 한다(사용자 지시 2026-08-31).
                // null(조회 실패)이면 키를 빼서 파이프라인 env 폴백을 그대로 둔다.
                const _kmsItems = await resolveKmsItemNumbers(pool, orgId, rowMeta);
                // disable_rag 단일 진실원천: pure 트랙은 _rfx 유무로 항상 명시(_rfx 없으면 true).
                // 백엔드 _disable_rag 식이 pure 일 때 rubric_fewshot_item_names 토글 추론에 의존하므로,
                // _rfx 가 null 로 떨어지면 RAG 가 조용히 꺼지는 회귀를 페이로드에 의도를 박아 차단.
                // 비-pure org 는 _rfx 있을 때만 disable_rag:false, 그 외는 미동봉(backend 기본값 보존).
                rubricCall = {
                    ...call,
                    org_id: orgId,
                    rubric_inline: rubric,
                    ...(_kmsItems ? { kms_items: _kmsItems } : {}),
                    ...(_pure ? { eval_mode: 'pure', disable_rag: !_rfx } : {}),
                    ...(_rfx
                        ? {
                              rubric_id: _rfx.rubric_id,
                              rubric_fewshot_item_names: _rfx.item_names,
                              ...(!_pure ? { disable_rag: false } : {}),
                          }
                        : {}),
                };

                // ★ 2026-08-28 6단계 — 격리키(store_key)를 MTG 가 **명시**해 동봉한다.
                //
                // 왜: metadata.rubric_id 하나가 여섯 용도를 겸한다 — ①트랙 마커 ②full-custom flip
                //   신호 ③파일 스토어 로드키 ④fewshot 검색키 ⑤MTG RAG 격리키 ⑥스킬 스토어 격리키.
                //   buildRubricFromDefs 반환 객체에는 rubric_id 키가 없어(rubricSync.mjs 반환부)
                //   ④⑤⑥ 은 파이프라인이 rubric_inline 정규화 때 만드는 합성키를 본다
                //   (v2/pure_llm/evaluator.py: `inline-org{metadata.org_id}`). 그래서
                //   tenant_rag_config 를 켜고 끄면 격리키가 rbrc_xxx ↔ inline-org{N} 로 통째로
                //   바뀌어 스킬·골든이 동시에 침묵한다. 수신부는 이미 store_key 를 최우선으로 본다
                //   (rubric_fewshot_gate.resolve_search_rubric_id ①,
                //    mtg_skill/apply.py::_resolve_isolation_key) → MTG 가 명시하면 그 결합이 끊긴다.
                //
                // 값: 격리키 조립 규칙 단일 정의(isolationKeyOf)를 그대로 쓴다 — 골든 색인·
                //   커버리지도 같은 함수를 보고, skillLearn.resolveSkillRubricId 와 같은 규칙이다.
                //   조회는 이미 스코프에 있는 _rfx(동일 pool·orgId 의 getOrgFewshot 결과)를 재사용
                //   (DB 재조회 없음).
                //
                // ★ 무회귀 자기검증 — 파이프라인이 폴백으로 계산할 값(_fallbackKey)과 다르면
                //   **보내지 않는다.** 이 단계의 목적은 "같은 값을 MTG 가 명시"까지이고, 키를
                //   바꾸는 것이 아니다. 다른 값을 보내면 스킬·골든이 서로 다른 키를 뒤져 조용히
                //   침묵한다(최악 사고). 불일치는 외부 호출자가 call.rubric_id 를 직접 실어
                //   보내면서 tenant_rag_config 는 비어 있는 조합에서 발생 가능하다.
                const _storeKey = safeStr(isolationKeyOf(_rfx, orgId)).trim();
                // buildEvaluatePayload 가 실제로 내보낼 metadata.rubric_id (없으면 '').
                const _emittedRubricId = safeStr(rubricCall?.rubric_id).trim();
                // 파이프라인 폴백: metadata.rubric_id → 없으면 rubric_inline 정규화 합성키.
                const _fallbackKey = _emittedRubricId || `inline-org${safeStr(orgId) || 'na'}`;
                if (_storeKey && _storeKey === _fallbackKey) {
                    rubricCall = { ...rubricCall, store_key: _storeKey };
                } else {
                    warnings.push(
                        `store_key 미동봉(격리키 불일치 방지): mtg='${_storeKey}' vs pipeline_fallback='${_fallbackKey}'`
                    );
                }
            }
        } else {
            warnings.push(`루브릭 항목 0건(org=${orgId}) — 표준 트랙 진행`);
        }
    } catch (err) {
        // [동작 불가 게이트] 차단 에러는 표준 트랙으로 폴백하지 않고 그대로 전파(라우트가 사용자에게 표시).
        if (err && err.isUnconfiguredBlock) throw err;
        warnings.push(`루브릭 빌드 건너뜀(표준 트랙 진행): ${String(err?.message || err)}`);
    }

    // MTG 스킬 overlay 동봉 — MTG DB(qa_skill_store)의 활성 버전을 요청에 직접 실어 보냄.
    // 백엔드는 동봉본을 파일 스토어보다 최우선 주입(무상태 평가) — rubric_inline 과 동일 원칙.
    // 활성 버전 부재/조회 실패 시 null → 미동봉(백엔드 파일 스토어 거동, 무회귀).
    const _skillInline = await getActiveSkillOverlays(pool, rubricCall?.org_id ?? call?.org_id);
    const _hasSkillOverlays = !!(_skillInline?.overlays && Object.keys(_skillInline.overlays).length);
    if (_hasSkillOverlays) {
        rubricCall = { ...rubricCall, skill_overlays: _skillInline.overlays };
    }
    // ★ 2026-08-28 — disable_skills 를 여기서 **명시**한다 (4단계).
    //
    // 왜 필요했나: `call.disable_skills` 를 세팅하는 생산자가 한 곳도 없고 MTG .env 에
    //   QA_PIPELINE_* 키가 하나도 없어서, buildEvaluatePayload:419-422 의 폴백이
    //   `safeStr(undefined) !== 'false'` → **항상 true** 였다. 그 결과 바로 위에서 DB 에서
    //   조립해 실어 보내는 skill_overlays 가 백엔드 maybe_skill_overlay 의 첫 게이트
    //   (is_skills_disabled)에서 전부 폐기됐다 — MTG 스킬셋 기능 전체가 무발화 상태였다.
    //
    // 정책: **overlay 가 실제로 있으면 켜고, 없으면 끈다.** 바로 위 disable_rag 가
    //   `!_rfx`(설정 유무)로 결정되는 것과 대칭이다. 동봉할 것이 없을 때 굳이 켜서
    //   백엔드 파일 스토어 스킬이 끼어들 여지를 만들지 않는다.
    rubricCall = { ...rubricCall, disable_skills: !_hasSkillOverlays };

    // KSQI-STT 실행 토글 — 해당 org 의 ksqi_stt_enabled 를 metadata 로 동봉(True 시 백엔드가
    // 신규 KSQI-STT 모듈 실행). skill_overlays 와 동일한 org_id 해석(rubricCall 우선 → call 폴백).
    rubricCall = { ...rubricCall, ksqi_stt_enabled: await getOrgKsqiSttEnabled(pool, rubricCall?.org_id ?? call?.org_id) };

    // onProgress 콜백이 있으면 SSE 스트림으로 호출해 노드 진행 이벤트를 중계 (응답 JSON 은 동일).
    const resp =
        typeof opts.onProgress === 'function'
            ? await callQaPipelineStream(rubricCall, opts, opts.onProgress)
            : await callQaPipeline(rubricCall, opts);

    // 루브릭 매핑 우선, 5000번대 없으면 표준 매핑 폴백.
    let mapped = mapEvaluateResponseRubric(resp, rowMeta);
    if (!mapped) {
        // [방어] mapEvaluateResponseRubric 가 null 을 반환하는 두 경우:
        //   ① 5000번대 항목 자체가 없음 → 표준(레거시 1~18) 응답 → Standard 폴백이 정상.
        //   ② 5000번대는 있으나 rowMeta 길이 불일치(desync) → Standard(카탈로그 1~18) 폴백은
        //      5000번대를 전부 miss → 점수 오귀속(0행→포기호 오분류) 위험. 이 경우 Standard 폴백을
        //      금지하고, 빈 산출 + item_count(5000번대 수)로 게이트가 '평가불가'로 표면화하게 한다.
        const _idx = indexEvaluations(resp);
        const _has5000 = [...(_idx.byItem?.keys?.() || [])].some((n) => Number(n) >= RUBRIC_ITEM_BASE);
        if (_has5000) {
            warnings.push('루브릭 매핑 desync(5000번대 존재, rowMeta 길이 불일치) → Standard 폴백 금지, 평가불가 표면화');
            mapped = {
                checklist: [],
                evaluations: [],
                ai_score: 0,
                raw_total: 0,
                max_total: 0,
                warnings: [],
                source: _idx.source,
                item_count: _idx.byItem.size,
                all_unevaluable: false,
                unevaluable_count: 0,
                unevaluable_reason: 'desync',
            };
        } else {
            mapped = mapEvaluateResponseStandard(resp, standardMaxByOrder, additiveDisplayMeta);
        }
    }
    mapped.warnings = [...warnings, ...(mapped.warnings || [])];
    // 펜타곤 축별 정성평가(pure 트랙 pure_pentagon → result.pentagon) 통과 — ingestStandardCallToDb
    // 가 axes[] 를 qa_call_pentagon_result 에 적재해 분석 라우트가 점수밴드 보일러플레이트 대신 LLM
    // {rating,analysis,summary} 를 표시. 비-pentagon 브랜드는 resp.pentagon 부재 → null(무회귀).
    mapped.pentagon = resp && typeof resp === 'object' ? resp.pentagon || null : null;
    // KSQI STT 보고서(A 서비스품질/B 공감 — 브랜드 루브릭과 별개 축) 통과 — ingestStandardCallToDb
    // 가 qa_calls.ksqi_report(로컬 임시 jsonb, prod 스키마는 담당자 추가 예정)에 저장. KSQI 비활성
    // 브랜드는 resp.ksqi_stt_report 부재 → null(무회귀).
    mapped.ksqi_report = resp && typeof resp === 'object' ? resp.ksqi_stt_report || null : null;
    // KMS 필수사항 체크(QA-PAIR) — 응답 최상위 `kiwoom_coverage`. 평가 결과 [KMS] 탭
    // (frontend/src/components/Detail/KmsMandatoryPanel.jsx)이 그대로 소비하는 블록으로,
    // 인텐트별 필수항목 O/X/△/- · 종합 충족률 · 업무 트리거 · 적대검증 렌즈가 전부 여기 있다.
    // 파이프라인 pure 트랙에서는 `QA_PURE_KIWOOM_COVERAGE=1` 게이트를 통과한 콜만 실린다
    // (v2/pure_llm/coverage_branch.py). 그 외 브랜드/콜은 부재 → null(무회귀).
    //
    // 적재 = `trustguard.qa_kms_results` (call_id PK · payload jsonb). 사용자 승인 2026-08-31
    // ("처리해놔라") 로 신설 — `docker/init/postgres/60_qa_kms_results.sql`. 쓰기는
    // ingestStandardCallToDb 트랜잭션 안 upsert 1건, 읽기는 GET /api/evaluations/:qaId 의 select 1건.
    mapped.kiwoom_coverage =
        resp && typeof resp === 'object' ? resp.kiwoom_coverage || null : null;

    // 귀속 항목번호(check.binding = 5000+index) → **화면이 쓸 항목명·order_no** 주석.
    //   파이프라인은 자기 항목번호만 알고 대시보드 order_no·항목명을 모른다. 반대로 프론트는
    //   index↔order_no 대응(rowMeta)을 갖고 있지 않다 — 그 대응은 이 함수에만 있다. 그래서
    //   전사 칩이 `#5005` 같은 내부 번호를 노출하거나 아무것도 못 그리는 문제가 생긴다.
    //   여기서 한 번 붙여 두면 화면은 문자열만 읽으면 된다(V3 KmsMandatoryCard 의 bindingInfo 대응).
    if (mapped.kiwoom_coverage && Array.isArray(rowMeta) && rowMeta.length) {
        try {
            const label = new Map(); // 항목번호 → {order_no, name}
            rowMeta.forEach((m, i) => {
                label.set(RUBRIC_ITEM_BASE + i, {
                    order_no: asNumber(m?.order_no),
                    name: safeStr(m?.item).trim(),
                });
            });
            const evals = mapped.kiwoom_coverage?.mandatory?.evaluations_by_intent;
            for (const ev of Object.values(evals && typeof evals === 'object' ? evals : {})) {
                for (const c of Array.isArray(ev?.checks) ? ev.checks : []) {
                    const hit = label.get(Number(c?.binding));
                    if (!hit) continue;
                    c.binding_order_no = hit.order_no;
                    c.binding_label = hit.name;
                }
            }
        } catch {
            /* 주석 실패는 표시 품질 문제일 뿐 — 판정 결과는 그대로 둔다 */
        }
    }

    // 파이프라인 크래시 vs 포기호 구분: 평가 산출물이 0건인데 응답에 error 필드가 있으면
    // 이는 '포기호/미응대'가 아니라 평가 자체의 실패다(예: report_generator_v2 의 ItemResult
    // 검증 'score out of bounds' — 만점 override 와 채점 스케일 불일치로 report 생성 크래시).
    // 포기호 게이트로 흘려보내 무음 미적재하지 말고 라우트로 에러를 전파해 사용자에게 실패
    // 사유를 노출한다. 정상 평가(항목 1건 이상)면 비치명 error 는 무시(무회귀).
    const pipelineError = safeStr(resp?.error).trim();
    const noRows = !(mapped.evaluations?.length > 0) && !(mapped.checklist?.length > 0);
    if (pipelineError && noRows) {
        throw new Error(`파이프라인 평가 실패: ${pipelineError}`);
    }
    return mapped;
}

/**
 * 도메인(업종) 기준 딥평가 — domain_default_eval_items 로 인라인 루브릭을 빌드해 엔진 호출.
 * evaluateStandardCall 의 full-custom(rubric_inline) 경로만 사용(코오롱 표준 트랙 분기 없음).
 * 채점 SSOT 가 브랜드(eval_item_defs)가 아니라 '도메인 기본'이라, 튜터(02) 등 외부 시스템이
 * 도메인 기준으로 채점할 때 쓴다. DB 저장 없음(결과만 반환). 호출부가 pentagon 빌드에 쓰도록
 * mapped.rowMeta(order_no→pentagon_axis 포함) 동봉.
 * @param {{transcript:Array, domain_id:number, consultation_id?:string, role?:string, pipeline_target?:string}} call
 */
export async function evaluateDomainCall(pool, call, opts = {}) {
    const warnings = [];
    const domainId = asNumber(call?.domain_id);
    if (domainId === null) throw new Error('evaluateDomainCall: domain_id (number) required');

    const { rubric, rowMeta } = await buildRubricFromDomainDefaults(pool, domainId);
    if (!rubric?.items?.length) {
        throw new Error(`도메인 기본 평가항목이 없습니다 (domain_id=${domainId}).`);
    }
    // 평가 기준(criterion/prompt) 미입력 항목 차단 — 빈 항목 임의 채점 방지(evaluateStandardCall 게이트와 동일).
    const unconfigured = rubric.items.filter(
        (it) => !safeStr(it.prompt_template).trim() && !safeStr(it.criteria_full).trim()
    );
    if (unconfigured.length) {
        const names = unconfigured.map((it) => safeStr(it.name).trim() || '(이름없음)').join(', ');
        const e = new Error(`평가 기준이 입력되지 않은 도메인 평가항목이 있습니다: ${names}.`);
        e.isUnconfiguredBlock = true;
        throw e;
    }

    // PURE 트랙 동봉 — 전 브랜드 pure 전환(2026-06-26) 이후 레거시 풀그래프 트랙은 휴면이라,
    // eval_mode 미동봉 시 엔진이 5000번대 루브릭을 echo하지 않아 매핑이 실패한다(브랜드 경로와 동일하게 pure).
    // 도메인엔 org 별 fewshot 스토어가 없으므로 RAG off.
    const rubricCall = { ...call, rubric_inline: rubric, eval_mode: 'pure', disable_rag: true };
    const resp =
        typeof opts.onProgress === 'function'
            ? await callQaPipelineStream(rubricCall, opts, opts.onProgress)
            : await callQaPipeline(rubricCall, opts);

    const mapped = mapEvaluateResponseRubric(resp, rowMeta);
    if (!mapped) {
        // null 사유 구분: 5000번대 0개(엔진이 루브릭 미적용) vs 개수 불일치(desync).
        const _idx = indexEvaluations(resp);
        const _n5000 = [...(_idx.byItem?.keys?.() || [])].filter((n) => Number(n) >= RUBRIC_ITEM_BASE).length;
        throw new Error(_n5000 > 0
            ? `도메인 루브릭 매핑 불일치 (엔진 5000번대 ${_n5000}개 ≠ 도메인 항목 ${rowMeta.length}개).`
            : '도메인 루브릭 매핑 실패 (엔진 응답에 5000번대 항목 없음).');
    }
    mapped.warnings = [...warnings, ...(mapped.warnings || [])];
    mapped.rowMeta = rowMeta; // 펜타곤 축 귀속(order_no→pentagon_axis)에 호출부가 사용

    const pipelineError = safeStr(resp?.error).trim();
    const noRows = !(mapped.evaluations?.length > 0) && !(mapped.checklist?.length > 0);
    if (pipelineError && noRows) {
        throw new Error(`파이프라인 평가 실패: ${pipelineError}`);
    }
    return mapped;
}

export async function ingestStandardCallFromQaPipeline(pool, call, opts = {}) {
    const started = Date.now();
    let mapped;
    try {
        mapped = await evaluateStandardCall(pool, call, opts);
    } catch (err) {
        // [동작 불가 게이트] 평가 기준 미입력 항목 → 평가 실행 차단. 적재하지 않고 사유만 반환
        // (라우트의 if(!result.ok) 분기가 result.message 를 사용자에게 표시). 그 외 에러는 전파.
        if (err && err.isUnconfiguredBlock) {
            return { ok: false, blocked: true, message: err.message, warnings: [] };
        }
        throw err;
    }
    const result = await ingestStandardCallToDb(pool, call, mapped);
    const elapsedSec = round1((Date.now() - started) / 1000);
    return {
        ...result,
        warnings: mapped.warnings || [],
        source: mapped.source,
        elapsed_sec: elapsedSec,
        raw_total: mapped.raw_total ?? null,
        max_total: mapped.max_total ?? null,
        // KMS 필수사항 체크 원문 — DB 적재 경로가 아직 없어(위 mapped.kiwoom_coverage 주석 참조)
        // 호출부가 응답으로 확인·검증할 수 있게 통과시킨다. 라우트는 요약만 details 에 싣는다.
        kiwoom_coverage: mapped.kiwoom_coverage ?? null,
    };
}

/**
 * 골든셋 학습 배치 — 브랜드 골든셋(qa_golden_set)을 백엔드 MTG 전용 RAG 인덱스(qa-mtg-golden)에 색인.
 * "골든셋배치 > 지금 실행" 버튼(POST /api/golden-learn/run → triggerGoldenLearn)의 실제 동작 본체.
 *
 * 경로(전부 기존 백엔드 엔드포인트 — golden_set/RAG 코어 무수정):
 *   ① rubric_id 해석 = 평가 시점 resolve_search_rubric_id 와 동일 규칙(getOrgFewshot 충족 시
 *      rag_rubric_id, 아니면 inline-org{N}) → 색인 키 = 평가 검색 키 정합.
 *   ② buildRubricFromDefs 로 order_no→eval_item_number(5000+index) 맵 산출 + 루브릭 파일스토어
 *      등록(POST /v2/rubrics, 멱등) → 색인 엔드포인트 load_rubric 게이트 충족.
 *   ③ qa_golden_set ⋈ qa_call_transcript(전사) → MtgGoldenRecord[] 조립(item_number=②맵).
 *   ④ POST /v2/mtg-rag/{rubric_id}/examples (org_id 동봉 → 백엔드 resolve_allowed_items 가
 *      qa_batch_configs.golden.excluded 존중해 항목 자동 필터). dry_run 지원.
 *
 * @param {import('pg').Pool} pool
 * @param {number} orgId
 * @param {{ dryRun?: boolean, baseUrl?: string }} [opts]
 * @returns {Promise<{ok:boolean, triggered:boolean, rubric_id:string, golden_count:number, records?:number, saved?:number, dry_run?:boolean}>}
 */
export async function ingestGoldenSetToRag(pool, orgId, opts = {}) {
    const dryRun = !!opts.dryRun;
    // 골든 학습은 call 컨텍스트가 없어 EC2 타깃을 기본으로 명시 — 평가(index.js pipeline_target:'ec2')와
    // 동일 백엔드로 색인해야 검색 시 정합. 로컬 실험은 QA_PIPELINE_FORCE_LOCAL=1 이 이 분기보다 우선.
    const base = pipelineBase({ pipeline_target: 'ec2' }, opts);

    // ① rubric_id (평가 시점 검색 키와 동일 규칙 — 색인↔검색 정합)
    const rubricId = await resolveIsolationKey(pool, orgId);

    // ② 루브릭 빌드 + order_no→item_number 맵
    const { rubric, rowMeta } = await buildRubricFromDefs(pool, orgId);
    if (!rubric || !(rubric.items && rubric.items.length)) {
        return { ok: false, triggered: false, reason: 'no_rubric_items', org_id: orgId, rubric_id: rubricId };
    }
    // order_no → eval_item_number. MTG buildRubricFromDefs 는 items[].eval_item_number 를 부여하지 않고
    // (백엔드 normalize_rubric 이 5000+index 로 부여) items/rowMeta 가 동일 루프 index 정합이므로,
    // 평가 시점(백엔드)과 동일한 RUBRIC_ITEM_BASE+index 로 산출한다(제외 order_no 는 빌더가 이미 누락).
    const orderToItemNum = {};
    // order_no → 항목 만점(max_score). 백엔드 build_rag_index_summary 의 score_bucket 분류
    // (score>=max→full / 0→zero / 그외→partial)가 max_score 없으면 전부 partial 로 떨어지므로,
    // 골든 레코드에 항목별 만점을 동봉해야 full/zero 버킷이 정상 산출된다. rubric.items[i].max_score
    // (eval_item_defs 만점) 우선, 없으면 rowMeta[i].max_score 폴백.
    const orderToMaxScore = {};
    (rowMeta || []).forEach((m, i) => {
        const o = asNumber(m && m.order_no);
        if (o !== null) {
            orderToItemNum[o] = RUBRIC_ITEM_BASE + i;
            const mx = asNumber((rubric.items[i] && rubric.items[i].max_score) ?? (m && m.max_score));
            if (mx !== null && mx > 0) orderToMaxScore[o] = mx;
        }
    });

    // 루브릭 파일스토어 등록(load_rubric 게이트 충족 — 멱등, rubric_id 강제).
    try {
        await pipelineFetch(`${base}/v2/rubrics`, {
            method: 'POST',
            json: { ...rubric, rubric_id: rubricId, name: rubric.name || `org${orgId}` },
            timeoutMs: RUBRIC_REGISTER_TIMEOUT_MS,
        });
    } catch (e) {
        console.warn(`[golden-learn] rubric 등록 실패(무시 — ingest 응답에서 확인): ${(e && e.message) || e}`);
    }

    // ③ 골든 추출 + 전사 결합 — 통합DB: qa_golden_set.qa_id=call_id(bigint), 외부 consultation_id=common.calls.source_id(텍스트).
    const { rows: gs } = await pool.query(
        `SELECT g.qa_id AS call_id, c.source_id AS consultation_id, g.order_no, g.category, g.item, g.reason_text, g.agent_utterance, g.score
           FROM qa_golden_set g
           LEFT JOIN common.calls c ON c.call_id = g.qa_id
          WHERE g.tenant_id = $1 ORDER BY g.qa_id, g.order_no`,
        [orgId]
    );
    if (!gs.length) {
        return { ok: true, triggered: false, reason: 'no_golden_rows', org_id: orgId, rubric_id: rubricId, golden_count: 0 };
    }
    // 전사 — call_id 별 1회 조회. 화자는 RAG 예시 가독성 위해 한글 라벨 복원('agent'/'customer'→'상담사'/'고객').
    const tmap = {};
    for (const cid of [...new Set(gs.map((g) => g.call_id))]) {
        const { rows: c } = await pool.query(
            `SELECT CASE speaker WHEN 'agent' THEN '상담사' WHEN 'customer' THEN '고객' ELSE speaker END AS speaker,
                    "text"
               FROM common.call_transcript WHERE call_id = $1 AND channel = 'call' ORDER BY seq`,
            [cid]
        );
        tmap[cid] = c.map((r) => `${r.speaker}: ${r.text}`).join('\n');
    }
    const examples = gs
        .map((g) => ({
            consultation_id: g.consultation_id,
            item_number: orderToItemNum[g.order_no],
            item_name: g.item,
            category: g.category,
            transcript_body: tmap[g.call_id] || '',
            note_section: g.reason_text,
            stt_excerpt: g.agent_utterance,
            score: Number(g.score),
            // 항목 만점 — 백엔드 score_bucket 분류(full/partial/zero)에 필수. 누락 시 전부 partial.
            max_score: orderToMaxScore[g.order_no] ?? null,
        }))
        .filter((e) => e.item_number != null);

    // 골든셋 학습(색인)은 항상 전 항목 색인 — '적용 평가 항목' 체크는 평가 시 RAG on/off
    //   (organizations.rag_fewshot_item_names, syncRagFewshotFromGolden)만 제어하고 색인 범위는
    //   제한하지 않는다(전체 색인 → 나중에 항목 RAG 를 켜면 재색인 없이 즉시 사용).
    //   예시에 존재하는 전 항목 item_number 를 allowed_items 로 명시 동봉해 백엔드의 org_id DB
    //   재조회(제외 필터) 개입을 차단한다(전 항목 색인 보장).
    const allowedItems = [...new Set(examples.map((e) => e.item_number).filter((n) => n != null))];

    // ④ 색인 위임 (dry_run 지원) — 진행바용 청크 분할.
    //   백엔드 /v2/mtg-rag/{rubric}/examples 는 examples 배열 길이 무관하게 처리하고, dedup(skip_existing)은
    //   호출별 existing_external_ids 조회라 청크로 나눠도 멱등·결과 동일. examples 를 GOLDEN_LEARN_CHUNK
    //   건씩 순차 POST 하고, 각 청크 후 opts.onProgress({processed,total,saved,skipped,failed})로 진척을 올려
    //   프론트 진행바가 실시간 반영되게 한다. 단일 POST 대비 라운드트립만 늘 뿐(임베딩은 어차피 건별) 부담 미미.
    //   ★ 청크 크기 = 색인 병렬도. 백엔드 ingest_examples 는 청크(examples) 내부를 body.concurrency 만큼
    //   요약(LLM)+임베딩(Titan) 병렬 처리하므로, 청크가 작으면(과거 5) 그만큼만 병렬 → 병렬도 낭비.
    //   기본 100 — 상한 4중 검증 완료: 코드 세마포어 배치 미적용(per-loop) · LLM/Titan 클라이언트
    //   pool=500 · 쿼터(LLM · Titan 6k RPM/300k TPM) 대비 100건 버스트는 수% 수준 ·
    //   양 클라이언트 retries(adaptive/standard ×4) 내장으로 순간 스로틀 자동 백오프. 벽시계는 가장 느린
    //   요약 1건(~10~20s) ≪ 청크 타임아웃 600s. 진행바는 청크당 1회 갱신(대형 셋에서만 중간 진척 표시).
    //   전사가 매우 길어 요청 body 가 과대해지면 GOLDEN_LEARN_CHUNK 로 낮춰 조절.
    const timeoutMs =
        Number(process.env.GOLDEN_LEARN_TIMEOUT_MS || String(GOLDEN_INDEX_TIMEOUT_MS_DEFAULT)) ||
        GOLDEN_INDEX_TIMEOUT_MS_DEFAULT;
    const chunkSize = Math.max(1, Number(process.env.GOLDEN_LEARN_CHUNK || '100') || 100);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const total = examples.length;
    const agg = { saved: 0, skipped: 0, failed: 0, invalid: 0, filtered: 0 };
    let processed = 0;
    let lastStatus = 0;
    let lastError = null;
    let anyOk = false;
    if (onProgress) onProgress({ processed: 0, total, ...agg });
    for (let i = 0; i < total; i += chunkSize) {
        const chunk = examples.slice(i, i + chunkSize);
        const resp = await pipelineFetch(`${base}/v2/mtg-rag/${encodeURIComponent(rubricId)}/examples`, {
            method: 'POST',
            json: { org_id: orgId, dry_run: dryRun, examples: chunk, concurrency: chunk.length, ...(allowedItems ? { allowed_items: allowedItems } : {}) },
            timeoutMs,
        });
        lastStatus = resp.status;
        let j = {};
        try {
            j = await resp.json();
        } catch {
            /* 비-JSON 응답 */
        }
        if (j.ok) anyOk = true;
        if (j.error) lastError = j.error;
        agg.saved += Number(j.saved || 0);
        agg.skipped += Number(j.skipped || 0);
        agg.failed += Number(j.failed || 0);
        agg.invalid += Number(j.invalid || 0);
        agg.filtered += Number(j.filtered || 0);
        processed = Math.min(total, i + chunk.length);
        if (onProgress) onProgress({ processed, total, ...agg });
    }
    return {
        ok: agg.failed === 0 && (total === 0 || anyOk),
        triggered: true,
        dry_run: dryRun,
        org_id: orgId,
        rubric_id: rubricId,
        golden_count: gs.length,
        records: total,
        saved: agg.saved,
        skipped: agg.skipped,
        failed: agg.failed,
        invalid: agg.invalid,
        filtered: agg.filtered,
        http_status: lastStatus,
        error: lastError,
    };
}

// 골든 색인 커버리지(정밀) — 백엔드 /v2/mtg-rag/{rubric}/coverage 로 **색인된 consultation_id 목록**을
//   받아온다. 호출측(index.js)이 이를 PG qa_golden_set.created_at 과 조인해 "며칠까지 학습됐나"를 산출.
//   rubric_id 는 색인 시(ingestGoldenSetToRag)와 동일 규칙(getOrgFewshot → inline-org{N})으로 맞춰 정합.
export async function fetchGoldenIndexCoverage(pool, orgId, opts = {}) {
    // 색인(ingestGoldenSetToRag)과 동일 백엔드를 봐야 "미학습 N건" 카운트가 정확 — EC2 타깃 기본.
    const base = pipelineBase({ pipeline_target: 'ec2' }, opts);
    const rubricId = await resolveIsolationKey(pool, orgId);
    try {
        const resp = await pipelineFetch(`${base}/v2/mtg-rag/${encodeURIComponent(rubricId)}/coverage`, {
            timeoutMs: QUERY_TIMEOUT_MS,
        });
        const j = await resp.json().catch(() => ({}));
        return {
            rubric_id: rubricId,
            indexed_count: Number(j.indexed_count || 0),
            consultation_ids: Array.isArray(j.consultation_ids) ? j.consultation_ids.map((x) => String(x)) : [],
        };
    } catch (e) {
        return { rubric_id: rubricId, indexed_count: 0, consultation_ids: [], error: String((e && e.message) || e) };
    }
}
