-- ============================================================
-- 28_notifications.sql — 수신자별 알림 + 검토 스냅샷
-- ------------------------------------------------------------
-- 검수 워크플로우 이벤트를 "받는 사람"에게 전달하는 영구 알림.
--   예) 관리자 최종승인 → 그 콜 상담사에게 "평가 최종 승인" 알림
--       (승인 시 상담사 검수값과 달라진 항목이 있으면 본문에 diff 첨부)
--
-- 03(Meta-Summary)의 알림은 client-only(폴링+localStorage)라 대상 전달이 불가 →
-- 여기서는 수신자(recipient_user_id) 기준 DB 저장으로 구현.
--
-- 변동(diff) 알림용: qa_call_item_score.counselor_eval = '검토완료(review_done)
-- 시점 상담사 점수' 스냅샷. 최종승인 시 manual_eval(관리자 최종)과 비교.
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id                bigserial   PRIMARY KEY,                              -- 알림 고유번호
    recipient_user_id integer     NOT NULL REFERENCES public.admin_users(user_id) ON DELETE CASCADE,  -- 받는 사람
    type              text        NOT NULL,                                 -- review_approved | review_edited | review_submitted ...
    title             text        NOT NULL,                                 -- 알림 제목
    body              text,                                                 -- 본문(변동 항목 등)
    resource_type     text,                                                 -- 'qa_call'
    resource_id       text,                                                 -- qa_id (클릭 시 #/detail/{id})
    actor_user_id     integer     REFERENCES public.admin_users(user_id) ON DELETE SET NULL,  -- 보낸 사람(관리자)
    actor_name        text,                                                 -- 보낸 사람 표시명(캐시)
    org_id            integer,                                              -- 소속 조직
    read_at           timestamptz,                                          -- NULL=안읽음(현재) / 값=읽음(지난)
    created_at        timestamptz NOT NULL DEFAULT now()                    -- 생성 일시
);

-- 수신자 최신순 목록
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
    ON public.notifications (recipient_user_id, created_at DESC);
-- 안읽음 카운트(뱃지)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON public.notifications (recipient_user_id) WHERE read_at IS NULL;

-- 검토완료 시점 상담사 점수 스냅샷(최종승인 시 diff 비교 기준)
ALTER TABLE public.qa_call_item_score
    ADD COLUMN IF NOT EXISTS counselor_eval double precision;
