-- ============================================================
-- 10_backfill_pentagon_axes.sql — 테넌트 Pentagon 축 백필 (통합DB 기준)
-- ------------------------------------------------------------
-- 구 docker/init/postgres/73_backfill_pentagon_axes.sql 의 통합DB 재작성.
--   public.organizations(org_id int) → common.tenants(tenant_id citext)
--   public.pentagon_axes            → trustguard.pentagon_axes
--   public.domain_default_pentagon_axes → trustguard.domain_default_pentagon_axes
--
-- 증상 : "AI 평가항목 관리 > Pentagon 평가항목" 에서 축을 선택하면 설명·평가 프롬프트가
--        항상 비어 있음("평가 프롬프트가 비어 있습니다").
--
-- 원인 : per-tenant `pentagon_axes` 시드는 server/defaultEvalItems.mjs 의
--        seedPentagonAxesFromDomain() 이 담당하지만 호출 지점이 **브랜드 생성 뿐**이다.
--        · 브랜드 수정(PATCH)은 도메인이 바뀌어도 축을 보존(교체 안 함)
--        · 도메인 기본값 마이그레이션은 domain_default_pentagon_axes 만 채움
--        → 통합DB 신규 시드로 만들어진 테넌트는 per-tenant 행이 없다.
--          (2026-08-04 실측: trustguard.pentagon_axes = 0행)
--        FE(views/EvalItems.jsx)는 DB 행이 있으면 SSOT, 없으면 constants.js
--        radarLabels 로 폴백한다 — 라벨은 폴백으로 보이지만 description/
--        prompt_template 은 코드에 없으므로 영구히 빈칸이 된다.
--
-- 조치 : domain_default_pentagon_axes → pentagon_axes 로 도메인 기본 축을 복사.
--        seedPentagonAxesFromDomain() 과 동일 계약(department='기본', version=1).
--
-- 안전 :
--   1) 축이 **0행인 테넌트만** 대상 — 운영자가 이미 편집·추가한 테넌트는 무접촉.
--   2) active=true 인 실 브랜드만. `__default__`(플랫폼 기본값, domain_id NULL)과
--      `__TPL_*`(기본템플릿)은 브랜드가 아니므로 제외 — 화면에 안 뜨는 행을 만들지 않는다.
--      구 파일의 org_id NOT IN (1,2,3)(신한·한화 등 코드에 커스텀 라벨을 든 레거시 브랜드)은
--      통합DB 에 해당 테넌트가 없어 불필요.
--   3) domain_id 가 없는 테넌트는 복사 원본이 없으므로 자연 제외.
--   4) ON CONFLICT DO NOTHING + NOT EXISTS 가드 → 매 기동 재적용에 멱등.
--
-- ※ 실행 보류 — 통합DB(10.13.2.45:5440/aicc)는 3개 서비스 공유라 적용 시점은 담당자 협의 후.
--   본 파일은 로컬 통합 스키마 재구축용 초기화 체인에서만 자동 적용된다.
-- ============================================================

INSERT INTO trustguard.pentagon_axes
    (tenant_id, department, axis_no, label, description, prompt_template,
     is_active, version, effective_from, deactivated_at, updated_at)
SELECT t.tenant_id,
       '기본',
       d.axis_no,
       d.label,
       d.description,
       d.prompt_template,
       true,
       1,
       now(),
       NULL,
       now()
  FROM common.tenants t
  JOIN trustguard.domain_default_pentagon_axes d
       ON d.domain_id = t.domain_id
      AND d.is_active = true
 WHERE t.domain_id IS NOT NULL
   AND t.active = true
   -- 이미 축이 하나라도 있는 테넌트는 무접촉 (운영자 편집분 보존)
   AND NOT EXISTS (
       SELECT 1 FROM trustguard.pentagon_axes p WHERE p.tenant_id = t.tenant_id
   )
 ORDER BY t.tenant_id, d.axis_no
ON CONFLICT (tenant_id, department, axis_no, version) DO NOTHING;
