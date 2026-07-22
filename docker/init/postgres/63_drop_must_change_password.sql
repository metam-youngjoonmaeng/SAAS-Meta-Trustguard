-- 63_drop_must_change_password.sql
-- "첫 로그인 시 비밀번호 강제 변경"(must_change_password) 기능 완전 제거.
--   · 02(튜터)/03(TA) 의 trainee_registrations 에는 없는 컬럼이라, 3제품 사용자 스키마 정합을 위해 04 에서도 제거한다.
--   · admin_users 는 뷰(INSTEAD OF 트리거)라 CREATE OR REPLACE 로는 컬럼 제거가 불가 → DROP & CREATE 후 트리거 재부착.
--   · department 기본값 처리(마이그 62) 등 나머지 로직은 그대로 보존(이 컬럼만 제거).
-- 멱등: DROP VIEW IF EXISTS → CREATE, CREATE OR REPLACE FUNCTION, (뷰 재생성으로 사라진) 트리거 재생성, DROP COLUMN IF EXISTS.

BEGIN;

DROP VIEW IF EXISTS public.admin_users;

CREATE VIEW public.admin_users AS
 SELECT u.id AS user_id,
    COALESCE(u.username, regexp_replace(u.email, '\.ics$'::text, ''::text)) AS login_id,
    u.password_hash,
    u.name AS display_name,
    tr.role::text AS role,
    CASE WHEN tr.status::text = 'active'::text THEN 1 ELSE 0 END::smallint AS is_active,
    tr.org_id,
    tr.department,
    u.created_at,
    u.created_at AS updated_at,
    u.email,
    u.username,
    tr.hire_date,
    tr.leave_date,
    tr.extension,
    tr.dup_login_yn,
    tr.status
   FROM users u
     LEFT JOIN LATERAL ( SELECT t.id, t.user_id, t.org_id, t.name, t.department,
            t.hire_date, t.role, t.status, t.leave_date, t.extension, t.dup_login_yn
           FROM trainee_registrations t
          WHERE t.user_id = u.id
          ORDER BY (t.id = u.last_active_trainee_id) DESC NULLS LAST, (t.status::text = 'active'::text) DESC, t.id
         LIMIT 1) tr ON true;

CREATE OR REPLACE FUNCTION public.admin_users_ins()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    v_is_ics boolean := position('@' in NEW.login_id) > 0;
    v_email  text;
    v_uname  text;
    v_uid    integer;
    v_tid    integer;
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
        (user_id, org_id, name, department, role, status)
    VALUES (
        v_uid,
        NEW.org_id,
        NEW.display_name,
        COALESCE(NULLIF(btrim(NEW.department), ''), '고객지원실'),
        COALESCE(NEW.role, 'agent')::public.userrole,
        CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END
    )
    RETURNING id INTO v_tid;

    UPDATE public.users SET last_active_trainee_id = v_tid WHERE id = v_uid;

    NEW.user_id := v_uid;
    NEW.is_active := COALESCE(NEW.is_active, 1);
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_users_upd()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    UPDATE public.users
       SET name          = NEW.display_name,
           password_hash = NEW.password_hash
     WHERE id = OLD.user_id;

    UPDATE public.trainee_registrations tr
       SET role       = COALESCE(NEW.role, 'agent')::public.userrole,
           status     = CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
           org_id     = NEW.org_id,
           department = NEW.department,
           name       = NEW.display_name
     WHERE tr.id = (
         SELECT t.id FROM public.trainee_registrations t
          WHERE t.user_id = OLD.user_id
          ORDER BY (t.id = (SELECT last_active_trainee_id FROM public.users WHERE id = OLD.user_id)) DESC NULLS LAST,
                   (t.status = 'active') DESC,
                   t.id ASC
          LIMIT 1
     );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_users_del()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    DELETE FROM public.users WHERE id = OLD.user_id;  -- trainee_registrations/auth_sessions CASCADE
    RETURN OLD;
END;
$function$;

CREATE TRIGGER trg_admin_users_ins INSTEAD OF INSERT ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_ins();
CREATE TRIGGER trg_admin_users_upd INSTEAD OF UPDATE ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_upd();
CREATE TRIGGER trg_admin_users_del INSTEAD OF DELETE ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.admin_users_del();

ALTER TABLE public.trainee_registrations DROP COLUMN IF EXISTS must_change_password;

COMMIT;
