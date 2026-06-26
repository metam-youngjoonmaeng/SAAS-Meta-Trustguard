-- ============================================================
-- 30: admin_users 를 users+trainee_registrations 위의 업데이트 가능한 VIEW 로 교체
--
-- 29 에서 만든 twin 테이블(users/trainee_registrations)이 단일 진실원천(SSOT).
-- 기존 서버 코드의 수많은 admin_users 읽기 JOIN/쓰기를 그대로 동작시키기 위한
-- 전환기 호환 레이어. INSTEAD OF 트리거가 컬럼을 두 테이블로 라우팅한다.
--
-- 비밀번호 해시는 호출부(Node)가 bcrypt($2a, pgcrypto crypt)로 넣는다.
-- ON CONFLICT 가 필요한 ICS SSO upsert 만 base 테이블을 직접 쓴다(view 불가).
--
-- 멱등: 재실행 안전.
-- ============================================================

BEGIN;

-- 신규 user INSERT 가 id 를 자동 채우도록 시퀀스를 users.id 기본값으로.
ALTER SEQUENCE public.admin_users_user_id_seq OWNED BY NONE;
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_user_id_seq');

-- admin_users 제거 — 최초 init 이면 TABLE, seeder 재실행이면 이미 VIEW.
-- (DROP TABLE/VIEW 는 대상 종류가 다르면 IF EXISTS 로도 에러 → relkind 로 분기.)
DO $$
DECLARE k "char";
BEGIN
    SELECT relkind INTO k FROM pg_class WHERE oid = to_regclass('public.admin_users');
    IF k = 'r' THEN
        EXECUTE 'DROP TABLE public.admin_users CASCADE';   -- FK 는 29 에서 users 로 재지정됨
    ELSIF k = 'v' THEN
        EXECUTE 'DROP VIEW public.admin_users CASCADE';
    END IF;
END $$;

-- ── 읽기 호환 VIEW ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.admin_users AS
SELECT
    u.id                                                   AS user_id,
    COALESCE(u.username, regexp_replace(u.email, '\.ics$', '')) AS login_id,
    u.password_hash                                        AS password_hash,
    u.name                                                 AS display_name,
    tr.role::text                                          AS role,
    (CASE WHEN tr.status = 'active' THEN 1 ELSE 0 END)::smallint AS is_active,
    tr.org_id                                              AS org_id,
    tr.department                                          AS department,
    tr.profile_image_path                                  AS profile_image_path,
    COALESCE(tr.must_change_password, false)               AS must_change_password,
    u.created_at                                           AS created_at,
    u.created_at                                           AS updated_at,   -- 46 에서 registered_at 폐기 → 동일 소스(재실행 멱등)
    u.email                                                AS email,
    u.username                                             AS username
FROM public.users u
LEFT JOIN public.trainee_registrations tr ON tr.user_id = u.id;

-- ── INSTEAD OF INSERT ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_users_ins() RETURNS trigger AS $$
DECLARE
    v_is_ics boolean := position('@' in NEW.login_id) > 0;
    v_email  text;
    v_uname  text;
    v_uid    integer;
BEGIN
    IF v_is_ics THEN
        v_email := lower(NEW.login_id) || '.ics';
        v_uname := NULL;
    ELSE
        v_email := lower(NEW.login_id) || '@trustguard.local';
        v_uname := lower(NEW.login_id);
    END IF;

    INSERT INTO public.users (email, email_hash, name, username, password_hash, created_at)
    VALUES (
        v_email,
        encode(sha256(convert_to(v_email, 'UTF8')), 'hex'),
        NEW.display_name,
        v_uname,
        NEW.password_hash,
        COALESCE(NEW.created_at, now())
    )
    RETURNING id INTO v_uid;

    INSERT INTO public.trainee_registrations
        (user_id, org_id, name, department, role, status, must_change_password)
    VALUES (
        v_uid,
        NEW.org_id,
        NEW.display_name,
        NEW.department,
        COALESCE(NEW.role, 'agent')::public.userrole,
        CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
        COALESCE(NEW.must_change_password, false)
    );

    NEW.user_id := v_uid;
    NEW.is_active := COALESCE(NEW.is_active, 1);
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── INSTEAD OF UPDATE ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_users_upd() RETURNS trigger AS $$
BEGIN
    -- 인증 정체성(users)
    UPDATE public.users
       SET name          = NEW.display_name,
           password_hash = NEW.password_hash
     WHERE id = OLD.user_id;

    -- 소속/권한(trainee_registrations)
    UPDATE public.trainee_registrations
       SET role                 = COALESCE(NEW.role, 'agent')::public.userrole,
           status               = CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
           org_id               = NEW.org_id,
           department           = NEW.department,
           profile_image_path   = NEW.profile_image_path,
           must_change_password = COALESCE(NEW.must_change_password, false),
           name                 = NEW.display_name
     WHERE user_id = OLD.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── INSTEAD OF DELETE ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_users_del() RETURNS trigger AS $$
BEGIN
    DELETE FROM public.users WHERE id = OLD.user_id;  -- trainee_registrations/auth_sessions CASCADE
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_users_ins ON public.admin_users;
DROP TRIGGER IF EXISTS trg_admin_users_upd ON public.admin_users;
DROP TRIGGER IF EXISTS trg_admin_users_del ON public.admin_users;
CREATE TRIGGER trg_admin_users_ins INSTEAD OF INSERT ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_ins();
CREATE TRIGGER trg_admin_users_upd INSTEAD OF UPDATE ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_upd();
CREATE TRIGGER trg_admin_users_del INSTEAD OF DELETE ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_del();

COMMIT;
