/**
 * checklist_rows → 대분류별 "득점/만점" (scripts/seed_postgres_from_csv.py 의 build_checklist_category_earned_max_str 와 동일 목적)
 */
import { parseMaxPointsFromValidationTime, parseStoredEarned } from './rubricManual.mjs';

// 신한카드 — 컬렉션관리부 9항목을 4 대분류로 묶어 노출.
export const CHECKLIST_KEYS = [
    '친절도',
    '맞춤 응대 스킬',
    '업무 정확도',
    '사후 처리',
];

// 한화손해보험 — 8항목, category == item 1:1.
export const HANWHA_CHECKLIST_KEYS = [
    '전화수신/종료태도', '첫인사', '끝인사', '문의내용 파악/경청',
    '사과/대기/감사표현', '정확한 업무처리', '정보보호', '상담태도',
];

// 기본 평가체계 (지역정보개발원 등 BRAND_CONFIG 미등록 브랜드용) — 01-QA_Dashboard 18항목 8 카테고리.
// SSOT: src/constants.js DEFAULT_CHECKLIST_KEYS / server/defaultEvalItems.mjs DEFAULT_EVAL_ITEMS.
// 업무 정확도(#15/#16)는 qa-pipeline KMS 충족률 모델로 대체되어 점수 미산출 → 컬럼 제외.
export const DEFAULT_CHECKLIST_KEYS = [
    '인사 예절', '경청 및 소통', '언어 표현', '니즈 파악',
    '설명력 및 전달력', '적극성', '개인정보 보호',
];

// 콜의 department 로 적절한 대시보드 컬럼 키 선택. 미매칭 시 신한 4 카테고리(레거시 호환).
export function checklistKeysForDepartment(department) {
    if (department === '고객센터') return HANWHA_CHECKLIST_KEYS;
    if (department === '고객지원실') return DEFAULT_CHECKLIST_KEYS;
    return CHECKLIST_KEYS;
}

/**
 * 부서 고정 키셋 vs 콜 자체 카테고리 중 유효한 쪽 선택.
 *
 * 동적 루브릭 콜(이커머스/은행 등 eval_item_defs 자체 항목)은 행 카테고리가 부서
 * 고정 키셋과 전혀 겹치지 않으므로 — 고정 키셋으로 집계 시 카테고리 합계 전부
 * 미산출('-') + 만점 합 0(프론트 80 폴백) — 행 카테고리를 키로 사용한다.
 * 코오롱 표준 콜은 일부라도 겹치므로 기존 키셋 유지 — #15/#16(업무 정확도) 행이
 * 키셋 밖이어도 합산에 더해지지 않아 만점 80 동결이 깨지지 않는다(회귀 방지).
 */
export function effectiveChecklistKeys(department, checklistRows) {
    const deptKeys = checklistKeysForDepartment(department);
    const rowCats = [];
    for (const r of checklistRows || []) {
        const c = String(r?.category || '').trim();
        if (c && !rowCats.includes(c)) rowCats.push(c);
    }
    if (rowCats.length === 0) return deptKeys;
    return rowCats.some((c) => deptKeys.includes(c)) ? deptKeys : rowCats;
}

/**
 * DB에 저장된 checklist_rows(result 없음) + evaluation_rows(ai_eval) 로
 * 대시보드 컬럼별 checklist_yn_kor 객체를 만든다.
 * keys 인자로 브랜드/부서별 카테고리 키 셋을 주입.
 */
export function buildChecklistYnKorFromDbRows(checklistRows, evaluationRows, keys = CHECKLIST_KEYS) {
    const aiByOrder = new Map(
        (evaluationRows || []).map((r) => {
            const n = Number(r.ai_eval);
            return [Number(r.order_no), Number.isFinite(n) ? n : 0];
        })
    );
    const augmented = (checklistRows || []).map((r) => ({
        ...r,
        result: aiByOrder.has(Number(r.order_no))
            ? String(aiByOrder.get(Number(r.order_no)))
            : String(r.result ?? ''),
    }));
    return buildChecklistYnKorFromChecklistRows(augmented, keys);
}

export function buildChecklistYnKorFromChecklistRows(checklistRows, keys = CHECKLIST_KEYS) {
    const out = {};
    if (!Array.isArray(checklistRows) || checklistRows.length === 0) return out;
    for (const key of keys) {
        const rows = checklistRows.filter((r) => String(r.category || '').trim() === key);
        let totalMax = 0;
        let totalEarned = 0;
        for (const row of rows) {
            const m = parseMaxPointsFromValidationTime(row.validation_time);
            totalMax += m;
            const earned = parseStoredEarned(row.result, m, row.item);
            totalEarned += earned === null ? 0 : earned;
        }
        const mi = Math.round(totalMax);
        let ei = Math.round(totalEarned);
        if (mi <= 0) out[key] = '0/0';
        else {
            ei = Math.max(0, Math.min(mi, ei));
            out[key] = `${ei}/${mi}`;
        }
    }
    return out;
}

/** DB checklist_yn_kor 가 비었거나 일부 키만 있을 때 checklist_rows 로 보강 */
export function mergeChecklistYnKor(storedObj, checklistRows) {
    const derived = buildChecklistYnKorFromChecklistRows(checklistRows);
    const stored = storedObj && typeof storedObj === 'object' && !Array.isArray(storedObj) ? storedObj : {};
    const kor = {};
    for (const key of CHECKLIST_KEYS) {
        const v = stored[key];
        if (v != null && String(v).trim() !== '') kor[key] = String(v).trim();
        else if (derived[key] != null) kor[key] = derived[key];
    }
    return kor;
}
