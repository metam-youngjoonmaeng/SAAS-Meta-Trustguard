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

// 브랜드 편집에서 도메인 변경 시 '기본' 트랙 평가항목을 교체(재시드).
//   - 기존 활성 '기본' 행은 soft-delete(deactivated_at=now, is_active=false) — 이력 보존(eval_item_defs FK 참조 0개라 안전).
//   - 새 항목은 version=MAX(version)+1 로 INSERT → buildRubricFromDefs(active 필터, version 미고정)가 즉시 새 셋 사용.
//     versioned_uk(org,department,order_no,version) 는 새 version 으로 충돌 회피(같은 order_no 재사용 가능).
//   - applyDefaults=true: 도메인 기본 평가항목(domain_default_eval_items) 복제(0건이면 '첫인사' 폴백).
//   - applyDefaults=false: '첫인사' 1항목만.
//   호출부(트랜잭션)가 client 를 넘긴다. 반환 { count, mode: 'domain' | 'minimal' }.
export async function applyDomainEvalItems(client, orgId, domainId, applyDefaults) {
    if (!Number.isFinite(Number(orgId))) {
        throw new Error('applyDomainEvalItems: orgId must be a number');
    }
    // 1) 기존 활성 '기본' 행 soft-delete (목록·평가에서 즉시 제외, 버전 이력 보존)
    await client.query(
        `UPDATE public.eval_item_defs
            SET deactivated_at = now(), is_active = false, updated_at = now()
          WHERE org_id = $1 AND department = $2 AND deactivated_at IS NULL`,
        [orgId, SEED_DEPARTMENT]
    );
    // 2) 삽입 소스 결정 — 도메인 기본 우선, 없거나 미적용이면 '첫인사' 폴백
    let rows = [];
    let mode = 'minimal';
    if (applyDefaults && domainId != null && Number.isFinite(Number(domainId))) {
        const r = await client.query(
            `SELECT order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active
               FROM public.domain_default_eval_items
              WHERE domain_id = $1 AND is_active = true
              ORDER BY order_no ASC, id ASC`,
            [domainId]
        );
        if (r.rows.length > 0) {
            rows = r.rows;
            mode = 'domain';
        }
    }
    if (rows.length === 0) {
        rows = MINIMAL_EVAL_ITEMS.map((m) => ({
            order_no: m.order_no,
            category: m.category,
            item: m.item,
            criterion: null,
            prompt_template: null,
            pentagon_axis: null,
            scoring_type: 'numeric',
            max_score: null,
            is_active: true,
        }));
        mode = 'minimal';
    }
    // 3) 새 version (org+department 전역 단조)
    const { rows: vRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS mv
           FROM public.eval_item_defs
          WHERE org_id = $1 AND department = $2`,
        [orgId, SEED_DEPARTMENT]
    );
    const nextVersion = (vRows[0]?.mv || 0) + 1;
    // 4) INSERT (department='기본', 새 version)
    for (const r of rows) {
        await client.query(
            `INSERT INTO public.eval_item_defs
                 (org_id, order_no, category, item, criterion, prompt_template,
                  pentagon_axis, scoring_type, max_score, is_active,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), NULL, now())`,
            [
                orgId, r.order_no, r.category, r.item, r.criterion ?? null,
                r.prompt_template ?? null, r.pentagon_axis ?? null,
                r.scoring_type || 'numeric', r.max_score ?? null,
                r.is_active === false ? false : true,
                SEED_DEPARTMENT, nextVersion,
            ]
        );
    }
    return { count: rows.length, mode };
}
