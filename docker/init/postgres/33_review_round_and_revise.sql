-- ============================================================
-- 33_review_round_and_revise.sql
--   반복 검토(이의제기) 루프:
--   - qa_calls.review_round : 상담사 검토 제출 횟수(N차 검토 표시용 카운터). in_review→review_done 마다 +1.
--   - review_status 에 'admin_revised'(관리자 수정 후 상담사 확인 대기) 상태 추가.
--   idempotent: 컬럼 IF NOT EXISTS, CHECK 는 drop-then-add (27_review_workflow 와 동일 패턴).
-- ============================================================
ALTER TABLE public.qa_calls ADD COLUMN IF NOT EXISTS review_round integer NOT NULL DEFAULT 0;

ALTER TABLE public.qa_calls DROP CONSTRAINT IF EXISTS qa_calls_review_status_chk;
ALTER TABLE public.qa_calls ADD CONSTRAINT qa_calls_review_status_chk
    CHECK (review_status IN ('pending', 'in_review', 'review_done', 'admin_revised', 'approved', 'completed'));
