-- ============================================================
-- 49_domain_default_pentagon_axes.sql — 도메인(업종)별 기본 펜타곤(레이더) 축
-- ------------------------------------------------------------
-- 목적: 신규 브랜드 생성 시, 선택한 도메인의 "기본 펜타곤 축"을 pentagon_axes 로
--   자동 복제하기 위한 소스 카탈로그. (47 의 평가항목 디폴트와 짝)
--
-- pentagon_axes 의 "템플릿" 격. axis_no/label/description/prompt_template 가 1:1 대응,
--   버전 메타(version/department/effective_from/deactivated_at)는 갖지 않음(평탄한 템플릿).
--   복제 시 pentagon_axes 에 department='기본', version=1 로 박힌다.
--
-- 콘텐츠 입력은 관리자 UI (브랜드 관리 → 도메인 편집 → 평가항목 페이지)에서 super_admin.
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용 (DDL 만; 콘텐츠는 DB 가 SSOT).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.domain_default_pentagon_axes (
    id              SERIAL PRIMARY KEY,
    domain_id       integer NOT NULL
                    REFERENCES public.domains(id) ON DELETE CASCADE,
    axis_no         integer NOT NULL,
    label           text NOT NULL,
    description     text,
    prompt_template text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 도메인 내 축 번호 유일.
CREATE UNIQUE INDEX IF NOT EXISTS domain_default_pentagon_axes_uk
    ON public.domain_default_pentagon_axes (domain_id, axis_no);

CREATE INDEX IF NOT EXISTS idx_domain_default_pentagon_axes_domain
    ON public.domain_default_pentagon_axes (domain_id);
