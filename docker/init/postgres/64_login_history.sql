-- 64_login_history.sql
-- 로그인 이력(login_history) 전용 영속 테이블 신설.
--   · 02(튜터)/03(TA) 는 전용 login_history 테이블 + "로그인 이력" 화면을 갖는데 04 에는 없었다.
--     04 는 로그인 성공/실패/로그아웃을 qa_audit_logs 에 남기지만, 이는 3일 후 prune + 화면 1일 조회창이라
--     장기 "이력"으로 부적합. 이 테이블은 prune 대상이 아니며 영구 보존한다(02/03 동등 기능).
--   · 컬럼명은 04 관례(qa_audit_logs / admin_users)에 맞춤: login_id/display_name/client_ip/user_agent/role.
--   · user_id 는 users(id) FK, ON DELETE SET NULL — 사용자 삭제돼도 이력은 남긴다(03 동일 규약).
--     로그인 실패(user_not_found)는 user_id NULL 로 기록될 수 있다.
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS. 매 기동 seeder 재실행에 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_history (
    id           bigserial PRIMARY KEY,
    user_id      integer REFERENCES public.users(id) ON DELETE SET NULL,
    login_id     text,
    display_name text,
    role         text,
    org_id       integer,
    event        text NOT NULL DEFAULT 'login_success',  -- login_success | login_fail | logout
    reason       text,                                    -- 실패 사유: user_not_found | inactive | bad_password
    client_ip    text,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_login_history_user_id    ON public.login_history(user_id);
CREATE INDEX IF NOT EXISTS ix_login_history_created_at ON public.login_history(created_at);
CREATE INDEX IF NOT EXISTS ix_login_history_org_id     ON public.login_history(org_id);
CREATE INDEX IF NOT EXISTS ix_login_history_event      ON public.login_history(event);

COMMIT;
