-- ============================================================
-- 도메인 / 브랜드(조직) 멀티테넌시 스키마
-- 원본: 01-AI-Tutor-dev backend/db/models.py (domains, organizations)
-- ------------------------------------------------------------
-- Domain   : 업종 상위 분류 (예: 금융, 보험, 유통)
-- Organization : 브랜드 = 멀티테넌시 단위 (예: 신한카드)
--              사이드바 BrandTile/BrandSelector 의 단위
-- qa_calls / admin_users 에 org_id 결합 → 사용자별·브랜드별 데이터 격리
-- ============================================================

-- ── domains ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.domains (
    id           SERIAL PRIMARY KEY,
    name         text NOT NULL,
    key          text NOT NULL DEFAULT '',
    sort_order   integer NOT NULL DEFAULT 0,
    active       boolean NOT NULL DEFAULT true,
    created_at   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_key ON public.domains (key) WHERE key <> '';
CREATE INDEX IF NOT EXISTS idx_domains_sort ON public.domains (sort_order, id);

-- ── organizations (= 브랜드) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
    id           SERIAL PRIMARY KEY,
    name         text NOT NULL,
    short        text NOT NULL DEFAULT '',         -- 1-2자 이니셜 (브랜드 타일 표시용)
    color        text NOT NULL DEFAULT '#055AAF',  -- 브랜드 컬러 hex
    active       boolean NOT NULL DEFAULT true,
    domain_id    integer REFERENCES public.domains(id) ON DELETE SET NULL,
    created_at   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations (domain_id);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON public.organizations (active);

-- ── seed: 표준 업종 카탈로그 (02-AI-Tutor 기준 통일 — 3개 프로젝트 동일 id↔name↔key) ──
INSERT INTO public.domains (id, name, key, sort_order)
VALUES
    (1,  '금융',          'finance',       1),
    (2,  '보험',          'insurance',     2),
    (3,  '유통/이커머스', 'ecommerce',     3),
    (4,  '제조',          'manufacturing', 4),
    (5,  '통신',          'telecom',       5),
    (6,  '유통',          'retail',        6),
    (7,  '헬스케어/제약', 'healthcare',    7),
    (8,  '공공/비영리',   'public',        8),
    (9,  '서비스/아웃소싱','outsourcing',  9),
    (10, '금융세일즈',    'finance_sales', 10),
    (11, 'IT/개발',       'it',            11)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, short, color, domain_id)
VALUES (1, '신한카드', '신', '#055AAF', 1)
ON CONFLICT (id) DO NOTHING;

-- sequence 동기화 (id 명시 INSERT 후 nextval 충돌 방지)
SELECT setval('public.domains_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.domains), 1));
SELECT setval('public.organizations_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.organizations), 1));

-- ── qa_calls 에 org_id 결합 ──────────────────────────────────
ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS org_id integer
    REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.qa_calls__sandbox_snapshot
    ADD COLUMN IF NOT EXISTS org_id integer;

-- 기존 baseline 콜은 모두 신한카드(id=1) 소속으로 backfill
UPDATE public.qa_calls SET org_id = 1 WHERE org_id IS NULL;
UPDATE public.qa_calls__sandbox_snapshot SET org_id = 1 WHERE org_id IS NULL;

-- backfill 후 NOT NULL 강제 + DEFAULT 신한카드(id=1) — load.sql 의 \COPY 가 org_id 미포함이어도 안전
ALTER TABLE public.qa_calls ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE public.qa_calls ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qa_calls_org ON public.qa_calls (org_id);

-- ── admin_users: 홈 브랜드 + super_admin 역할 도입 ───────────
-- 29/30 마이그레이션 이후 admin_users 는 VIEW 가 되므로, 테이블일 때만(=최초 init) 실행.
DO $$
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.admin_users')) = 'r' THEN
        ALTER TABLE public.admin_users
            ADD COLUMN IF NOT EXISTS org_id integer
            REFERENCES public.organizations(id) ON DELETE SET NULL;
        UPDATE public.admin_users SET org_id = 1 WHERE org_id IS NULL;
        -- admin1 → super_admin (전체 브랜드 관리). test1(샌드박스)은 admin 유지
        UPDATE public.admin_users SET role = 'super_admin' WHERE login_id = 'admin1';
    END IF;
END $$;
