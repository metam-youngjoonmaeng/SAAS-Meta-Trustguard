-- ============================================================
-- 70_absorb_satellite_tables.sql — 부속 테이블 부모로 흡수 (2026-07-27)
-- ------------------------------------------------------------
-- PK 문자열이 달라 69 의 '동일 PK' 분석에서 걸리지 않았지만, 실질 grain 이 부모와
-- 같아 독립 테이블일 이유가 없는 것들을 흡수한다.
--
-- ① qa_skill_excluded → qa_call_item_score.skill_excluded_at
--    구조: (org_id, qa_id, order_no, created_at) — 실체는 '이 항목을 스킬 학습에서 뺀다'는
--          항목별 플래그 하나. 키 (qa_id, order_no) 는 qa_call_item_score 의 PK("ID", order_no)와
--          정확히 같고, org_id 는 qa_calls 에서 유도 가능해 중복 보관이었다.
--    → 타임스탬프 컬럼 1개로 흡수(NULL=미제외, 값=제외 지정 시각). 지정 이력까지 보존된다.
--
-- ② qa_batch_prompts + qa_batch_prompt_history → qa_confidence_prompt
--    구조: '현재본 1행(org_id PK)' + '이력 N행(append-only)' 의 전형적 분리.
--          history 컬럼이 prompts 의 부분집합 + updated_by_name 뿐이었다.
--    → 버전 행을 쌓는 단일 테이블로 통합. 현재본 = org_id 별 최대 version.
--       조회는 DISTINCT ON (org_id) ... ORDER BY version DESC 한 번이면 된다.
--
-- 안전: 세 테이블 모두 현재 0행이라 이관 리스크가 없다(이관 로직은 멱등하게 포함).
-- 멱등: 컬럼/테이블 추가는 IF NOT EXISTS, 이관은 원본 존재 시에만, DROP 은 IF EXISTS.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- ─── ① 스킬 학습 제외 지정 흡수 ──────────────────────────────
ALTER TABLE public.qa_call_item_score
    ADD COLUMN IF NOT EXISTS skill_excluded_at timestamptz;

COMMENT ON COLUMN public.qa_call_item_score.skill_excluded_at IS
    '스킬 학습 제외 지정 시각. NULL = 학습에 사용(기본). 구 qa_skill_excluded 테이블 흡수.';

DO $$
BEGIN
    IF to_regclass('public.qa_skill_excluded') IS NOT NULL THEN
        UPDATE public.qa_call_item_score s
           SET skill_excluded_at = COALESCE(x.created_at, now())
          FROM public.qa_skill_excluded x
         WHERE x.qa_id = s."ID" AND x.order_no = s.order_no
           AND s.skill_excluded_at IS NULL;
    END IF;
END $$;

DROP TABLE IF EXISTS public.qa_skill_excluded CASCADE;

-- 제외 지정된 항목만 훑는 부분 인덱스 (전체의 극소수라 부분 인덱스가 적합)
CREATE INDEX IF NOT EXISTS idx_qa_call_item_score_skill_excluded
    ON public.qa_call_item_score ("ID", order_no) WHERE skill_excluded_at IS NOT NULL;


-- ─── ② 신뢰도 판정 프롬프트: 현재본 + 이력 통합 ──────────────
CREATE TABLE IF NOT EXISTS public.qa_confidence_prompt (
    id                SERIAL PRIMARY KEY,
    org_id            integer NOT NULL,
    version           integer NOT NULL DEFAULT 1,
    system_prompt     text,
    uncertain_def     text,
    contradiction_def text,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        integer,
    updated_by_name   text,
    UNIQUE (org_id, version)
);

DO $$
BEGIN
    -- 이력 먼저(과거 버전), 그다음 현재본(최신 버전) — 같은 (org_id, version)은 현재본이 이김
    IF to_regclass('public.qa_batch_prompt_history') IS NOT NULL THEN
        INSERT INTO public.qa_confidence_prompt
            (org_id, version, uncertain_def, contradiction_def, updated_at, updated_by, updated_by_name)
        SELECT org_id, version, uncertain_def, contradiction_def, updated_at, updated_by, updated_by_name
          FROM public.qa_batch_prompt_history
        ON CONFLICT (org_id, version) DO NOTHING;
    END IF;
    IF to_regclass('public.qa_batch_prompts') IS NOT NULL THEN
        INSERT INTO public.qa_confidence_prompt
            (org_id, version, system_prompt, uncertain_def, contradiction_def, updated_at, updated_by)
        SELECT org_id, COALESCE(version, 1), system_prompt, uncertain_def, contradiction_def, updated_at, updated_by
          FROM public.qa_batch_prompts
        ON CONFLICT (org_id, version) DO UPDATE
            SET system_prompt = EXCLUDED.system_prompt,
                uncertain_def = EXCLUDED.uncertain_def,
                contradiction_def = EXCLUDED.contradiction_def,
                updated_at = EXCLUDED.updated_at,
                updated_by = EXCLUDED.updated_by;
    END IF;
END $$;

DROP TABLE IF EXISTS public.qa_batch_prompts        CASCADE;
DROP TABLE IF EXISTS public.qa_batch_prompt_history CASCADE;

-- 현재본 조회용 — DISTINCT ON (org_id) ORDER BY org_id, version DESC 가 인덱스만으로 끝난다
CREATE INDEX IF NOT EXISTS idx_qa_confidence_prompt_current
    ON public.qa_confidence_prompt (org_id, version DESC);

COMMENT ON TABLE public.qa_confidence_prompt IS
    'AI 신뢰도 검증 판정 프롬프트(브랜드별 버전 이력). org_id 별 최대 version 이 현재 적용본. 구 qa_batch_prompts + qa_batch_prompt_history 병합.';

COMMIT;
