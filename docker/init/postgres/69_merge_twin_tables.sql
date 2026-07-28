-- ============================================================
-- 69_merge_twin_tables.sql — 구조 쌍둥이 테이블 병합 (2026-07-27)
-- ------------------------------------------------------------
-- PK 형태가 동일한(=1:1) 테이블 쌍 중, 컬럼 구조까지 사실상 같은 두 건만 병합한다.
--
-- ① qa_skill_memory + qa_skill_versions → qa_skill_store
--    구조: 양쪽 모두 (rubric_id PK, org_id FK, <jsonb 1개>, updated_at).
--          jsonb 컬럼명(memory / store)만 다른 완전한 쌍둥이.
--    효과: 스킬 로딩이 두 테이블 조회 → 한 행 조회.
--
-- ② eval_item_change_log + pentagon_axis_change_log → rubric_change_log
--    구조: 14컬럼 중 12개 동일(org_id·department·version·change_type·before_json·after_json·
--          user_id·login_id·display_name·changed_at·id). 식별자만 상이:
--            평가항목 → order_no / item_name / category_name
--            펜타곤축 → axis_no  / label_snapshot
--    통합: target_kind('item'|'axis') + target_no + target_name + category_name 으로 흡수.
--    효과: "이 브랜드 루브릭이 언제 어떻게 바뀌었나" 를 UNION 없이 한 번에 조회.
--
-- 병합하지 않은 1:1 쌍 (의도적 보류)
--   qa_batch_configs + qa_confidence_prompt : 둘 다 org_id 기준이지만 '배치 조건' vs '판정 프롬프트'로
--       관심사가 다르고 updated_by 감사 주체가 갈린다. org_id 일치는 우연.
--       (프롬프트 쪽은 70 에서 현재본+이력을 qa_confidence_prompt 로 합쳤을 뿐, 조건과는 여전히 별개)
--
-- ※ qa_call_comment + qa_call_confidence 는 이 시점엔 보류했으나 71 에서 qa_call_annotation 으로
--    병합했다. 갱신이 서로 다른 컬럼만 건드리는 UPSERT(배치=judgments/has_*, 사용자=comments)라
--    한 행을 공유해도 충돌하지 않는다는 걸 확인했기 때문. 판단 근거는 71 헤더 참조.
--
-- 멱등: 신규 테이블 IF NOT EXISTS, 이관은 원본이 남아 있을 때만, DROP 은 IF EXISTS.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- ─── ① 스킬 저장소 통합 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_skill_store (
    rubric_id  text PRIMARY KEY,
    org_id     integer REFERENCES public.organizations(id) ON DELETE CASCADE,
    memory     jsonb NOT NULL DEFAULT '{}',   -- 구 qa_skill_memory.memory (자동학습 메모리)
    store      jsonb NOT NULL DEFAULT '{}',   -- 구 qa_skill_versions.store (버전 스토어)
    updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF to_regclass('public.qa_skill_memory') IS NOT NULL THEN
        INSERT INTO public.qa_skill_store (rubric_id, org_id, memory, updated_at)
        SELECT rubric_id, org_id, COALESCE(memory, '{}'), updated_at FROM public.qa_skill_memory
        ON CONFLICT (rubric_id) DO UPDATE
            SET memory = EXCLUDED.memory,
                org_id = COALESCE(public.qa_skill_store.org_id, EXCLUDED.org_id),
                updated_at = GREATEST(public.qa_skill_store.updated_at, EXCLUDED.updated_at);
    END IF;
    IF to_regclass('public.qa_skill_versions') IS NOT NULL THEN
        INSERT INTO public.qa_skill_store (rubric_id, org_id, store, updated_at)
        SELECT rubric_id, org_id, COALESCE(store, '{}'), updated_at FROM public.qa_skill_versions
        ON CONFLICT (rubric_id) DO UPDATE
            SET store = EXCLUDED.store,
                org_id = COALESCE(public.qa_skill_store.org_id, EXCLUDED.org_id),
                updated_at = GREATEST(public.qa_skill_store.updated_at, EXCLUDED.updated_at);
    END IF;
END $$;

DROP TABLE IF EXISTS public.qa_skill_memory   CASCADE;
DROP TABLE IF EXISTS public.qa_skill_versions CASCADE;

CREATE INDEX IF NOT EXISTS idx_qa_skill_store_org ON public.qa_skill_store (org_id);


-- ─── ② 루브릭 변경 이력 통합 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rubric_change_log (
    id             SERIAL PRIMARY KEY,
    org_id         integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    target_kind    text    NOT NULL,          -- 'item' = 평가항목 / 'axis' = 펜타곤 축
    department     text    NOT NULL DEFAULT '기본',
    target_no      integer,                   -- 평가항목 order_no / 축 axis_no
    target_name    text,                      -- 항목명 / 축 라벨 (변경 당시 스냅샷)
    category_name  text,                      -- 평가항목 전용(대분류). 축은 NULL
    version        integer,
    change_type    text    NOT NULL,          -- create / update / deactivate / new_version ...
    before_json    jsonb,
    after_json     jsonb,
    user_id        integer,
    login_id       text,
    display_name   text,
    changed_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF to_regclass('public.eval_item_change_log') IS NOT NULL THEN
        INSERT INTO public.rubric_change_log
            (org_id, target_kind, department, target_no, target_name, category_name,
             version, change_type, before_json, after_json, user_id, login_id, display_name, changed_at)
        SELECT org_id, 'item', COALESCE(department, '기본'), order_no, item_name, category_name,
               version, change_type, before_json, after_json, user_id, login_id, display_name, changed_at
          FROM public.eval_item_change_log;
    END IF;
    IF to_regclass('public.pentagon_axis_change_log') IS NOT NULL THEN
        INSERT INTO public.rubric_change_log
            (org_id, target_kind, department, target_no, target_name, category_name,
             version, change_type, before_json, after_json, user_id, login_id, display_name, changed_at)
        SELECT org_id, 'axis', COALESCE(department, '기본'), axis_no, label_snapshot, NULL,
               version, change_type, before_json, after_json, user_id, login_id, display_name, changed_at
          FROM public.pentagon_axis_change_log;
    END IF;
END $$;

DROP TABLE IF EXISTS public.eval_item_change_log     CASCADE;
DROP TABLE IF EXISTS public.pentagon_axis_change_log CASCADE;

CREATE INDEX IF NOT EXISTS idx_rubric_change_log_lookup
    ON public.rubric_change_log (org_id, target_kind, department, target_no, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rubric_change_log_org_time
    ON public.rubric_change_log (org_id, changed_at DESC);

COMMENT ON TABLE public.qa_skill_store IS
    'LLM 스킬 저장소(루브릭별 1행). memory=자동학습 메모리, store=버전 스토어. 구 qa_skill_memory + qa_skill_versions 병합.';
COMMENT ON TABLE public.rubric_change_log IS
    '루브릭 변경 이력(감사). target_kind 로 평가항목/펜타곤축 구분. 구 eval_item_change_log + pentagon_axis_change_log 병합.';

COMMIT;
