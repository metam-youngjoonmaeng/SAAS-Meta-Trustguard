/** STT 배점표 — 항목별 만점·선택 가능 득점 (한화 8항목 기준) */

const ITEM_TIER_OPTIONS = {
    '전화수신/종료태도': ['10', '7', '4', '평가제외'],
    '첫인사': ['10', '7', '4', '평가제외'],
    '끝인사': ['10', '6', '평가제외'],
    '문의내용 파악/경청': ['10', '7', '4', '평가제외'],
    '사과/대기/감사표현': ['10', '7', '4', '평가제외'],
    '정확한 업무처리': ['20', '16', '12', '8', '평가제외'],
    '정보보호': ['10', '5', '평가제외'],
    '상담태도': ['20', '16', '12', '8', '평가제외'],
};

export function parseMaxPointsFromValidationTime(vt) {
    const s = String(vt || '').trim();
    if (!s.startsWith('배점')) return 5;
    const n = parseFloat(s.replace('배점', '').trim());
    return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * 행의 항목 만점 — server/rubricManual.mjs::maxPointsOf 와 동일 규약.
 *
 * API 는 만점을 숫자 `max_score` 로 내려준다(qa_call_item_score). 정적 폴백 템플릿
 * (constants.js)은 아직 문자열 `validation_time`('배점 10') 을 쓰므로 둘 다 받는다.
 * 둘 다 없으면 null — 호출부가 '만점 미상' 을 스스로 판단하게 한다.
 * ★ parseMaxPointsFromValidationTime 을 바로 부르면 값이 없을 때 조용히 5 점이 붙어
 *   분모가 틀어지므로, 응답 행에는 반드시 이 함수를 쓴다.
 */
export function maxPointsOf(row) {
    const ms = row?.max_score;
    if (ms !== null && ms !== undefined && ms !== '') {
        const n = Number(ms);
        if (Number.isFinite(n) && n > 0) return n;
    }
    if (row?.validation_time !== null && row?.validation_time !== undefined) {
        return parseMaxPointsFromValidationTime(row.validation_time);
    }
    return null;
}

/**
 * 감점전용 항목 여부 — `max_score` 가 **명시적 0**.
 *
 * 배점 없이 `0`(무감점) 또는 음수(감점, 예 −5)만 판정하는 항목이다.
 * `maxPointsOf` 는 `n > 0` 조건이라 0 을 흡수하지 못하고 null 을 돌려주므로,
 * 호출부가 5점·정적템플릿 값으로 폴백해 분모가 `0 / 5`·`0 / 20` 처럼 틀어진다.
 * 그 폴백 이전에 이 함수로 먼저 걸러야 한다.
 *
 * ★ null·undefined·'' 는 **만점 미상**이므로 감점전용이 아니다(기존 폴백 유지).
 */
export function isDeductionOnlyRow(row) {
    const ms = row?.max_score;
    if (ms === null || ms === undefined || ms === '') return false;
    const n = Number(ms);
    return Number.isFinite(n) && n === 0;
}

export function rubricTierOptions(item, maxPts) {
    const it = String(item || '').trim();
    if (ITEM_TIER_OPTIONS[it]) {
        return ITEM_TIER_OPTIONS[it];
    }
    const rounded = Math.round(Number(maxPts) || 0);
    if (rounded >= 20) return ['20', '16', '12', '8', '평가제외'];
    if (rounded >= 10) return ['10', '7', '4', '평가제외'];
    if (rounded >= 6) return ['10', '6', '평가제외'];
    return ['평가제외'];
}

// 새 수기평가 모델의 판단 라벨 — manual_eval 에 점수 tier 대신 그대로 저장된다.
// 점수 집계에서는 '평가제외' 와 동일하게 제외 (server/rubricManual.mjs 와 동일 규칙).
const MANUAL_JUDGMENT_LABELS = ['낮음', '동일', '높음'];

export function parseStoredEarned(raw, maxPts, item, opts) {
    const rawS = String(raw ?? '').trim();
    if (rawS === '') return null;
    if (rawS === '평가제외') return null;
    if (MANUAL_JUDGMENT_LABELS.includes(rawS)) return null;
    const t = rawS.replace(/점$/u, '');
    if (t === '평가제외') return null;
    const n = parseFloat(t);
    // 표시 분모 분리: 수기 획득점도 분모 초과 시 그대로 보존(분자>분모 허용). 하한 0 만 유지.
    // 레거시·ecom·bank 는 score<=maxPts 라 무회귀.
    // ★ `opts.allowNegative` — 감점전용 항목(허용 0/−5)은 하한 0 클램프를 하지 않는다.
    //   클램프하면 −5 감점이 0 으로 표시돼 감점 자체가 화면에서 사라진다.
    if (Number.isFinite(n)) return opts?.allowNegative ? n : Math.max(0, n);
    const r = t.toLowerCase();
    const tiers = rubricTierOptions(item, maxPts).filter((v) => v !== '평가제외');
    const top = Number(tiers[0] || 0);
    const mid = Number(tiers[1] || 0);
    if (r === 'success') return top;
    if (r === 'caution') return mid;
    if (r === 'fail') return 0;
    return 0;
}

export function formatEarnedOverMax(earned, maxPts) {
    if (earned === null || earned === undefined || Number.isNaN(earned)) return '-';
    const e = Number(earned);
    const m = Number(maxPts);
    const ei = Math.round(e) === e ? String(Math.round(e)) : String(Math.round(e * 10) / 10);
    // ★ 감점전용 항목(만점 0) — 분모 표기 없이 부호 있는 값으로 표기.
    //   `0 / 0` 이나 `0 / 5` 는 척도를 잘못 알린다. 0 = 무감점 · 음수 = 감점.
    if (Number.isFinite(m) && m === 0) {
        const r = Math.round(e * 10) / 10;
        if (r === 0) return '0';
        return r < 0 ? `−${Math.abs(r)}` : `+${r}`;
    }
    const mi = Math.round(m) === m ? String(Math.round(m)) : String(m);
    return `${ei} / ${mi}`;
}
