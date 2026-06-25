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
import { getOrgFewshot, getOrgPure } from './ragFewshotConfig.mjs';

const DEFAULT_BASE_URL = 'http://localhost:8081';
// EC2 원격 백엔드 (V3 qa-pipeline, 8081 직접 접근) — call.pipeline_target==='ec2' 시 사용.
const DEFAULT_EC2_BASE_URL = 'http://54.235.200.151:8081';
// 컨테이너에서 호스트의 로컬 파이프라인 접근 주소 — force-local 시 기본 타깃.
const DEFAULT_LOCAL_FORCE_URL = 'http://host.docker.internal:8081';
const EVALUATE_TIMEOUT_MS = 600_000; // 600초

/** 평가 백엔드 base URL 해석 — opts.baseUrl > call.pipeline_target('ec2') > env > 로컬 기본값 */
function resolvePipelineBaseUrl(call, opts = {}) {
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
            // PURE 트랙 진입 신호 — 백엔드 _resolve_pure_mode 가 metadata.eval_mode 로 읽어
            // build_graph_v2_pure 선택(coverage/KMS/persona/pentagon 미수행). 미동봉이면 기존 풀 그래프.
            eval_mode: safeStr(call?.eval_mode).trim() || undefined,
            rubric_id: rubricId || undefined,
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
//   qa_checklist_rows(validation_time='배점 N') + qa_evaluation_rows(ai_eval=파이프라인 score 직결)
//   + qa_calls(org_id 명시, department='고객지원실', role='전체') 에 직접 적재.
// 분석 라우트가 qa_evaluation_rows.ai_eval 로 Pentagon 5축을 LIVE 도출하므로 스케일링/환산 없음.
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

// 코오롱 표준 3-페르소나 엔진은 레거시 브랜드(신한1/한화2/코오롱3)에만 적용.
// 신규 브랜드(id≥4)는 항목이 코오롱 카탈로그와 우연히 일치해도(예: '첫인사' 단일 항목) 표준
// 트랙으로 빠지지 않고 항상 full custom(rubric_inline) 전송 → qa-pipeline custom_rubric 트랙.
const LEGACY_STANDARD_ORG_IDS = new Set([1, 2, 3]);

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
export function mapEvaluateResponseStandard(resp, maxByOrder = null, additiveMeta = null) {
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
            const score = asNumber(ev.score);
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
            sumEarned += aiEval;
            sumMax += itemMax;
            checklist.push({
                order_no: ono,
                category: safeStr(slot.category).trim(),
                item: safeStr(slot.item).trim() || itemNameOf(ev),
                agent_utterance: agentQuoteOf(ev),
                validation_time: `배점 ${itemMax}`,
            });
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
        const aiEval = round1(score);
        // Y/N(컴플라이언스 체크) 항목은 콜 총점(ai_score)·만점 합산에서 제외 — 점수 무관 순수 모니터링
        // (기획 docs/YN_EVAL_ITEM_PLAN §4.2). 결과 행(checklist/evaluations)은 그대로 기록 →
        // qa_evaluation_rows 에 충족(ai_eval>0)/미충족(ai_eval=0)으로 남아 위반율 집계에 사용.
        const isYesNo = safeStr(slot.scoring_type).trim().toLowerCase() === 'yes_no';
        if (!isYesNo) {
            rawTotal += aiEval;
            sumEarned += aiEval;
            sumMax += itemMax;
        }

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

    // 포기호/미응대 게이트: 파이프라인이 평가 산출물(평가행·체크리스트)을 하나도 만들지
    // 못한 콜(상담사 미연결 등)은 QA 대상이 아니므로 qa_calls 에 적재하지 않는다.
    // (화자분리 오인식된 실제 응대콜은 평가행이 산출되므로 정상 적재됨.)
    const hasEval = Array.isArray(mapped?.evaluations) && mapped.evaluations.length > 0;
    const hasChecklist = Array.isArray(mapped?.checklist) && mapped.checklist.length > 0;
    if (!hasEval && !hasChecklist) {
        return { ok: true, skipped: true, qa_id: id, turns: 0,
                 reason: '포기호/미응대(평가 산출물 없음) — 적재 안 함' };
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
    // 통화 소요시간(초) — ICS CALL_END_DATE-CALL_START_DATE 차. 폴러가 call.duration_sec 로 전달.
    // 음수/비숫자/없음은 null(미상). 배치 "통화시간" 조건이 이 값을 선별에 사용.
    const durRaw = asNumber(call?.duration_sec);
    const durationSec = durRaw !== null && Number.isFinite(durRaw) && durRaw >= 0 ? Math.round(durRaw) : null;
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
                  department, role, org_id, proj_cd, agent_code, agent_user_id, io_divi, duration_sec,
                  ai_analysis_target, ai_analysis_reason, voc_code, promotion_code, is_sandbox)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,NULL,NULL,false)
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
               duration_sec = COALESCE(EXCLUDED.duration_sec, qa_calls.duration_sec),
               ai_analysis_target = NULL,
               ai_analysis_reason = NULL,
               voc_code = NULL,
               promotion_code = NULL,
               is_sandbox = false`,
            [id, callSeq, cdate, uid, score, score, department, role, orgId, projCd, agentCode, agentUserId, ioDivi, durationSec]
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
            const isKolonStandard =
                LEGACY_STANDARD_ORG_IDS.has(Number(orgId)) && standardIdx.length > 0 && !hasDivergent;
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
                const _rfx = getOrgFewshot(orgId);
                // PURE 라우팅 — 구성된 브랜드(ragFewshotConfig.pure)면 eval_mode=pure 동봉.
                // 백엔드가 build_graph_v2_pure 로 분기 → coverage/KMS/persona/pentagon 미수행(~7초).
                // RAG 토글과 독립이라 _rfx 가 null(RAG off)이어도 pure 는 유지. 퓨어 베이스 +
                // 골든셋 RAG on/off 확장 구조.
                const _pure = getOrgPure(orgId);
                // disable_rag 단일 진실원천: pure 트랙은 _rfx 유무로 항상 명시(_rfx 없으면 true).
                // 백엔드 _disable_rag 식이 pure 일 때 rubric_fewshot_item_names 토글 추론에 의존하므로,
                // _rfx 가 null 로 떨어지면 RAG 가 조용히 꺼지는 회귀를 페이로드에 의도를 박아 차단.
                // 비-pure org 는 _rfx 있을 때만 disable_rag:false, 그 외는 미동봉(backend 기본값 보존).
                rubricCall = {
                    ...call,
                    org_id: orgId,
                    rubric_inline: rubric,
                    ...(_pure ? { eval_mode: 'pure', disable_rag: !_rfx } : {}),
                    ...(_rfx
                        ? {
                              rubric_id: _rfx.rubric_id,
                              rubric_fewshot_item_names: _rfx.item_names,
                              ...(!_pure ? { disable_rag: false } : {}),
                          }
                        : {}),
                };
            }
        } else {
            warnings.push(`루브릭 항목 0건(org=${orgId}) — 표준 트랙 진행`);
        }
    } catch (err) {
        // [동작 불가 게이트] 차단 에러는 표준 트랙으로 폴백하지 않고 그대로 전파(라우트가 사용자에게 표시).
        if (err && err.isUnconfiguredBlock) throw err;
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
        mapped = mapEvaluateResponseStandard(resp, standardMaxByOrder, additiveDisplayMeta);
    }
    mapped.warnings = [...warnings, ...(mapped.warnings || [])];

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
    };
}
