-- ============================================================
-- 22_qa_tenant_seed.sql — 테넌트별 QA 기준 시드 (업종 기본값 → 테넌트 사본)
-- ------------------------------------------------------------
-- ★ 통합DB init 에 이 단계가 통째로 빠져 있다.
--   현행 init 구성:
--     02_tenants.sql                  common.tenants 행만 INSERT
--     21_qa_domain_defaults_seed.sql  업종 '원본'만 (domains 11 · domain_default_eval_items 26
--                                     · domain_default_pentagon_axes 55)
--   원본을 테넌트로 복사하는 SQL 이 없어, 빈 볼륨에서 init 을 돌리면 테넌트가 생겨도
--   평가항목·펜타곤축이 0행이라 평가가 동작하지 않는다.
--
--   실제로 2026-08-04 기준 통합DB(10.13.2.45:5440/aicc) 상태:
--     eval_item_defs(metam)  13행  ← init 이 아니라 2026-08-03 화면 조작으로 들어간 값
--     pentagon_axes(metam)    0행  ← 아무도 넣지 않음
--   즉 볼륨을 비우고 init 을 재실행하면 평가항목마저 0행이 된다(현 상태 재현 불가).
--
-- 실행 순서: 21(업종 원본) 이후여야 복사할 원본이 존재한다. 그래서 22.
--
-- 멱등: ON CONFLICT DO NOTHING + NOT EXISTS 가드. 재실행·매 기동 재적용 안전.
--       이미 항목/축을 보유한 테넌트는 무접촉(운영자 편집분 보존).
--
-- 대상: active=true 인 실브랜드만. `__default__`(플랫폼 기본값, domain_id NULL)과
--       `__TPL_*`(기본템플릿)은 브랜드가 아니므로 제외 — 화면에 뜨지 않는 행을 만들지 않는다.
--
-- 계약: server/defaultEvalItems.mjs 의 seedEvalItemsFromDomain() ·
--       seedPentagonAxesFromDomain() 과 동일 규칙(department='기본', version=1).
--       브랜드 생성 API(POST /api/admin/organizations)가 같은 일을 하므로
--       화면 생성 경로와 SQL 시드 경로의 결과가 일치해야 한다.
--
-- 미포함: ksqi_item_defs.
--       통합DB 에 KSQI '원본' 자체가 없다(trustguard.ksqi_item_defs 테넌트 무관 0행).
--       원본 이관이 선행되어야 하므로 별도 파일로 분리한다.
-- ============================================================

BEGIN;

-- ① 평가항목 — domain_default_eval_items → eval_item_defs
--    업종별로 내용이 실제로 다르다(금융 13항목 ≠ 유통/이커머스 13항목).
--    ※ 2026-08-04 기준 원본이 업종 11개 중 2개(1 금융 · 3 유통/이커머스)에만 존재.
--      나머지 9개 업종 소속 테넌트는 이 블록이 0행 복사로 지나간다(콘텐츠 미작성 상태).
INSERT INTO trustguard.eval_item_defs
    (tenant_id, order_no, category, item, criterion, prompt_template,
     department, version, effective_from, deactivated_at, updated_at,
     pentagon_axis, scoring_type, max_score, is_active)
SELECT t.tenant_id,
       d.order_no,
       d.category,
       d.item,
       d.criterion,
       d.prompt_template,
       '기본',
       1,
       now(),
       NULL,
       now(),
       d.pentagon_axis,
       d.scoring_type,
       d.max_score,
       COALESCE(d.is_active, true)
  FROM common.tenants t
  JOIN trustguard.domain_default_eval_items d
       ON d.domain_id = t.domain_id
      AND d.is_active = true
 WHERE t.domain_id IS NOT NULL
   AND t.active = true
   -- 이미 항목을 보유한 테넌트는 무접촉 (운영자 편집분 보존)
   AND NOT EXISTS (
       SELECT 1 FROM trustguard.eval_item_defs e
        WHERE e.tenant_id = t.tenant_id
          AND e.deactivated_at IS NULL
          AND e.is_active = true
   )
 ORDER BY t.tenant_id, d.order_no
ON CONFLICT (tenant_id, department, order_no, version) DO NOTHING;


-- ② 펜타곤 축 — domain_default_pentagon_axes → pentagon_axes
--    ※ 축은 업종 무관 공통이다. 2026-08-04 실측 결과 11개 업종 55행의
--      label/description/prompt_template 이 전부 동일(내용 해시 1종).
--      따라서 어느 업종에서 복사하든 결과가 같다.
--    ★ label 은 eval_item_defs.pentagon_axis 값과 문자열이 일치해야 한다.
--      불일치 시 항목이 축에 귀속되지 않아 오각형이 빈 축으로 그려진다.
INSERT INTO trustguard.pentagon_axes
    (tenant_id, department, axis_no, label, description, prompt_template,
     is_active, version, effective_from, deactivated_at, updated_at)
SELECT t.tenant_id,
       '기본',
       p.axis_no,
       p.label,
       p.description,
       p.prompt_template,
       true,
       1,
       now(),
       NULL,
       now()
  FROM common.tenants t
  JOIN trustguard.domain_default_pentagon_axes p
       ON p.domain_id = t.domain_id
      AND p.is_active = true
 WHERE t.domain_id IS NOT NULL
   AND t.active = true
   -- 이미 축을 보유한 테넌트는 무접촉 (운영자 편집분 보존)
   AND NOT EXISTS (
       SELECT 1 FROM trustguard.pentagon_axes x WHERE x.tenant_id = t.tenant_id
   )
 ORDER BY t.tenant_id, p.axis_no
ON CONFLICT (tenant_id, department, axis_no, version) DO NOTHING;

COMMIT;

-- ============================================================
-- 적용 후 확인
--   SELECT tenant_id, count(*) FROM trustguard.eval_item_defs
--    WHERE is_active AND deactivated_at IS NULL GROUP BY 1;
--   SELECT tenant_id, count(*) FROM trustguard.pentagon_axes GROUP BY 1;
--
-- 축이 채워지면 server/rubricSync.mjs 의 buildRubricFromDefs() 가 rubric 에
-- pentagon 블록을 동봉하고, 백엔드 pure_pentagon 노드가 축당 LLM 1콜로
-- {rating, analysis, summary} 를 산출해 trustguard.eval_pentagon_result 에 적재된다.
-- 축이 없으면 pentagon=null → rubric 미동봉 → 축 평가 미실행 →
-- 화면은 점수밴드 대체 문구(buildDynamicFallbackReportRows)를 표시한다.
--
-- ※ 기존 평가 콜은 소급 적용되지 않는다. 오각형 반영에는 재평가가 필요하다.
-- ※ 축당 LLM 1콜이 추가되므로 평가 소요가 늘어난다(현행 12~19초 기준).
-- ============================================================
