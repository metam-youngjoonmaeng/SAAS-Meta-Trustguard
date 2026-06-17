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
import { buildRubricFromDefs } from './rubricSync.mjs';

const DEFAULT_BASE_URL = 'http://localhost:8081';
// EC2 원격 백엔드 (V3 qa-pipeline, 8081 직접 접근) — call.pipeline_target==='ec2' 시 사용.
const DEFAULT_EC2_BASE_URL = 'http://54.235.200.151:8081';
const EVALUATE_TIMEOUT_MS = 600_000; // 600초

/** 평가 백엔드 base URL 해석 — opts.baseUrl > call.pipeline_target('ec2') > env > 로컬 기본값 */
function resolvePipelineBaseUrl(call, opts = {}) {
    if (opts.baseUrl) return opts.baseUrl;
    if (isEc2Target(call)) {
        return process.env.QA_PIPELINE_BASE_URL_EC2 || DEFAULT_EC2_BASE_URL;
    }
    return process.env.QA_PIPELINE_BASE_URL || DEFAULT_BASE_URL;
}

/** call.pipeline_target === 'ec2' 여부 (대소문자 무시) */
function isEc2Target(call) {
    return String(call?.pipeline_target ?? '').trim().toLowerCase() === 'ec2';
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

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function safeStr(value) {
    return value === null || value === undefined ? '' : String(value);
}

function safeList(value) {
    return Array.isArray(value) ? value : [];
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
 * judgment + deductions 결합 → reason_text.
 *   "[항목명] judgment" 들을 ' / ' join, 이어서 deductions 를 "사유(-N점)" 개행으로 추가.
 */
function buildReasonText(present) {
    const head = [];
    const dedLines = [];
    for (const ev of present) {
        const name = itemNameOf(ev);
        const judgment = safeStr(ev?.judgment).trim();
        head.push(judgment ? `[${name}] ${judgment}` : `[${name}]`);
        for (const d of safeList(ev?.deductions)) {
            if (!d || typeof d !== 'object') continue;
            const reason = safeStr(d.reason).trim();
            const pts = asNumber(d.points);
            if (!reason && pts === null) continue;
            const ptText = pts !== null ? `(-${Math.abs(pts)}점)` : '';
            dedLines.push(`${reason}${ptText}`.trim());
        }
    }
    const parts = [head.join(' / ')];
    if (dedLines.length) parts.push(dedLines.join('\n'));
    return parts.filter(Boolean).join('\n');
}

/**
 * /evaluate 응답 → collectionCallIngest 입력 body 로 변환.
 * @returns {{ body: object, warnings: string[], deriveTotal: number, source: string }}
 */
export function mapEvaluateResponse(resp, call) {
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
    // RAG 검색(Haiku 쿼리 요약 + Titan 임베딩 + AOSS)이 평가당 수십 초를 점유하던 병목 제거.
    // call.disable_rag/disable_skills 또는 env QA_PIPELINE_DISABLE_RAG/DISABLE_SKILLS='false' 로 재활성.
    const disableRag =
        call?.disable_rag !== undefined
            ? Boolean(call.disable_rag)
            : safeStr(process.env.QA_PIPELINE_DISABLE_RAG).trim().toLowerCase() !== 'false';
    const disableSkills =
        call?.disable_skills !== undefined
            ? Boolean(call.disable_skills)
            : safeStr(process.env.QA_PIPELINE_DISABLE_SKILLS).trim().toLowerCase() !== 'false';
    return {
        transcript: call?.transcript,
        consultation_id: consultationId,
        persona_mode: personaMode,
        disable_rag: disableRag,
        disable_skills: disableSkills,
        metadata: {
            source: 'qa_dashboard',
            qa_id: safeStr(call?.qa_id ?? call?.id).trim() || undefined,
            org_id: call?.org_id !== undefined ? safeStr(call.org_id) : undefined,
            department: call?.department !== undefined ? safeStr(call.department) : undefined,
            role: call?.role !== undefined ? safeStr(call.role) : undefined,
            rubric_id: rubricId || undefined,
            // 활성 테넌트 평가항목을 요청에 직접 동봉 — 원격(EC2) 백엔드도 프론트 기준 그대로 평가.
            rubric_inline:
                call?.rubric_inline && typeof call.rubric_inline === 'object' ? call.rubric_inline : undefined,
        },
    };
}

export async function callQaPipeline(call, { baseUrl } = {}) {
    const base = resolvePipelineBaseUrl(call, { baseUrl }).replace(/\/+$/, '');
    const url = `${base}/evaluate`;
    const payload = buildEvaluatePayload(call);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVALUATE_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

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
export async function callQaPipelineStream(call, { baseUrl } = {}, onProgress = null) {
    const base = resolvePipelineBaseUrl(call, { baseUrl }).replace(/\/+$/, '');
    const url = `${base}/evaluate/stream`;
    const payload = buildEvaluatePayload(call);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVALUATE_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(payload),
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
                } else if (ev.event === 'result') {
                    result = ev.data;
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
//   qa_checklist_rows(validation_time='배점 N') + qa_evaluation_rows(ai_eval=파이프라인 score 직결)
//   + qa_calls(org_id 명시, department='고객지원실', role='전체') 에 직접 적재.
// 분석 라우트가 qa_evaluation_rows.ai_eval 로 Pentagon 5축을 LIVE 도출하므로 스케일링/환산 없음.
// 위 collection 함수/상수(mapEvaluateResponse/DASHBOARD_ITEM_MAPPING/JOB_MAX_SCORES)는 무변경.
// ============================================================

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

// 만점 + judgment 에 아래 마커가 있으면 "평가 대상 상황 자체가 없었다"는 의미 —
// evidence 발화를 노출하면 혼란 (예: 쿠션어 '거절/불가 상황 미발생'인데 발화 표시).
const NO_OCCURRENCE_MARKERS = ['미발생', '해당없음', '해당 없음', '불필요'];
const AGENT_QUOTE_LIMIT = 3;
// 파이프라인이 evidence 부재 시 채워 넣는 시스템 placeholder — 발화가 아니므로 표시 제외.
const SYSTEM_QUOTE_MARKERS = ['근거 인용 미제출', 'LLM 평가 실패', 'evidence 추출 불가'];

/**
 * 단일 항목 평가 dict 에서 evidence 의 상담사 발화를 최대 3건 모아 개행 join.
 *   - 상담사 마커 우선, 고객 마커 제외, 마커 없으면 첫 발화 1건 fallback.
 *   - 감점이 없고 judgment 가 미발생/해당없음류면 발화 표시 생략.
 *   - (system) placeholder(근거 인용 미제출 등)는 발화가 아니므로 생략.
 *   - 중복 제거. 프론트 하이라이트는 발화별 부분일치 매칭이라 개행 join 호환.
 */
function agentQuoteOf(ev) {
    const judgment = safeStr(ev?.judgment);
    if (!safeList(ev?.deductions).length && NO_OCCURRENCE_MARKERS.some((m) => judgment.includes(m))) {
        return '';
    }
    const picked = [];
    const seen = new Set();
    let fallback = '';
    for (const q of safeList(ev?.evidence)) {
        if (!q || typeof q !== 'object') continue;
        const quote = safeStr(q.quote).trim();
        if (!quote || seen.has(quote)) continue;
        const speaker = safeStr(q.speaker).toLowerCase();
        if (speaker.includes('system') || SYSTEM_QUOTE_MARKERS.some((m) => quote.includes(m))) continue;
        if (CUSTOMER_MARKERS.some((m) => speaker.includes(m))) continue;
        if (AGENT_MARKERS.some((m) => speaker.includes(m))) {
            seen.add(quote);
            picked.push(quote);
            if (picked.length >= AGENT_QUOTE_LIMIT) break;
        } else if (!fallback) {
            fallback = quote;
        }
    }
    if (picked.length) return picked.join('\n');
    return fallback;
}

/**
 * 단일 항목 judgment + deductions → reason_text.
 *   judgment 본문 + deductions "사유(-N점)" 개행. 둘 다 없으면 '(사유 미제공)'.
 */
function reasonTextOf(ev) {
    const lines = [];
    const judgment = safeStr(ev?.judgment).trim();
    if (judgment) lines.push(judgment);
    for (const d of safeList(ev?.deductions)) {
        if (!d || typeof d !== 'object') continue;
        const reason = safeStr(d.reason).trim();
        const pts = asNumber(d.points);
        if (!reason && pts === null) continue;
        const ptText = pts !== null ? `(-${Math.abs(pts)}점)` : '';
        lines.push(`${reason}${ptText}`.trim());
    }
    return lines.join('\n') || '(사유 미제공)';
}

/**
 * /evaluate 응답 → 표준 18항목 행 변환. 9-order 환산 없음 — item_number 1:1.
 *   order_no ← item_number(1~18), ai_eval ← score(스케일 없음, snap 은 파이프라인 책임),
 *   category/item/max ← STANDARD_ITEM_CATALOG, validation_time='배점 '+max,
 *   reason_text ← judgment+deductions, agent_utterance ← evidence(상담사 화자).
 *   #3 / score null / 응답 미존재 항목은 생략 + warnings. 백분율은 존재 행 기준.
 * @returns {{ checklist, evaluations, ai_score, warnings, source }}
 */
export function mapEvaluateResponseStandard(resp) {
    const warnings = [];
    const { byItem, source } = indexEvaluations(resp);
    if (byItem.size === 0) {
        warnings.push('응답에서 평가 항목(item_scores / categories.items)을 찾지 못함');
    }

    const checklist = [];
    const evaluations = [];
    let sumEarned = 0;
    let sumMax = 0;

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
        const score = asNumber(ev.score);
        if (score === null) {
            warnings.push(`order ${orderNo}: item_number #${orderNo} score=null/skipped → 행 생략`);
            continue;
        }
        const aiEval = round1(score);
        sumEarned += aiEval;
        sumMax += slot.max;

        checklist.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            agent_utterance: agentQuoteOf(ev),
            validation_time: `배점 ${slot.max}`,
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

    const aiScore = sumMax > 0 ? round1((100 * sumEarned) / sumMax) : 0;
    return {
        checklist,
        evaluations,
        ai_score: aiScore,
        raw_total: round1(sumEarned),
        max_total: sumMax,
        warnings,
        source,
    };
}

// 루브릭 트랙 항목 번호 기준값 — eval_item_number = RUBRIC_ITEM_BASE + index.
const RUBRIC_ITEM_BASE = 5000;

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
export function mapEvaluateResponseRubric(resp, rowMeta) {
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

    for (const { index, ev } of rubricRows) {
        const slot = meta[index];
        const orderNo = asNumber(slot?.order_no);
        if (!slot || orderNo === null) {
            warnings.push(`루브릭 index ${index}: rowMeta 매핑 없음 → 행 생략`);
            continue;
        }
        const score = asNumber(ev.score);
        if (score === null) {
            warnings.push(`루브릭 index ${index} → order_no ${orderNo}: score=null/skipped → 행 생략`);
            continue;
        }
        // 항목 만점 = 응답 ev.max_score(루브릭) 우선, defs 만점은 폴백 — 평가-시점 만점 동결.
        const itemMax = (() => {
            const m = asNumber(ev.max_score);
            if (m !== null && m > 0) return m;
            const dm = asNumber(slot.max_score);
            return dm !== null && dm > 0 ? dm : 5;
        })();
        const aiEval = round1(score);
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
        evaluations.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            reason_text: reasonTextOf(ev),
            ai_eval: aiEval,
            manual_eval: aiEval,
        });
    }

    const aiScore = sumMax > 0 ? round1((100 * sumEarned) / sumMax) : 0;
    return { checklist, evaluations, ai_score: aiScore, raw_total: round1(rawTotal), max_total: sumMax, warnings, source };
}

/**
 * call.org_id(숫자) 우선, 없으면 call.brand_name → organizations.name 조회.
 * 표준 트랙은 브랜드 귀속 필수 — 둘 다 없거나 조회 실패 시 에러.
 * @returns {Promise<number>} 해석된 org id
 */
async function resolveStandardOrgId(pool, call) {
    const direct = asNumber(call?.org_id);
    if (direct !== null && direct > 0) return Math.trunc(direct);

    const brandName = safeStr(call?.brand_name).trim();
    if (!brandName) {
        throw new Error('표준 트랙은 call.org_id(숫자) 또는 call.brand_name 이 필요합니다.');
    }
    const { rows } = await pool.query('SELECT id FROM public.organizations WHERE name = $1 LIMIT 1', [brandName]);
    const found = asNumber(rows?.[0]?.id);
    if (found === null) {
        throw new Error(`브랜드 '${brandName}' 가 organizations 에 없습니다. 먼저 브랜드를 등록하세요.`);
    }
    return Math.trunc(found);
}

/**
 * 표준 18항목 트랜잭션 적재. qa_analysis_report 는 쓰지 않음(분석 라우트 fallback 생성).
 * 멱등: 자식 DELETE WHERE "ID"=$1 후 재삽입 + qa_calls ON CONFLICT DO UPDATE(org_id/department/role 포함).
 * @returns {Promise<{ok, qa_id, ai_score, total_score, role, department, org_id, turns}>}
 */
export async function ingestStandardCallToDb(pool, call, mapped) {
    const id = safeStr(call?.qa_id ?? call?.consultation_id ?? call?.id).trim();
    if (!id) return { ok: false, message: 'call.id(qa_id/consultation_id) 가 필요합니다.' };

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
                `SELECT department FROM qa_calls
                  WHERE org_id = $1 AND department IS NOT NULL AND department <> ''
                  GROUP BY department ORDER BY COUNT(*) DESC, department ASC LIMIT 1`,
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

    // 담당 상담사 해석: agent_code(ICS user_m.USER_CD) → admin_users(login_id='{code}@{proj}' 소문자, icsSso 규칙).
    // 매칭 계정이 아직 없으면 agent_user_id=NULL(미지정) — agent_code 는 보관해 추후 SSO 로그인 시 연결/추적.
    const agentCode = safeStr(call?.agent_code).trim() || null;
    // 채널구분 'I'(인바운드)/'O'(아웃바운드) — ICS tb_stt_master.IO_DIVI. 그 외 값/없음은 NULL.
    const ioDiviRaw = safeStr(call?.io_divi).trim().toUpperCase();
    const ioDivi = ioDiviRaw === 'I' || ioDiviRaw === 'O' ? ioDiviRaw : null;
    let agentUserId = null;
    if (agentCode && projCd) {
        try {
            const { rows } = await pool.query(
                `SELECT user_id FROM admin_users WHERE lower(login_id) = lower($1) LIMIT 1`,
                [`${agentCode}@${projCd}`]
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM qa_analysis_report WHERE "ID" = $1`, [id]);
        await client.query(`DELETE FROM qa_evaluation_rows WHERE "ID" = $1`, [id]);
        await client.query(`DELETE FROM qa_checklist_rows WHERE "ID" = $1`, [id]);
        await client.query(`DELETE FROM qa_conversations WHERE "ID" = $1`, [id]);
        await client.query(
            `INSERT INTO qa_calls
                 ("ID","CALL_SEQ","CDATE","UID","AI_SCORE","TOTAL_SCORE",
                  department, role, org_id, proj_cd, agent_code, agent_user_id, io_divi,
                  ai_analysis_target, ai_analysis_reason, voc_code, promotion_code, is_sandbox)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,NULL,NULL,false)
             ON CONFLICT ("ID") DO UPDATE SET
               "CALL_SEQ" = EXCLUDED."CALL_SEQ",
               "CDATE" = EXCLUDED."CDATE",
               "UID" = EXCLUDED."UID",
               "AI_SCORE" = EXCLUDED."AI_SCORE",
               "TOTAL_SCORE" = EXCLUDED."TOTAL_SCORE",
               department = EXCLUDED.department,
               role = EXCLUDED.role,
               org_id = EXCLUDED.org_id,
               proj_cd = EXCLUDED.proj_cd,
               agent_code = EXCLUDED.agent_code,
               agent_user_id = EXCLUDED.agent_user_id,
               io_divi = COALESCE(EXCLUDED.io_divi, qa_calls.io_divi),
               ai_analysis_target = NULL,
               ai_analysis_reason = NULL,
               voc_code = NULL,
               promotion_code = NULL,
               is_sandbox = false`,
            [id, callSeq, cdate, uid, score, score, department, role, orgId, projCd, agentCode, agentUserId, ioDivi]
        );
        for (const t of conversation) {
            await client.query(
                `INSERT INTO qa_conversations ("ID", turn_no, speaker, "text") VALUES ($1,$2,$3,$4)`,
                [id, t.turn_no, t.speaker, t.text]
            );
        }
        for (const c of mapped.checklist) {
            await client.query(
                `INSERT INTO qa_checklist_rows ("ID", order_no, category, item, agent_utterance, validation_time)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [id, c.order_no, c.category, c.item, c.agent_utterance, c.validation_time]
            );
        }
        for (const e of mapped.evaluations) {
            await client.query(
                `INSERT INTO qa_evaluation_rows ("ID", order_no, category, item, reason_text, ai_eval, manual_eval)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [id, e.order_no, e.category, e.item, e.reason_text, e.ai_eval, e.manual_eval]
            );
        }
        // qa_analysis_report 는 쓰지 않음 — 분석 라우트가 buildDefaultFallbackReportRows 로 생성.
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
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
 * 표준 트랙 단일 콜: /evaluate 호출(callQaPipeline 재사용) → 18항목 매핑 → DB 적재.
 *   루브릭 연동(DB 소스): metadata.org_id 를 페이로드에 실으면 백엔드(QA_RUBRIC_SOURCE=db)가
 *   eval_item_defs 를 직접 읽어 custom_rubric 트랙(5000번대) 으로 평가하고,
 *   응답을 index(번호-5000)→orderMap(buildRubricFromDefs 로컬 산출) 으로 표준 18항목에 환원해 적재.
 *   5000번대가 없으면(루브릭 미적용) 기존 표준 매핑으로 자동 폴백.
 *   /evaluate 응답의 kms 블록은 무시(dev프론트 미저장, 백엔드 KMS 노드는 유지).
 * @returns {Promise<{ok, qa_id, ai_score, total_score, role, department, org_id, turns, elapsed_sec, warnings, source}>}
 */
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
    try {
        const orgId = await resolveStandardOrgId(pool, call);
        const { rubric, rowMeta: meta } = await buildRubricFromDefs(pool, orgId);
        if (rubric?.items?.length) {
            const isKolonStandard = (meta || []).every((r) => {
                const slot = STANDARD_CATALOG_BY_ORDER.get(r.order_no);
                return slot && slot.item === r.item;
            });
            if (isKolonStandard) {
                rubricCall = { ...call, org_id: orgId };
            } else {
                rowMeta = meta || [];
                rubricCall = { ...call, org_id: orgId, rubric_inline: rubric };
            }
        } else {
            warnings.push(`루브릭 항목 0건(org=${orgId}) — 표준 트랙 진행`);
        }
    } catch (err) {
        warnings.push(`루브릭 빌드 건너뜀(표준 트랙 진행): ${String(err?.message || err)}`);
    }

    // onProgress 콜백이 있으면 SSE 스트림으로 호출해 노드 진행 이벤트를 중계 (응답 JSON 은 동일).
    const resp =
        typeof opts.onProgress === 'function'
            ? await callQaPipelineStream(rubricCall, opts, opts.onProgress)
            : await callQaPipeline(rubricCall, opts);

    // 루브릭 매핑 우선, 5000번대 없으면 표준 매핑 폴백.
    let mapped = mapEvaluateResponseRubric(resp, rowMeta);
    if (!mapped) {
        mapped = mapEvaluateResponseStandard(resp);
    }
    mapped.warnings = [...warnings, ...(mapped.warnings || [])];
    return mapped;
}

export async function ingestStandardCallFromQaPipeline(pool, call, opts = {}) {
    const started = Date.now();
    const mapped = await evaluateStandardCall(pool, call, opts);
    const result = await ingestStandardCallToDb(pool, call, mapped);
    const elapsedSec = round1((Date.now() - started) / 1000);
    return {
        ...result,
        warnings: mapped.warnings || [],
        source: mapped.source,
        elapsed_sec: elapsedSec,
        raw_total: mapped.raw_total ?? null,
        max_total: mapped.max_total ?? null,
    };
}
