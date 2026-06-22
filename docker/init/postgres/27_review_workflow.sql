-- ============================================================
-- 27_review_workflow.sql — 검수 4단계 워크플로우
-- ------------------------------------------------------------
-- 기존 3단계(pending/in_review/completed)를 4단계로 확장:
--   대기 → 검수중 → 검토완료 → 최종승인
--   pending → in_review → review_done → approved(종착)
--
-- 주체:
--   - 상담사(본인 콜): pending→in_review→review_done, 점수 수정(이의제기)
--   - 관리자: review_done→approved(최종승인), 반려(→in_review)
--
-- 레거시 'completed' 는 'approved'(종착) 로 흡수한다. 단, 11_review_status.sql 이
-- 매 부팅 재적용되며 'completed' 를 backfill 에 쓰므로 CHECK 에는 'completed' 도
-- 허용값으로 남겨 둔다(데이터는 아래 UPDATE 로 approved 로 이관).
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

-- 최종승인 메타(관리자 승인자/시각)
ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by_user_id integer;

-- 1) 옛 제약(3값) 먼저 제거 → 2) 레거시 completed→approved 이관 → 3) 4단계 제약 재생성.
ALTER TABLE public.qa_calls DROP CONSTRAINT IF EXISTS qa_calls_review_status_chk;

UPDATE public.qa_calls
   SET review_status        = 'approved',
       approved_at          = COALESCE(approved_at, review_completed_at, now()),
       approved_by_user_id  = COALESCE(approved_by_user_id, user_id)
 WHERE review_status = 'completed';

-- 멱등 + 전체값 집합(33/36과 동일) — 시더 재적용 시 'objection'/'admin_revised' 데이터가 있어도 통과.
-- (이전: DROP 없이 좁은 5값만 ADD → 재적용 시 objection 행에 막혀 시더 실패하던 버그 수정.)
ALTER TABLE public.qa_calls DROP CONSTRAINT IF EXISTS qa_calls_review_status_chk;
ALTER TABLE public.qa_calls
    ADD CONSTRAINT qa_calls_review_status_chk
    CHECK (review_status IN ('pending', 'in_review', 'review_done', 'admin_revised', 'objection', 'approved', 'completed'));
