/**
 * AI 평가 '신뢰도 검증' LLM 판정기 (배치관리 ②).
 *
 * 엔진 confidence(블랙박스)와 독립된, 우리가 제어하는 2차 AI 레이어:
 *   AI가 매긴 점수+근거 텍스트를 Gemini(REST)가 읽고 항목별로
 *   { uncertain(불확실 표현) / weak(근거 빈약) / contradiction(근거-점수 모순) } 를 맥락 판정.
 *   키워드 사전이 아니라 '맥락 판단 지시문(프롬프트)' — 프롬프트는 관리자가 관리(qa_confidence_prompt).
 *
 * 호출은 precompute 경로(judgeConfidence 백필/적재훅)에서만 — 실시간 미리보기에 두지 않는다(지연 ~1.5s/콜).
 * 키: GEMINI_API_KEY. 비면 judgeEnabled()=false → 판정 no-op(상위에서 가드).
 */
import { logger } from './logger.mjs';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

// 관리자가 편집하는 '두 판단 기준' 기본 정의문(B안 — 화면 2섹션).
// 관리자는 이 두 정의문만 고친다. 역할 지시·출력 JSON 포맷 같은 골격은 buildSystemPrompt 가
// 코드에 고정 → admin 이 포맷을 깨뜨려 판정 전체가 망가지는 사고를 방지.
export const DEFAULT_UNCERTAIN_DEF = `근거가 사실을 단정하지 못하고 추측·인상에 기댄 표현을 포함하는가.
예: "~같음", "~로 보임", "애매함", "판단이 어려움", "추정됨". 사실을 단정하면 false.
주의: "애매하지 않게 명확히 안내함"처럼 불확실 표현이 부정문 안에 있으면 false.`;

export const DEFAULT_CONTRADICTION_DEF = `근거의 내용(부정·문제 지적)과 부여된 점수의 방향이 어긋나는가.
예: 근거는 미흡·누락을 지적하는데 점수는 만점에 가깝다 → true.`;

// 두 정의문을 골격(역할·출력 포맷)에 끼워 '전체 판정 프롬프트(systemInstruction)'를 조립.
// 정의문이 비어 있으면 기본값으로 대체.
export function buildSystemPrompt({ uncertainDef, contradictionDef } = {}) {
    const u = String(uncertainDef ?? '').trim() || DEFAULT_UNCERTAIN_DEF;
    const c = String(contradictionDef ?? '').trim() || DEFAULT_CONTRADICTION_DEF;
    return `당신은 콜 상담 품질평가(QA)의 'AI 평가 신뢰도 검수자'입니다.
AI가 상담 콜의 각 평가항목에 매긴 '점수'와 그 '근거 문장'을 보고, 이 AI 평가를 사람이 다시 들어봐야 하는지 판단합니다.

각 항목에 대해 다음 2가지를 독립적으로 판정하세요(각각 boolean):
- uncertain (불확실 표현): ${u}
- contradiction (근거-점수 모순): ${c}

판정은 보수적으로: 명확히 해당할 때만 true, 애매하면 false.
반드시 아래 JSON 형식으로만 답하세요(코드블록·설명 텍스트 금지):
{"items":[{"order_no":<정수>,"uncertain":<bool>,"contradiction":<bool>,"note":"<true인 항목만 한 줄 사유, 없으면 빈 문자열>"}]}`;
}

// 관리자가 프롬프트를 저장하지 않았을 때 쓰는 기본 판정 지시문(두 기본 정의문으로 조립).
// (qa_confidence_prompt 에 행이 있으면 최신 version 을 우선 사용 — resolvePrompt 참고.)
export const DEFAULT_PROMPT = buildSystemPrompt();

export function judgeEnabled() {
    return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

export function judgeModel() {
    return String(process.env.BATCH_JUDGE_MODEL || '').trim() || DEFAULT_MODEL;
}

/**
 * 활성 판정 프롬프트 해석: qa_confidence_prompt 최신 version 우선, 없으면 DEFAULT_PROMPT(version 0).
 * @returns {Promise<{systemPrompt:string, version:number}>}
 */
export async function resolvePrompt(pool, orgId = 0) {
    try {
        const { rows } = await pool.query(
            `SELECT system_prompt, version FROM public.qa_confidence_prompt
              WHERE org_id = $1 ORDER BY version DESC LIMIT 1`,
            [orgId]
        );
        if (rows[0]?.system_prompt) {
            return { systemPrompt: rows[0].system_prompt, version: rows[0].version ?? 1 };
        }
    } catch (e) {
        logger.warn(`[judge] 프롬프트 조회 실패(${e?.message || e}) — 기본 프롬프트 사용`);
    }
    return { systemPrompt: DEFAULT_PROMPT, version: 0 };
}

/**
 * 편집 UI 용 — 두 정의문(불확실/모순) + 메타 조회. 저장된 행이 없으면 기본값(is_default).
 * @returns {Promise<{uncertainDef:string, contradictionDef:string, version:number, isDefault:boolean, updatedAt:string|null}>}
 */
export async function resolvePromptParts(pool, orgId = 0) {
    try {
        const { rows } = await pool.query(
            `SELECT uncertain_def, contradiction_def, version, updated_at
               FROM public.qa_confidence_prompt
              WHERE org_id = $1 ORDER BY version DESC LIMIT 1`,
            [orgId]
        );
        const r = rows[0];
        if (r) {
            return {
                uncertainDef: r.uncertain_def ?? DEFAULT_UNCERTAIN_DEF,
                contradictionDef: r.contradiction_def ?? DEFAULT_CONTRADICTION_DEF,
                version: r.version ?? 1,
                isDefault: r.uncertain_def == null && r.contradiction_def == null,
                updatedAt: r.updated_at ?? null,
            };
        }
    } catch (e) {
        logger.warn(`[judge] 프롬프트 정의문 조회 실패(${e?.message || e}) — 기본값 사용`);
    }
    return {
        uncertainDef: DEFAULT_UNCERTAIN_DEF,
        contradictionDef: DEFAULT_CONTRADICTION_DEF,
        version: 0,
        isDefault: true,
        updatedAt: null,
    };
}

function buildUserContent(items) {
    // 항목별 점수+근거를 LLM 에 전달(JSON). 근거가 없으면 빈 문자열.
    const payload = items.map((it) => ({
        order_no: it.order_no,
        item: it.item ?? '',
        score: it.score ?? null,
        max: it.max ?? null,
        reason: String(it.reason_text ?? '').trim(),
    }));
    return `다음은 한 콜의 평가항목별 점수와 근거입니다. 각 항목을 판정해 JSON 으로만 답하세요.\n\n${JSON.stringify(payload, null, 0)}`;
}

function normalize(raw, items) {
    // LLM 응답을 입력 order_no 기준으로 정규화 — 누락 항목은 전부 false.
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        const s = String(raw).indexOf('{');
        const e = String(raw).lastIndexOf('}');
        if (s < 0 || e < 0) throw new Error('판정 응답에서 JSON 을 찾지 못함');
        parsed = JSON.parse(String(raw).slice(s, e + 1));
    }
    const byOrder = new Map();
    for (const r of Array.isArray(parsed?.items) ? parsed.items : []) {
        const n = Number(r?.order_no);
        if (Number.isFinite(n)) byOrder.set(n, r);
    }
    return items.map((it) => {
        const r = byOrder.get(Number(it.order_no)) || {};
        return {
            order_no: Number(it.order_no),
            uncertain: r.uncertain === true,
            weak: r.weak === true,
            contradiction: r.contradiction === true,
            note: String(r.note ?? '').trim().slice(0, 200),
        };
    });
}

/**
 * 한 콜의 항목들을 판정. items: [{order_no, item, score, max, reason_text}].
 * @returns {Promise<Array<{order_no,uncertain,weak,contradiction,note}>>}
 */
export async function judgeReasons(items, { systemPrompt } = {}) {
    if (!judgeEnabled()) throw new Error('GEMINI_API_KEY 미설정 — 판정 비활성');
    const list = Array.isArray(items) ? items.filter((x) => x && Number.isFinite(Number(x.order_no))) : [];
    if (!list.length) return [];

    const key = String(process.env.GEMINI_API_KEY).trim();
    const model = judgeModel();
    const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${key}`;
    const body = {
        systemInstruction: { parts: [{ text: systemPrompt || DEFAULT_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserContent(list) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
        }
        const j = await res.json();
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!text) throw new Error('Gemini 응답 텍스트 없음');
        return normalize(text, list);
    } finally {
        clearTimeout(timer);
    }
}
