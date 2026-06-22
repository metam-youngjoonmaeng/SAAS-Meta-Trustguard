-- ============================================================
-- 11_review_status.sql — qa_calls.review_status (검수상태 워크플로우)
-- ------------------------------------------------------------
-- Y/N(수기 여부) 단일 플래그를 3-state 검수상태로 확장.
-- 워크플로우:
--   pending     — 자동 채점만 된 상태, 사람이 아직 보지 않음
--   in_review   — 검수자가 부분 입력/저장한 진행 중 상태
--   completed   — 검수자가 명시적으로 완료 확정
--
-- 기존 데이터 backfill:
--   has_manual_override 가 true 인 콜(=manual_eval 행 중 ai_eval 과 다른 값 1+)
--   → completed 로 시드. 나머지는 pending.
--
-- 트리거(전이) 규칙은 application layer 에서 관리:
--   - in_review: 검수자가 첫 patch 저장 시 또는 명시적 "검수 시작" 액션
--   - completed: 사용자가 "검수 완료" 액션 클릭 시
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

-- enum 제약 — text + CHECK 로 idempotent 보장 (DO 블록으로 중복 추가 방지).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'qa_calls_review_status_chk'
    ) THEN
        ALTER TABLE public.qa_calls
            ADD CONSTRAINT qa_calls_review_status_chk
            CHECK (review_status IN ('pending', 'in_review', 'review_done', 'admin_revised', 'objection', 'approved', 'completed'));
    END IF;
END$$;

ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS review_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS review_completed_at timestamptz;

-- reviewed_by_user_id 는 14_unify_user_columns 에서 user_id 로 RENAME 된다.
-- 시더가 매 기동 11 을 재적용할 때 이미 user_id 로 바뀐 뒤라면 다시 추가하면 안 된다
-- (다시 추가하면 14 의 RENAME 이 'user_id 이미 존재' 로 실패 → 시더 exit 3).
-- 따라서 원본명/개명후 컬럼이 둘 다 없을 때만 추가한다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_calls'
          AND column_name IN ('reviewed_by_user_id', 'user_id')
    ) THEN
        ALTER TABLE public.qa_calls ADD COLUMN reviewed_by_user_id integer;
    END IF;
END$$;

-- 한 번만 실행되는 backfill — 이미 completed/in_review 인 행은 그대로 둠.
-- has_manual_override = (manual_eval 행 중 ai_eval 과 1e-9 이상 차이나는 행 존재)
UPDATE public.qa_calls c
SET review_status = 'completed',
    review_completed_at = COALESCE(c.review_completed_at, now())
WHERE c.review_status = 'pending'
  AND EXISTS (
      SELECT 1
      FROM public.qa_evaluation_rows er
      WHERE er."ID" = c."ID"
        AND ABS(er.manual_eval - er.ai_eval) > 1e-9
  );

CREATE INDEX IF NOT EXISTS idx_qa_calls_review_status
    ON public.qa_calls (review_status);
