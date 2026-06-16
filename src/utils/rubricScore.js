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

export function parseStoredEarned(raw, maxPts, item) {
    const rawS = String(raw ?? '').trim();
    if (rawS === '') return null;
    if (rawS === '평가제외') return null;
    if (MANUAL_JUDGMENT_LABELS.includes(rawS)) return null;
    const t = rawS.replace(/점$/u, '');
    if (t === '평가제외') return null;
    const n = parseFloat(t);
    if (Number.isFinite(n)) return Math.max(0, Math.min(maxPts, n));
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
    const mi = Math.round(m) === m ? String(Math.round(m)) : String(m);
    return `${ei} / ${mi}`;
}

/** 구형 긍부중·평가제외·숫자 문자열 → 수기 셀렉트 값 */
export function legacyManualToSelectValue(raw, maxPts, item) {
    const t = String(raw ?? '').trim();
    if (t === '') return '';
    if (t === '평가제외') return '평가제외';
    if (t === '긍정') {
        const opts = rubricTierOptions(item, maxPts).filter((v) => v !== '평가제외');
        return opts[0] || '';
    }
    if (t === '중립') {
        const opts = rubricTierOptions(item, maxPts).filter((v) => v !== '평가제외');
        if (opts.length >= 2) return opts[1];
        return opts[0] || '0';
    }
    if (t === '부정') return '0';
    const earned = parseStoredEarned(t, maxPts, item);
    const e = earned === null ? 0 : earned;
    const ei = Math.round(e) === e ? String(Math.round(e)) : String(Math.round(e * 10) / 10);
    return ei;
}
