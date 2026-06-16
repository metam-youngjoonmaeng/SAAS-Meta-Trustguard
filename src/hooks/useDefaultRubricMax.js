import { useEffect, useMemo, useState } from 'react';
import { fetchEvalItemDefs } from '../services/api';
import {
    DEFAULT_TOTAL_MAX,
    buildCategoryMaxPoints,
    sumTemplateMaxPoints,
    parseTemplateMaxPoints,
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

export default function useDefaultRubricMax({ enabled, fallbackTemplate } = {}) {
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
    }, [enabled]);

    return useMemo(() => {
        const template = Array.isArray(fallbackTemplate) ? fallbackTemplate : [];
        const fallback = {
            totalMax: sumTemplateMaxPoints(template) || DEFAULT_TOTAL_MAX,
            categoryMaxPoints: buildCategoryMaxPoints(template),
            maxByOrderNo: {},
            loaded,
        };
        // 비기본 브랜드(enabled=false) 또는 DB 미적재 → 정적 폴백.
        if (!enabled || !defsByOrderNo) return fallback;

        let totalMax = 0;
        const categoryMaxPoints = {};
        const maxByOrderNo = {};
        for (const t of template) {
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
        // 템플릿이 비었거나 합계 0 이면 폴백(오표시 방지).
        if (totalMax <= 0) return fallback;
        return { totalMax, categoryMaxPoints, maxByOrderNo, loaded };
    }, [enabled, defsByOrderNo, fallbackTemplate, loaded]);
}
