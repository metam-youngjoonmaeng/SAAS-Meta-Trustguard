import { useEffect, useMemo, useState } from 'react';
import { fetchEvalItemDefs } from '../services/api';
import {
    DEFAULT_TOTAL_MAX,
    buildCategoryMaxPoints,
    sumTemplateMaxPoints,
    parseTemplateMaxPoints,
    buildChecklistTemplateFromDefs,
} from '../constants';

// 기본 브랜드(코오롱/기본) 표준 루브릭의 만점(분모)을 EvalItems 탭이 편집하는
// 동일 DB(eval_item_defs, department='기본') 에서 라이브로 읽어오는 공유 훅.
//
// 산출 방식 = 정적 템플릿(항목 목록 + 기본 배점) 기준 + DB override 병합:
//   항목별 만점 = DB def.max_score 가 있으면 그 값(yes_no=1), 없으면 템플릿 기본 배점.
//   ★ DB 항목만 합산하면 안 됨 — 미편집 항목은 eval_item_defs.max_score 가 null 이라
//     편집된 한 항목(예: 끝인사 3점)만 합산돼 분모가 그 점수로 붕괴됨(78 → 3 버그).
//   def.is_active=false 항목은 합계에서 제외.
//
// 분모 라이브 갱신 한계: 이미 평가된 콜은 평가 시점 루브릭의 %·내장 만점이 동결됨.
// 본 훅은 표시 분모(denominator)만 갱신 — 전체 재채점은 재평가 필요.
//
// enabled=false(신한/한화 등) 이거나 DB 미적재면 fallbackTemplate(정적 합계)로 폴백.

// activeBrandId: 활성 브랜드 식별자. fetchEvalItemDefs 는 X-Active-Brand-Id 헤더로 브랜드를
//   구분하므로, 브랜드 전환 시 반드시 재조회해야 컬럼(카테고리)·분모가 새 브랜드로 갱신된다.
//   ★ effect deps 에 포함하지 않으면 enabled 값이 그대로인 브랜드 간 전환(예: 동적→동적)에서
//     재조회가 안 돼 직전 브랜드 항목이 stale 로 남고, 새로고침해야만 정상화되는 버그가 생긴다.
export default function useDefaultRubricMax({ enabled, fallbackTemplate, dynamicList = false, activeBrandId } = {}) {
    // DB eval_item_defs(department='기본') 를 order_no → def 맵으로 보관. null=미적재.
    const [defsByOrderNo, setDefsByOrderNo] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setDefsByOrderNo(null);
            setLoaded(false);
            return undefined;
        }
        let cancelled = false;
        fetchEvalItemDefs({ department: '기본' })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.items) ? res.items : [];
                const map = {};
                for (const d of list) {
                    if (d?.order_no === undefined || d?.order_no === null || d?.order_no === '') continue;
                    map[Number(d.order_no)] = d;
                }
                setDefsByOrderNo(map);
                setLoaded(true);
            })
            .catch(() => {
                // 조회 실패 → 폴백 (throw 금지)
                if (!cancelled) {
                    setDefsByOrderNo(null);
                    setLoaded(false);
                }
            });
        return () => { cancelled = true; };
        // activeBrandId 포함 — 브랜드 전환 시 새 브랜드 항목으로 재조회(stale 컬럼/분모 방지).
    }, [enabled, activeBrandId]);

    return useMemo(() => {
        const staticTemplate = Array.isArray(fallbackTemplate) ? fallbackTemplate : [];
        // 신규 브랜드(dynamicList): DB 행으로 체크리스트 리스트 자체를 구성. 그 외: 정적 템플릿.
        const effectiveTemplate =
            dynamicList && defsByOrderNo
                ? buildChecklistTemplateFromDefs(Object.values(defsByOrderNo))
                : staticTemplate;
        const fallback = {
            totalMax: sumTemplateMaxPoints(staticTemplate) || DEFAULT_TOTAL_MAX,
            categoryMaxPoints: buildCategoryMaxPoints(staticTemplate),
            maxByOrderNo: {},
            effectiveTemplate,
            loaded,
        };
        // 비기본 브랜드(enabled=false) 또는 DB 미적재 → 정적 폴백.
        if (!enabled || !defsByOrderNo) return fallback;

        let totalMax = 0;
        const categoryMaxPoints = {};
        const maxByOrderNo = {};
        for (const t of effectiveTemplate) {
            const orderNo = Number(t.order_no);
            const def = defsByOrderNo[orderNo];
            const active = def ? (def.is_active ?? true) : true;
            if (!active) continue; // 비활성 항목은 분모에서 제외
            let max;
            if (def && def.max_score !== undefined && def.max_score !== null && def.max_score !== '') {
                max = def.scoring_type === 'yes_no' ? 1 : Number(def.max_score);
            } else {
                max = parseTemplateMaxPoints(t.validation_time); // 미편집 → 템플릿 기본 배점
            }
            if (!Number.isFinite(max) || max <= 0) continue;
            const cat = (def && def.category) || t.category || '';
            totalMax += max;
            categoryMaxPoints[cat] = (categoryMaxPoints[cat] || 0) + max;
            if (Number.isFinite(orderNo)) maxByOrderNo[orderNo] = max;
        }
        // 합계 0 (신규 브랜드 항목 0 등) → 만점은 정적 폴백, effectiveTemplate 은 보존.
        if (totalMax <= 0) return fallback;
        return { totalMax, categoryMaxPoints, maxByOrderNo, effectiveTemplate, loaded };
    }, [enabled, defsByOrderNo, fallbackTemplate, dynamicList, loaded]);
}
