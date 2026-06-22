-- 검수 워크플로우 확장(반려/이의제기 루프, 새 설계):
--   상태에 'objection'(이의제기) 추가 + 검수이벤트에 사유(reason) 보관.
--   기존 데이터/구조 보존 — idempotent (drop-then-add CHECK, ADD COLUMN IF NOT EXISTS).

-- review_status CHECK 에 'objection' 추가 (레거시 'completed' 도 계속 허용).
ALTER TABLE qa_calls DROP CONSTRAINT IF EXISTS qa_calls_review_status_chk;
ALTER TABLE qa_calls ADD CONSTRAINT qa_calls_review_status_chk
    CHECK (review_status = ANY (ARRAY[
        'pending', 'in_review', 'review_done', 'admin_revised', 'objection', 'approved', 'completed'
    ]::text[]));

-- 검수이벤트에 사유(반려/이의제기 시 입력) 컬럼.
ALTER TABLE qa_review_events ADD COLUMN IF NOT EXISTS reason text;
