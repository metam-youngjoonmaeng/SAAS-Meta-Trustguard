-- ============================================================
-- 34_review_events.sql
--   검토 이력(감사) — 차수별 누가 무슨 행위를 했나. 보수적 설계: 단일 테이블, 필수 컬럼만.
--   action: submit(상담사 제출) / revise(관리자 수정·확인요청) / agree(상담사 동의) /
--           reobject(상담사 재이의) / approve(무수정 승인) / force_approve(강제 승인) / cancel(승인취소)
--   changed_items: revise·force_approve 시 변경분 [{order_no,item,from,to}], 그 외 NULL.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.qa_call_review_event (
    id            bigserial   PRIMARY KEY,
    qa_id         text        NOT NULL REFERENCES public.qa_calls("ID") ON DELETE CASCADE,
    round         integer     NOT NULL DEFAULT 0,
    actor_user_id integer,
    action        text        NOT NULL,
    changed_items jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_review_events_qa ON public.qa_call_review_event (qa_id, created_at);
