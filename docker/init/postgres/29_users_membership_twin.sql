-- ============================================================
-- 29: admin_users → users + trainee_registrations (02/03 쌍둥이 전환)
--
-- 목적: 사용자/인증 모델을 02-AI-Tutor-ICS / 03-Meta_Summary-DEV 와
--       동일한 스키마(users + trainee_registrations + auth_sessions)로 통일.
--       추후 3개 시스템이 단일 DB(users 테이블 공유)를 쓰기 위한 선행 작업.
--
-- 핵심 설계:
--   * users.id := 기존 admin_users.user_id 값을 그대로 보존
--     → qa_calls.agent_user_id 등 기존 FK 값이 변경 없이 users.id 를 가리킴.
--   * 인증 정체성(이메일/비번/이름)은 users, 소속/권한/부서는 trainee_registrations.
--   * ICS 합성 이메일 규약 02/03 과 동일: {user_cd}@{proj_cd}.ics
--     로컬 계정: username = 기존 login_id, email = {login_id}@trustguard.local
--   * 비밀번호: SHA256 → bcrypt($2a, pgcrypto crypt+bf) 로 통일(02/03 동일 검증 가능).
--     로컬 계정은 INITIAL 비번으로 리셋 + must_change_password=true.
--     ICS 계정은 SSO 전용이라 password_hash NULL.
--
-- 멱등(idempotent): 재실행 안전. admin_users 는 보존(최종 정리는 별도 단계).
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 0) role enum (02/03 의 userrole 와 동일 라벨) ──────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'userrole') THEN
        CREATE TYPE public.userrole AS ENUM ('agent', 'admin', 'super_admin');
    END IF;
END$$;

-- ── 1) users (02/03 스키마 그대로) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
    id                       integer PRIMARY KEY,          -- = 기존 admin_users.user_id
    email                    text NOT NULL UNIQUE,
    email_hash               text NOT NULL UNIQUE,         -- sha256(lower(email)) hex
    name                     text NOT NULL,
    username                 text UNIQUE,                  -- ID/PW 로그인용(로컬 계정만)
    password_hash            text,                         -- bcrypt($2a). SSO 계정은 NULL
    last_active_trainee_id   integer,
    last_login_at            timestamp with time zone,
    created_at               timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_users_email      ON public.users(email);
CREATE INDEX IF NOT EXISTS ix_users_email_hash ON public.users(email_hash);
CREATE INDEX IF NOT EXISTS ix_users_username   ON public.users(username);

-- ── 2) trainee_registrations (02/03 스키마 + 05 전용 확장 컬럼) ─
CREATE TABLE IF NOT EXISTS public.trainee_registrations (
    id                   SERIAL PRIMARY KEY,
    user_id              integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    org_id               integer REFERENCES public.organizations(id) ON DELETE SET NULL,
    name                 text NOT NULL,
    department           text,
    hire_date            varchar(10),
    role                 public.userrole NOT NULL DEFAULT 'agent',
    status               varchar(16) NOT NULL DEFAULT 'active',  -- active|suspended|expired
    registered_at        timestamp with time zone NOT NULL DEFAULT now(),
    -- 05 전용(02/03 가 단일 DB 합류 시 nullable 로 무해하게 흡수)
    profile_image_path   text,
    must_change_password boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_trainee_registrations_user_id ON public.trainee_registrations(user_id);
CREATE INDEX IF NOT EXISTS ix_trainee_registrations_org_id  ON public.trainee_registrations(org_id);
-- 05 는 1인=1멤버십 → user_id 유니크(추후 멀티 소속 도입 시 제거)
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainee_registrations_user_id ON public.trainee_registrations(user_id);

-- ── 3) auth_sessions (02/03 스키마 그대로 — 파리티용) ─────────
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    session_id    varchar(36) PRIMARY KEY,
    trainee_id    integer REFERENCES public.trainee_registrations(id) ON DELETE CASCADE,
    issued_at     timestamp with time zone NOT NULL DEFAULT now(),
    expires_at    timestamp with time zone NOT NULL,
    last_seen_at  timestamp with time zone NOT NULL DEFAULT now(),
    revoked       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_trainee_id ON public.auth_sessions(trainee_id);

-- ── 4) admin_users → users 백필 ──────────────────────────────
-- ICS 계정 판별: login_id 에 '@' 포함(= user_cd@proj_cd) → 합성 .ics
-- 로컬 계정: username=login_id, email={login_id}@trustguard.local
WITH src AS (
    SELECT
        a.user_id,
        a.login_id,
        a.display_name,
        a.org_id,
        a.role,
        a.is_active,
        a.department,
        a.profile_image_path,
        a.must_change_password,
        a.created_at,
        (position('@' in a.login_id) > 0) AS is_ics,
        CASE
            WHEN position('@' in a.login_id) > 0
                THEN lower(a.login_id) || '.ics'
            ELSE lower(a.login_id) || '@trustguard.local'
        END AS email
    FROM public.admin_users a
)
INSERT INTO public.users (id, email, email_hash, name, username, password_hash, last_login_at, created_at)
SELECT
    s.user_id,
    s.email,
    encode(sha256(convert_to(s.email, 'UTF8')), 'hex'),
    s.display_name,
    CASE WHEN s.is_ics THEN NULL ELSE lower(s.login_id) END,           -- username (로컬만)
    CASE WHEN s.is_ics THEN NULL
         ELSE crypt(COALESCE(NULLIF(current_setting('app.init_pw', true), ''), 'test1234!'),
                    gen_salt('bf', 10)) END,                            -- 로컬: bcrypt 리셋
    NULL,
    s.created_at
FROM src s
ON CONFLICT (id) DO NOTHING;

-- ── 5) admin_users → trainee_registrations 백필 ──────────────
INSERT INTO public.trainee_registrations
    (user_id, org_id, name, department, role, status, registered_at, profile_image_path, must_change_password)
SELECT
    a.user_id,
    a.org_id,
    a.display_name,
    NULLIF(a.department, ''),
    a.role::public.userrole,
    CASE WHEN a.is_active = 1 THEN 'active' ELSE 'suspended' END,
    a.created_at,
    a.profile_image_path,
    -- 로컬 계정은 리셋 비번이므로 강제 변경, ICS/시드는 기존값 유지
    CASE WHEN position('@' in a.login_id) = 0
              AND a.login_id NOT IN ('admin1', 'test1')
         THEN true ELSE a.must_change_password END
FROM public.admin_users a
ON CONFLICT (user_id) DO NOTHING;

-- 시드 계정(admin1=super_admin, test1=admin)은 알려진 초기비번으로 로그인 가능하게.
-- ★ 로그인 코드가 sha256(password) 비교이므로 bcrypt 가 아니라 sha256('1234') 로 설정한다
--   (bcrypt 로 두면 sha256 입력과 영원히 불일치 → admin1/test1 로그인 불가). 매 seeder 실행 시 재적용.
UPDATE public.users u
   SET password_hash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'  -- sha256('1234')
  FROM public.admin_users a
 WHERE a.user_id = u.id
   AND a.login_id IN ('admin1', 'test1');

-- users.id 시퀀스를 admin_users 시퀀스와 맞춤(신규 INSERT 충돌 방지)
SELECT setval(
    pg_get_serial_sequence('public.admin_users', 'user_id'),
    GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.users),
             (SELECT last_value FROM public.admin_users_user_id_seq))
);

-- ── 6) FK 재지정: admin_users(user_id) → users(id) ───────────
-- 값은 보존되었으므로 제약만 교체.
ALTER TABLE public.qa_calls
    DROP CONSTRAINT IF EXISTS qa_calls_agent_user_id_fkey,
    ADD  CONSTRAINT qa_calls_agent_user_id_fkey
         FOREIGN KEY (agent_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.coaching_assignments
    DROP CONSTRAINT IF EXISTS coaching_assignments_assigned_by_user_id_fkey,
    ADD  CONSTRAINT coaching_assignments_assigned_by_user_id_fkey
         FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_recipient_user_id_fkey,
    ADD  CONSTRAINT notifications_recipient_user_id_fkey
         FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_actor_user_id_fkey,
    ADD  CONSTRAINT notifications_actor_user_id_fkey
         FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;

-- ── 7) (별도 단계) 코드 전환 완료 후 실행할 정리 ───────────────
-- 아래는 서버 코드가 users/trainee_registrations 로 모두 전환된 뒤 수동 실행.
--   DROP TABLE IF EXISTS public.admin_users CASCADE;
-- ============================================================
