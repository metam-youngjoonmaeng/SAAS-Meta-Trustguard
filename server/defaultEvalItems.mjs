// 신규 브랜드 생성 시 eval_item_defs 시드 — 최소 시드('첫인사' 1항목) · 도메인 템플릿 시드 · KSQI 항목 · 펜타곤 축.
// criterion / prompt_template 는 NULL — UI 에서 운영자가 추후 작성.
// ★통합DB: org_id(int) → tenant_id(citext). 테이블은 search_path(trustguard,common,public)로 해석.
// ※ 2026-09-03 정리: 표준 18항목 상수(DEFAULT_EVAL_ITEMS)와 그 시더(seedDefaultEvalItems)는 어디서도 호출되지 않아
//    제거했다(참조 그래프 실측 0). 표준 18항목의 정본은 DB(eval_item_defs) 와 프론트 constants 다.

// 신규 브랜드 최소 시드 — '첫인사' 1항목만. 표준 18항목 자동 상속 차단.
const MINIMAL_EVAL_ITEMS = [
    { order_no: 1, category: '인사 예절', item: '첫인사' },
];

// eval_item_defs 4-tuple UNIQUE (tenant_id, department, order_no, version) 키에 정합.
// department 는 버전 스코프 marker — 신규 브랜드는 '기본' 스코프 단일 트랙으로 시작.
const SEED_DEPARTMENT = '기본';
const SEED_VERSION = 1;

// tenant_id 유효성(citext 문자열) 가드.
function assertTenant(tenantId, fn) {
    if (!tenantId || typeof tenantId !== 'string') {
        throw new Error(`${fn}: tenantId must be a non-empty string`);
    }
}

// 항목 배열을 받아 eval_item_defs 에 시드하는 공통 구현 (criterion/prompt = NULL).
async function seedEvalItems(client, tenantId, items) {
    assertTenant(tenantId, 'seedEvalItems');
    for (const row of items) {
        await client.query(
            `INSERT INTO eval_item_defs
                 (tenant_id, order_no, category, item, criterion, prompt_template,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, now(), NULL, now())
             ON CONFLICT (tenant_id, department, order_no, version) DO NOTHING`,
            [tenantId, row.order_no, row.category, row.item, SEED_DEPARTMENT, SEED_VERSION]
        );
    }
    return items.length;
}


// 신규 브랜드 시드 — 첫인사 1항목.
export async function seedMinimalEvalItems(client, tenantId) {
    return seedEvalItems(client, tenantId, MINIMAL_EVAL_ITEMS);
}

// 신규 브랜드 시드 — 도메인(업종)별 기본 평가항목(domain_default_eval_items)을 복제.
// 도메인이 없거나 디폴트 0건이면 0 반환 → 호출부가 seedMinimalEvalItems 로 폴백.
export async function seedEvalItemsFromDomain(client, tenantId, domainId) {
    assertTenant(tenantId, 'seedEvalItemsFromDomain');
    if (domainId == null || !Number.isFinite(Number(domainId))) return 0;
    const { rows } = await client.query(
        `SELECT order_no, category, item, criterion, prompt_template,
                pentagon_axis, scoring_type, max_score, is_active
           FROM domain_default_eval_items
          WHERE domain_id = $1 AND is_active = true
          ORDER BY order_no ASC, id ASC`,
        [domainId]
    );
    if (rows.length === 0) return 0;
    for (const r of rows) {
        await client.query(
            `INSERT INTO eval_item_defs
                 (tenant_id, order_no, category, item, criterion, prompt_template,
                  pentagon_axis, scoring_type, max_score, is_active,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), NULL, now())
             ON CONFLICT (tenant_id, department, order_no, version) DO NOTHING`,
            [
                tenantId, r.order_no, r.category, r.item, r.criterion ?? null,
                r.prompt_template ?? null, r.pentagon_axis ?? null,
                r.scoring_type || 'numeric', r.max_score ?? null,
                r.is_active === false ? false : true,
                SEED_DEPARTMENT, SEED_VERSION,
            ]
        );
    }
    return rows.length;
}

// 신규 브랜드 시드 — 도메인(업종)별 기본 펜타곤 축(domain_default_pentagon_axes)을 복제.
export async function seedPentagonAxesFromDomain(client, tenantId, domainId) {
    assertTenant(tenantId, 'seedPentagonAxesFromDomain');
    if (domainId == null || !Number.isFinite(Number(domainId))) return 0;
    const { rows } = await client.query(
        `SELECT axis_no, label, description, prompt_template, is_active
           FROM domain_default_pentagon_axes
          WHERE domain_id = $1 AND is_active = true
          ORDER BY axis_no ASC, id ASC`,
        [domainId]
    );
    if (rows.length === 0) return 0;
    for (const r of rows) {
        await client.query(
            `INSERT INTO pentagon_axes
                 (tenant_id, department, axis_no, label, description, prompt_template,
                  is_active, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), NULL, now())
             ON CONFLICT (tenant_id, department, axis_no, version) DO NOTHING`,
            [
                tenantId, SEED_DEPARTMENT, r.axis_no, r.label, r.description ?? null,
                r.prompt_template ?? null, r.is_active === false ? false : true,
                SEED_VERSION,
            ]
        );
    }
    return rows.length;
}

// 신규 브랜드 시드 — KSQI 표준 항목 세트 복제. 테이블 부재·원본 0건이면 0 반환(무해 스킵).
export async function seedKsqiItemDefs(client, tenantId) {
    assertTenant(tenantId, 'seedKsqiItemDefs');
    try {
        const { rows } = await client.query(
            `SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'trustguard' AND table_name = 'ksqi_item_defs' LIMIT 1`
        );
        if (rows.length === 0) return 0;
        const { rowCount } = await client.query(
            `INSERT INTO ksqi_item_defs (tenant_id, number, name, area, category, max_score)
             SELECT $1, d.number, d.name, d.area, d.category, d.max_score
               FROM (SELECT DISTINCT ON (number) number, name, area, category, max_score
                       FROM ksqi_item_defs
                      ORDER BY number, tenant_id) d
                 ON CONFLICT (tenant_id, number) DO NOTHING`,
            [tenantId]
        );
        return rowCount ?? 0;
    } catch {
        return 0;
    }
}
