-- ============================================================
-- 55_coaching_reasons.sql — 코칭 배정 근거(문제 콜) per-member 저장
-- ------------------------------------------------------------
-- 배경: coaching_assignments(mig 26) 는 그룹 전체가 공유하는 평평한 행이라
--   "왜 배정됐는지(어떤 콜이 문제였는지)" 를 담을 수 없다. 요청은:
--     · 배정 근거 = 해당 상담사의 문제였던 콜(들)
--     · 그룹 배정이라도 근거 콜은 상담사마다 개별이며 "본인만" 볼 수 있어야 함(프라이버시)
--   → 근거를 자식 테이블로 분리해 (배정 × 멤버 × 콜) 로 저장한다.
--     coaching_assignments(공유: 제목/시나리오/멤버)는 그대로 둔다.
--
-- 프라이버시: 상담사 본인화면(/api/coaching/mine)은 member_user_id = 본인 인 근거만
--   조회한다(서버측 스코프). 관리자(/api/coaching·/api/coaching/history)는 전원 근거 열람.
--
-- 근거는 "선택" — 근거 없이도 배정 가능(행이 0건이면 기존처럼 관리자 직접 배정).
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS. seeder 매 기동 재적용 안전.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.coaching_assignment_reasons (
    id              bigserial   PRIMARY KEY,
    assignment_id   bigint      NOT NULL REFERENCES public.coaching_assignments(id) ON DELETE CASCADE,  -- 배정 삭제 시 근거도 삭제
    member_user_id  integer     NOT NULL REFERENCES public.users(id)                ON DELETE CASCADE,  -- 이 근거의 소유 상담사(본인만 열람). admin_users 는 VIEW라 실테이블 users(id) 참조(= admin_users.user_id)
    -- 참고: coaching_assignments.members(int[]) 값 = admin_users.user_id = users.id 로 동일 신원.
    qa_call_id      text        NOT NULL REFERENCES public.qa_calls("ID")           ON DELETE CASCADE,  -- 문제였던 콜(삭제되면 근거도 무의미)
    note            text,                                                    -- 관리자 메모(왜 문제였는지, 선택)
    call_date       text,                                                    -- 표시용 스냅샷(qa_calls.CDATE)
    score           numeric,                                                 -- 표시용 스냅샷(qa_calls.TOTAL_SCORE)
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (assignment_id, member_user_id, qa_call_id)   -- 같은 배정·멤버·콜 중복 방지
);

CREATE INDEX IF NOT EXISTS idx_coaching_reasons_assignment ON public.coaching_assignment_reasons (assignment_id);
-- 상담사 본인 근거 조회(member_user_id = 본인) 용.
CREATE INDEX IF NOT EXISTS idx_coaching_reasons_member ON public.coaching_assignment_reasons (member_user_id);
