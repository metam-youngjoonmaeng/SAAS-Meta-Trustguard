-- ============================================================
-- 73_backfill_pentagon_axes.sql — 기존 브랜드 Pentagon 축 백필
-- ------------------------------------------------------------
-- 증상 : "AI 평가항목 관리 > Pentagon 평가항목" 에서 축을 선택하면 설명·평가 프롬프트가
--        항상 비어 있음("평가 프롬프트가 비어 있습니다").
--
-- 원인 : per-org `pentagon_axes` 시드는 server/defaultEvalItems.mjs 의
--        seedPentagonAxesFromDomain() 이 담당하지만, 호출 지점이
--        **브랜드 생성(POST /admin/organizations) 뿐** 이다.
--        · PATCH /admin/brands/:id 는 도메인이 바뀌어도 축을 보존(교체 안 함)
--        · 49~53 마이그레이션은 도메인 기본값(domain_default_pentagon_axes)만 채움
--        → 그 이전에 만들어졌거나 dev DB COPY 로 이식된 브랜드는 per-org 행이 없다.
--          (본 파일 작성 시점 로컬 DB `pentagon_axes` = 전 브랜드 0행)
--        FE(views/EvalItems.jsx)는 DB 행이 있으면 SSOT, 없으면 constants.js
--        radarLabels 로 폴백한다 — 라벨은 폴백으로 보이지만 description/
--        prompt_template 은 코드에 없으므로 영구히 빈칸이 된다.
--
-- 조치 : domain_default_pentagon_axes → pentagon_axes 로 도메인 기본 축을 복사.
--        seedPentagonAxesFromDomain() 과 동일 계약(department='기본', version=1).
--
-- 안전 :
--   1) 축이 **0행인 브랜드만** 대상 — 운영자가 이미 편집·추가한 브랜드는 무접촉.
--   2) 신한(1)·한화(2) 제외 — constants.js 의 RADAR_LABELS /
--      HANWHA_RADAR_LABELS 가 도메인 기본 5축과 라벨이 달라서, 백필하면
--      DB 행이 SSOT 가 되어 화면 축 이름이 바뀐다(가시적 회귀).
--      나머지 브랜드는 DEFAULT_RADAR_LABELS 폴백을 쓰고 그 값이
--      도메인 기본 라벨과 동일 → 라벨 변화 0, 설명·프롬프트만 채워짐.
--   3) domain_id 가 없는 브랜드는 복사 원본이 없으므로 스킵(기존 함수 동작과 동일).
--   4) ON CONFLICT DO NOTHING + 0행 가드 → seed-if-empty.sh 매 기동 재적용에 멱등.
-- ============================================================

INSERT INTO public.pentagon_axes
    (org_id, department, axis_no, label, description, prompt_template,
     is_active, version, effective_from, deactivated_at, updated_at)
SELECT o.id,
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
  FROM public.organizations o
  JOIN public.domain_default_pentagon_axes d
       ON d.domain_id = o.domain_id
      AND d.is_active = true
 WHERE o.domain_id IS NOT NULL
   -- 커스텀 축 라벨을 코드에 들고 있는 레거시 브랜드 제외 (constants.js BRAND_CONFIG)
   AND o.id NOT IN (1, 2, 3)
   -- 이미 축이 하나라도 있는 브랜드는 무접촉 (운영자 편집분 보존)
   AND NOT EXISTS (
       SELECT 1 FROM public.pentagon_axes p WHERE p.org_id = o.id
   )
 ORDER BY o.id, d.axis_no
ON CONFLICT (org_id, department, axis_no, version) DO NOTHING;
