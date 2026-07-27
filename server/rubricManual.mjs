/**
 * 수기 배점 저장 시 manual_score 산출·검증 (프론트 src/utils/rubricScore.js 와 동일 규칙)
 *
 * v2 컬렉션관리부: 9개 항목, 직무별 만점 매트릭스(3/4/5/10/15/16/20).
 * 만점이 다양해서 항목별 hard-coded tier 대신 만점 기반 동적 tier 를 사용.
 */

export function parseMaxPointsFromValidationTime(vt) {
    const s = String(vt || '').trim();
    if (!s.startsWith('배점')) return 5;
    const n = parseFloat(s.replace('배점', '').trim());
    return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * 항목 만점 해석 — 병합(마이그레이션 67) 이후의 정본 경로.
 *
 * 배경: 구 모델은 항목 만점을 qa_checklist_rows.validation_time 에 '배점 N' 문자열로 저장하고
 *       읽을 때마다 파싱했다. Y/N 항목은 체크리스트 행을 아예 만들지 않아 총점 분모에서 빠졌다.
 *       병합 후에는 항목이 한 행뿐이므로 max_score = NULL 이 '분모 제외'를 표현한다.
 *
 * ★ null 반환은 "만점 정보 없음 = 분모에서 제외" 를 뜻한다. 절대 0 이나 5 로 대체하지 말 것 —
 *   그렇게 하면 Y/N 항목이 분모에 새로 잡혀 총점이 조용히 틀어진다.
 *
 * DB 행(max_score:number)과 적재 중 메모리 객체(validation_time:'배점 N') 양쪽을 모두 받는다.
 *
 * @param {{max_score?: number|null, validation_time?: string|null}} row
 * @returns {number|null} 만점, 또는 분모 제외를 뜻하는 null
 */
export function maxPointsOf(row) {
    if (row?.max_score !== null && row?.max_score !== undefined && row?.max_score !== '') {
        const n = Number(row.max_score);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (row?.validation_time !== null && row?.validation_time !== undefined) {
        return parseMaxPointsFromValidationTime(row.validation_time);
    }
    return null;
}

// 새 수기평가 모델의 판단 라벨 — manual_eval 컬럼에 점수 tier 대신 그대로 저장된다.
// 점수 집계(parseStoredEarned)에서는 '평가제외' 와 동일하게 제외 처리.
export const MANUAL_JUDGMENT_LABELS = ['낮음', '동일', '높음'];

/**
 * 만점에 따라 동적으로 [만점, ~70%, ~40%, '평가제외'] tier 를 생성.
 * 9개 항목 v2 직무별 만점(3/4/5/10/15/16/20) 모두 커버.
 */
export function allowedManualEvalValues(_item, maxPts) {
    const m = Math.round(Number(maxPts) || 0);
    if (m <= 0) return ['평가제외'];
    if (m >= 20) return ['20', '16', '12', '8', '평가제외'];
    if (m >= 15) return [String(m), String(Math.round(m * 0.75)), String(Math.round(m * 0.5)), '평가제외'];
    if (m >= 10) return ['10', '7', '4', '평가제외'];
    const tiers = [String(m)];
    const t1 = Math.round(m * 0.7);
    if (t1 < m && t1 > 0) tiers.push(String(t1));
    const t2 = Math.round(m * 0.4);
    if (t2 < t1 && t2 > 0) tiers.push(String(t2));
    tiers.push('평가제외');
    return tiers;
}

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
    const tiers = allowedManualEvalValues(item, maxPts).filter((v) => v !== '평가제외');
    const top = Number(tiers[0] || 0);
    const mid = Number(tiers[1] || 0);
    if (r === 'success') return top;
    if (r === 'caution') return mid;
    if (r === 'fail') return 0;
    return 0;
}

export function mergeManualPatches(existingEvalRows, patches) {
    const byOrder = new Map(
        (patches || []).map((p) => [Number(p.order_no), String(p.manual_eval ?? '').trim()])
    );
    return (existingEvalRows || []).map((er) => {
        const u = byOrder.get(Number(er.order_no));
        if (u === undefined) return er;
        return { ...er, manual_eval: u };
    });
}

export function computeManualRubricPct(evaluationRows, checklistRows) {
    const chByOrder = new Map((checklistRows || []).map((r) => [Number(r.order_no), r]));
    let num = 0;
    let den = 0;
    for (const er of evaluationRows || []) {
        const ch = chByOrder.get(Number(er.order_no)) || er;
        const maxPts = maxPointsOf(ch) ?? maxPointsOf(er);
        if (maxPts === null) continue;   // 만점 없음 = 분모 제외
        const item = String(er.item || ch.item || '').trim();
        const earned = parseStoredEarned(er.manual_eval, maxPts, item);
        if (earned === null) continue;
        den += maxPts;
        num += earned;
    }
    if (den <= 0) return null;
    return Math.round((100 * num) / den * 10) / 10;
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateMergedManualEvals(mergedEvalRows, checklistRows) {
    const chByOrder = new Map((checklistRows || []).map((r) => [Number(r.order_no), r]));
    for (const er of mergedEvalRows || []) {
        const ch = chByOrder.get(Number(er.order_no)) || er;
        const maxPts = maxPointsOf(ch) ?? maxPointsOf(er);
        if (maxPts === null) continue;   // 만점 없음 = 검증 대상 아님
        const item = String(er.item || ch.item || '').trim();
        const allowed = allowedManualEvalValues(item, maxPts);
        const v = String(er.manual_eval ?? '').trim();
        if (v === '') continue;
        if (MANUAL_JUDGMENT_LABELS.includes(v)) continue;
        if (!allowed.includes(v)) {
            return {
                ok: false,
                message: `order_no=${er.order_no} 수기값 "${v}" 는 허용 목록에 없습니다.`,
            };
        }
    }
    return { ok: true };
}
