// 루브릭 few-shot 항목 토글 설정 — UI 에서 켜고 끄는 "그 항목만 RAG" 상태의 영속 저장소.
//
// 백엔드(qa-pipeline) custom_rubric 경로① 게이트(rubric_fewshot_gate)가 metadata.rubric_id +
// metadata.rubric_fewshot_item_names 로 받아 동작한다. MTG 는 이 설정을 읽어 asdf(또는 다른
// 브랜드) 평가 콜에 해당 값을 주입한다.
//
// ★영속 위치: DB(organizations.rag_rubric_id + rag_fewshot_item_names). 과거엔 데이터 볼륨의
//   flat JSON(./data/uploads/rag_fewshot_config.json)에 저장했으나, 운영 상태값은 DB 단일
//   소스로 둔다(54_org_rag_fewshot.sql). 파일/볼륨 의존 제거.
//
// 설정 shape (API 호환 유지):
//   { "<org_id>": { "rubric_id": "<str>", "item_names": ["설명력", ...] } }
//   item_names = 평가항목 "이름" 토큰(부분문자열 매칭). 항목 번호(eval_item_number)가 아니라
//   이름 기반이라 항목 추가/순서변경(재번호)에도 안전.
//   (구 pure 필드 폐기 — 전 브랜드 자동 pure 를 ingest 가 하드코딩. getOrgPure 미사용으로 제거.)

function _normalizeEntry(v) {
    if (!v || typeof v !== 'object') return { rubric_id: '', item_names: [] };
    const rubricId = String(v.rubric_id || '').trim();
    const itemNames = Array.isArray(v.item_names)
        ? [...new Set(v.item_names.map((s) => String(s).trim()).filter(Boolean))]
        : [];
    return { rubric_id: rubricId, item_names: itemNames };
}

// 전체 설정 조회 — 구성된(루브릭 또는 항목이 채워진) org 만 반환.
export async function loadRagFewshotConfig(pool) {
    const { rows } = await pool.query(
        `SELECT id, rag_rubric_id, rag_fewshot_item_names
           FROM public.organizations
          WHERE rag_rubric_id <> '' OR jsonb_array_length(rag_fewshot_item_names) > 0
          ORDER BY id`,
    );
    const out = {};
    for (const r of rows) {
        out[String(r.id)] = {
            rubric_id: String(r.rag_rubric_id || '').trim(),
            item_names: Array.isArray(r.rag_fewshot_item_names) ? r.rag_fewshot_item_names : [],
        };
    }
    return out;
}

// 설정 저장 — 전달된 org 들의 컬럼을 UPSERT(존재 org 만 UPDATE). 저장 후 정규화된 전체를 반환.
export async function saveRagFewshotConfig(pool, cfg) {
    const obj = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
    for (const [k, v] of Object.entries(obj)) {
        const orgId = Number(k);
        if (!Number.isInteger(orgId)) continue;
        const { rubric_id, item_names } = _normalizeEntry(v);
        await pool.query(
            `UPDATE public.organizations
                SET rag_rubric_id = $2,
                    rag_fewshot_item_names = $3::jsonb
              WHERE id = $1`,
            [orgId, rubric_id, JSON.stringify(item_names)],
        );
    }
    return loadRagFewshotConfig(pool);
}

// 평가 시 사용 — 해당 org 의 유효 RAG 설정. item_names 비었거나 rubric_id 없으면 null(=게이트 미적용).
export async function getOrgFewshot(pool, orgId) {
    const { rows } = await pool.query(
        `SELECT rag_rubric_id, rag_fewshot_item_names
           FROM public.organizations WHERE id = $1 LIMIT 1`,
        [orgId],
    );
    const r = rows[0];
    if (!r) return null;
    const rubricId = String(r.rag_rubric_id || '').trim();
    const itemNames = Array.isArray(r.rag_fewshot_item_names) ? r.rag_fewshot_item_names : [];
    if (!rubricId || !itemNames.length) return null;
    return { rubric_id: rubricId, item_names: itemNames };
}
