/**
 * 대시보드 eval_item_defs(department='기본') → 커스텀 루브릭 빌더.
 *
 * 평가 시 백엔드(qa-pipeline, QA_RUBRIC_SOURCE=db)가 동일 쿼리로 eval_item_defs 를 읽어
 * 루브릭을 구성하므로 본 파일과 SSOT 동기 필수(v2/rubrics/db_source.py).
 * 대시보드는 metadata.org_id 만 전달하고, 응답 5000+index 항목을 order_no 로 환원하기 위한
 * orderMap(index→order_no) 만 본 빌더로 로컬 산출한다.
 *
 * 점수 항목 = order_no {1,2,4~14,17,18}. #3(파이프라인 미산출)·#15·#16(KMS 충족률 모델 대체)은 제외 —
 * 단, 해당 순번의 항목명이 코오롱 표준과 일치할 때만(타 테넌트 자체 항목은 보존).
 */

const SYNC_DEPARTMENT = '기본';
const RUBRIC_TENANT_ID = 'kolon';
const RUBRIC_NAME = '코오롱 표준 (dev프론트)';

const RUBRIC_EXCLUDED_ORDER_NOS = new Set([3, 15, 16]);
const KOLON_LEGACY_ITEM_NAMES = new Map([
    [3, '경청 (말겹침/말자름)'],
    [15, '정확한 안내'],
    [16, '필수 안내 이행'],
]);

// 카탈로그 기본 배점 — #10=10, 나머지=5.
const CATALOG_MAX_SCORE = new Map([[10, 10]]);
function catalogMaxScore(orderNo) {
    return CATALOG_MAX_SCORE.get(orderNo) ?? 5;
}

// 카탈로그 기본 점수 단계(qa_rules.py): #1~9·#11~14=[5,3,0] / #10=[10,7,5,0] / #17·#18=[5,0].
const CATALOG_ALLOWED_STEPS = new Map([
    [10, [10, 7, 5, 0]],
    [17, [5, 0]],
    [18, [5, 0]],
]);
function catalogAllowedSteps(orderNo, maxScore) {
    const base = CATALOG_ALLOWED_STEPS.get(orderNo) ?? [5, 3, 0];
    const ms = Math.round(Number(maxScore));
    if (!Number.isFinite(ms) || ms === base[0]) {
        return base.slice();
    }
    // 배점 변경 시 단계 구조를 새 만점에 비례 스케일(그라데이션 유지). 이진 항목(#17·#18)은 [max,0] 유지.
    const top = base[0];
    if (!Number.isFinite(top) || top <= 0 || ms <= 0) {
        return ms > 0 ? [ms, 0] : [0];
    }
    const factor = ms / top;
    const scaled = base.map((s) => Math.round(s * factor));
    scaled[0] = ms;
    const out = Array.from(new Set(scaled.filter((n) => Number.isFinite(n) && n >= 0))).sort(
        (a, b) => b - a,
    );
    if (out[out.length - 1] !== 0) out.push(0);
    return out.length >= 2 ? out : [ms, 0];
}

function safeStr(value) {
    return value === null || value === undefined ? '' : String(value);
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * eval_item_defs(org, department='기본', is_active) 를 order_no 오름차순으로 읽어 루브릭 items[] 조립.
 * @returns {Promise<{rubric:{tenant_id,name,items:Array}, orderMap:number[], rowMeta:Array}>}
 *   orderMap[index] = 루브릭 항목의 order_no, rowMeta[index] = {order_no,category,item,max_score}.
 */
export async function buildRubricFromDefs(pool, orgId) {
    const { rows } = await pool.query(
        `SELECT order_no, category, item, criterion, prompt_template, max_score
           FROM public.eval_item_defs
          WHERE org_id = $1
            AND department = $2
            AND deactivated_at IS NULL
            AND is_active = true
          ORDER BY order_no ASC`,
        [orgId, SYNC_DEPARTMENT]
    );

    const items = [];
    const orderMap = [];
    const rowMeta = [];
    for (const row of rows) {
        const orderNo = asNumber(row.order_no);
        if (orderNo === null) continue;
        if (
            RUBRIC_EXCLUDED_ORDER_NOS.has(orderNo) &&
            safeStr(row.item).trim() === KOLON_LEGACY_ITEM_NAMES.get(orderNo)
        ) {
            continue;
        }

        const dbMax = asNumber(row.max_score);
        const maxScore = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : catalogMaxScore(orderNo);
        const allowedSteps = catalogAllowedSteps(orderNo, maxScore);
        const itemName = safeStr(row.item).trim() || `항목 ${orderNo}`;
        const categoryName = safeStr(row.category).trim();

        items.push({
            name: itemName,
            category: categoryName,
            max_score: maxScore,
            allowed_steps: allowedSteps,
            criteria_full: safeStr(row.criterion),
            // 항목 전용 평가 프롬프트 — 동봉해야 백엔드가 LLM 에 원문 주입(누락 시 만점 기준만 전달됨).
            prompt_template: safeStr(row.prompt_template),
            notes: null,
            few_shot: false,
            debate: false,
            is_bonus: false,
        });
        orderMap.push(orderNo);
        rowMeta.push({ order_no: orderNo, category: categoryName, item: itemName, max_score: maxScore });
    }

    return {
        rubric: { tenant_id: RUBRIC_TENANT_ID, name: RUBRIC_NAME, items },
        orderMap,
        rowMeta,
    };
}
