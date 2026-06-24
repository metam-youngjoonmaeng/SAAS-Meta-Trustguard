// 신규 브랜드 생성 시 eval_item_defs 에 기본 시드되는 18 항목.
// 원본: 01-QA_Dashboard/src/constants.js 의 CHECKLIST_TEMPLATE (STT 상담 품질 평가표).
// criterion / prompt_template 는 NULL — UI 에서 운영자가 추후 작성.

export const DEFAULT_EVAL_ITEMS = [
    { order_no: 1,  category: '인사 예절',         item: '첫인사' },
    { order_no: 2,  category: '인사 예절',         item: '끝인사' },
    { order_no: 3,  category: '경청 및 소통',      item: '경청 (말겹침/말자름)' },
    { order_no: 4,  category: '경청 및 소통',      item: '호응 및 공감' },
    { order_no: 5,  category: '경청 및 소통',      item: '대기 멘트' },
    { order_no: 6,  category: '언어 표현',         item: '정중한 표현' },
    { order_no: 7,  category: '언어 표현',         item: '쿠션어 활용' },
    { order_no: 8,  category: '니즈 파악',         item: '문의 파악 및 재확인(복창)' },
    { order_no: 9,  category: '니즈 파악',         item: '고객정보 확인' },
    { order_no: 10, category: '설명력 및 전달력',  item: '설명의 명확성' },
    { order_no: 11, category: '설명력 및 전달력',  item: '두괄식 답변' },
    { order_no: 12, category: '적극성',            item: '문제 해결 의지' },
    { order_no: 13, category: '적극성',            item: '부연 설명 및 추가 안내' },
    { order_no: 14, category: '적극성',            item: '사후 안내' },
    { order_no: 15, category: '업무 정확도',       item: '정확한 안내' },
    { order_no: 16, category: '업무 정확도',       item: '필수 안내 이행' },
    { order_no: 17, category: '개인정보 보호',     item: '정보 확인 절차' },
    { order_no: 18, category: '개인정보 보호',     item: '정보 보호 준수' },
];

// 신규 브랜드(id≥4) 최소 시드 — '첫인사' 1항목만. 코오롱 표준 18항목 자동 상속 차단.
// (요구: 신규 브랜드는 텅 빈 상태에서 첫인사만 — 나머지는 운영자가 UI 에서 추가)
export const MINIMAL_EVAL_ITEMS = [
    { order_no: 1, category: '인사 예절', item: '첫인사' },
];

// 07_eval_item_defs.sql 의 4-tuple UNIQUE (org_id, department, order_no, version) 키에 정합.
// department 는 버전 스코프 marker — 신규 브랜드는 부서 구분 없이 '기본' 스코프 단일 트랙으로 시작.
// (신한처럼 부서별 트랙이 필요하면 추후 별도 시드 또는 마이그로 분기)
const SEED_DEPARTMENT = '기본';
const SEED_VERSION = 1;

// 항목 배열을 받아 eval_item_defs 에 시드하는 공통 구현 (criterion/prompt = NULL).
async function seedEvalItems(client, orgId, items) {
    if (!Number.isFinite(Number(orgId))) {
        throw new Error('seedEvalItems: orgId must be a number');
    }
    for (const row of items) {
        await client.query(
            `INSERT INTO public.eval_item_defs
                 (org_id, order_no, category, item, criterion, prompt_template,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, now(), NULL, now())
             ON CONFLICT (org_id, department, order_no, version) DO NOTHING`,
            [orgId, row.order_no, row.category, row.item, SEED_DEPARTMENT, SEED_VERSION]
        );
    }
    return items.length;
}

// 코오롱 표준 18항목 시드 (기존 호출 호환 — 현재 신규 생성 경로에서는 미사용).
export async function seedDefaultEvalItems(client, orgId) {
    return seedEvalItems(client, orgId, DEFAULT_EVAL_ITEMS);
}

// 신규 브랜드 시드 — 첫인사 1항목.
export async function seedMinimalEvalItems(client, orgId) {
    return seedEvalItems(client, orgId, MINIMAL_EVAL_ITEMS);
}

// 신규 브랜드 시드 — 도메인(업종)별 기본 평가항목(domain_default_eval_items)을 복제.
// domain_default_eval_items 의 활성 행을 eval_item_defs 로 그대로 옮긴다
// (department='기본', version=1; 메타 컬럼 pentagon_axis/scoring_type/max_score/is_active 포함).
// 도메인이 없거나(domainId=null) 해당 도메인에 디폴트가 0건이면 0 을 반환 →
// 호출부가 seedMinimalEvalItems('첫인사') 로 폴백한다.
export async function seedEvalItemsFromDomain(client, orgId, domainId) {
    if (!Number.isFinite(Number(orgId))) {
        throw new Error('seedEvalItemsFromDomain: orgId must be a number');
    }
    if (domainId == null || !Number.isFinite(Number(domainId))) return 0;
    const { rows } = await client.query(
        `SELECT order_no, category, item, criterion, prompt_template,
                pentagon_axis, scoring_type, max_score, is_active
           FROM public.domain_default_eval_items
          WHERE domain_id = $1 AND is_active = true
          ORDER BY order_no ASC, id ASC`,
        [domainId]
    );
    if (rows.length === 0) return 0;
    for (const r of rows) {
        await client.query(
            `INSERT INTO public.eval_item_defs
                 (org_id, order_no, category, item, criterion, prompt_template,
                  pentagon_axis, scoring_type, max_score, is_active,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), NULL, now())
             ON CONFLICT (org_id, department, order_no, version) DO NOTHING`,
            [
                orgId, r.order_no, r.category, r.item, r.criterion ?? null,
                r.prompt_template ?? null, r.pentagon_axis ?? null,
                r.scoring_type || 'numeric', r.max_score ?? null,
                r.is_active === false ? false : true,
                SEED_DEPARTMENT, SEED_VERSION,
            ]
        );
    }
    return rows.length;
}
