-- ============================================================
-- 71_final_cleanup.sql — 미사용 테이블 제거 + 콜 사이드카 병합 (2026-07-27)
-- ------------------------------------------------------------
-- ① auth_sessions 제거 — 전수 조사 결과 유일하게 '코드 참조 0건' 인 테이블
--    · 행 0건 · server 참조 0 · frontend 참조 0 (SQL 정의부에만 존재)
--    · 29_users_membership_twin.sql 원주석: "02/03 스키마 그대로 — 파리티용"
--      = 형제 프로젝트와 스키마 모양을 맞추려고 만든 자리표시자
--    · MTG 로그인 세션은 서버 인메모리(Map, TTL 12h)에 저장되고 영속 기록은
--      users.last_active_trainee_id 한 컬럼뿐 → 이 테이블은 인증 경로에 전혀 개입하지 않는다.
--    따라서 삭제해도 로그인·세션·계정 기능에 영향 없음.
--
-- ② qa_call_comment + qa_call_confidence → qa_call_annotation
--    둘 다 PK 가 qa_id(콜당 1행)인 '콜 부가정보 사이드카'.
--    한쪽은 사람이 남긴 코멘트, 다른 쪽은 배치가 남긴 AI 신뢰도 판정으로 쓰기 주체는 다르지만,
--    갱신이 서로 다른 컬럼만 건드리는 UPSERT 라 한 행을 공유해도 충돌하지 않는다
--    (배치는 judgments/has_* 만, 사용자는 comments 만 SET).
--    콜 1건의 부가정보를 조회할 때 테이블 2개를 각각 읽던 것이 1행 조회로 준다.
--
-- 멱등: 신규 테이블 IF NOT EXISTS, 이관은 원본 존재 시에만, DROP 은 IF EXISTS.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- ─── ① 미사용 테이블 제거 ────────────────────────────────────
DROP TABLE IF EXISTS public.auth_sessions CASCADE;


-- ─── ② 콜 부가정보 사이드카 통합 ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_call_annotation (
    qa_id             text PRIMARY KEY,
    -- 사람이 남기는 영역
    comments          jsonb NOT NULL DEFAULT '[]'::jsonb,
    comments_at       timestamptz,
    -- 배치(AI 신뢰도 판정)가 남기는 영역
    judgments         jsonb,
    has_uncertain     boolean,
    has_weak          boolean,
    has_contradiction boolean,
    prompt_version    integer,
    model             text,
    judged_at         timestamptz
);

-- ★ 판정 컬럼(judgments/has_*/prompt_version/model/judged_at)은 마이그레이션 75 에서 제거됐다.
--   시더가 매 기동 02~75 를 재적용하므로, 75 를 이미 지난 DB 에서 이 블록이 그대로 돌면
--   "column judgments does not exist" 로 시더 전체가 죽는다(실측 exit 3).
--   → 컬럼 존재 여부로 가드해, 75 미적용 DB(첫 부팅·레거시)에서만 병합·색인한다.
DO $$
DECLARE
    has_judgment_cols boolean := EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'qa_call_annotation'
           AND column_name = 'judgments'
    );
BEGIN
    -- 관리자 코멘트는 계속 살아있는 기능 — 무조건 병합.
    IF to_regclass('public.qa_call_comment') IS NOT NULL THEN
        INSERT INTO public.qa_call_annotation (qa_id, comments, comments_at)
        SELECT qa_id, COALESCE(comments, '[]'::jsonb), updated_at FROM public.qa_call_comment
        ON CONFLICT (qa_id) DO UPDATE
            SET comments = EXCLUDED.comments, comments_at = EXCLUDED.comments_at;
    END IF;

    IF has_judgment_cols AND to_regclass('public.qa_call_confidence') IS NOT NULL THEN
        INSERT INTO public.qa_call_annotation
            (qa_id, judgments, has_uncertain, has_weak, has_contradiction, prompt_version, model, judged_at)
        SELECT qa_id, judgments, has_uncertain, has_weak, has_contradiction, prompt_version, model, judged_at
          FROM public.qa_call_confidence
        ON CONFLICT (qa_id) DO UPDATE
            SET judgments = EXCLUDED.judgments,
                has_uncertain = EXCLUDED.has_uncertain,
                has_weak = EXCLUDED.has_weak,
                has_contradiction = EXCLUDED.has_contradiction,
                prompt_version = EXCLUDED.prompt_version,
                model = EXCLUDED.model,
                judged_at = EXCLUDED.judged_at;
    END IF;

    -- 검수 우선순위 선별(신뢰도 플래그로 콜 필터)용 — 플래그 컬럼이 있을 때만.
    IF has_judgment_cols THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_qa_call_annotation_flags'
             || ' ON public.qa_call_annotation (qa_id)'
             || ' WHERE has_uncertain OR has_weak OR has_contradiction';
    END IF;
END $$;

DROP TABLE IF EXISTS public.qa_call_comment    CASCADE;
DROP TABLE IF EXISTS public.qa_call_confidence CASCADE;

COMMENT ON TABLE public.qa_call_annotation IS
    '콜 부가정보(콜당 1행). comments=관리자 코멘트(사람), judgments/has_*=AI 신뢰도 판정(배치). 구 qa_call_comment + qa_call_confidence 병합.';

COMMIT;
