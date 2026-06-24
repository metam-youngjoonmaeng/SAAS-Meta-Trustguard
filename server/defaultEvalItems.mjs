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

// ============================================================
// 도메인(업종)별 기본 평가항목 — DB의 '템플릿(원본) 브랜드' eval_item_defs 가 단일 원본(SSOT).
//   신규 브랜드 생성 시, 선택한 도메인의 템플릿 브랜드 활성 평가항목을 그대로 복사한다.
//   ★원본은 100% DB에 있고(템플릿 브랜드의 AI QA 항목관리 UI에서 직접 편집·증감),
//    코드엔 '도메인 key ↔ 템플릿 브랜드 이름' 매핑만 둔다 — DB 스키마 변경 0, dev/prod 공통,
//    환경별 org_id 비의존. 신규 브랜드 항목은 실제 eval_item_defs 행이라 항목관리에 자동 연동
//    (신규 org 는 동적 빌드). 템플릿 편집은 다음 신규 브랜드부터 반영(이미 생성분엔 소급 안 함).
//   템플릿 브랜드: '이커머스' = 유통/이커머스(ecommerce) 13항목(100점). 금융 등은 키만 추가.
// ============================================================

// 도메인 key(domains.key) → 템플릿(원본) 브랜드 이름(organizations.name).
export const DOMAIN_TEMPLATE_BRAND = {
    ecommerce: '이커머스',
};

// 도메인 템플릿 브랜드의 org_id 해석 — 이름 일치(가장 낮은 id). 매핑/브랜드 없으면 null.
async function resolveTemplateOrgId(client, domainKey) {
    const name = domainKey ? DOMAIN_TEMPLATE_BRAND[domainKey] : null;
    if (!name) return null;
    const { rows } = await client.query(
        'SELECT id FROM public.organizations WHERE name = $1 ORDER BY id ASC LIMIT 1',
        [name]
    );
    return rows[0]?.id ?? null;
}

// 템플릿 브랜드의 활성 평가항목을 신규 브랜드로 복사(DB→DB). version/department 는 신규 스코프로 정규화.
async function copyEvalItemsFromTemplate(client, targetOrgId, templateOrgId) {
    const { rowCount } = await client.query(
        `INSERT INTO public.eval_item_defs
             (org_id, order_no, category, item, criterion, prompt_template,
              max_score, scoring_type, department, version, effective_from, deactivated_at, updated_at)
         SELECT $1, order_no, category, item, criterion, prompt_template,
                max_score, scoring_type, $2, $3, now(), NULL, now()
           FROM public.eval_item_defs
          WHERE org_id = $4 AND deactivated_at IS NULL
         ON CONFLICT (org_id, department, order_no, version) DO NOTHING`,
        [targetOrgId, SEED_DEPARTMENT, SEED_VERSION, templateOrgId]
    );
    return rowCount;
}

// 신규 브랜드 시드 — 도메인 템플릿 브랜드의 기본 평가항목 복사 우선, 없으면 첫인사 1항목 폴백.
//   domainKey: domains.key (예: 'ecommerce'). 템플릿 미존재 / 자기참조 / 복사 0건이면 minimal 폴백.
export async function seedDomainEvalItems(client, orgId, domainKey) {
    const templateOrgId = await resolveTemplateOrgId(client, domainKey);
    if (templateOrgId && templateOrgId !== orgId) {
        const copied = await copyEvalItemsFromTemplate(client, orgId, templateOrgId);
        if (copied > 0) return copied;
    }
    return seedMinimalEvalItems(client, orgId);
}
