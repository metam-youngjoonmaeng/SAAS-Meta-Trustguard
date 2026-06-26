-- 44: admin_users 호환 VIEW 에 인사 필드(입퇴사/내선/중복로그인) 노출 + UPDATE 트리거 반영.
--   30 의 VIEW/트리거를 직접 수정하지 않고(공유 스키마 보호) 여기서 CREATE OR REPLACE 로 덮어쓴다.
--   CREATE OR REPLACE VIEW 는 기존 컬럼 순서 유지 + 신규 컬럼은 끝에 append 만 허용 → 동일 순서 재현.
--   멱등: 재실행 안전.

BEGIN;

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
    u.username                                             AS username,
    -- ── 신규 인사 필드(끝에 append) ──
    tr.hire_date                                           AS hire_date,
    tr.leave_date                                          AS leave_date,
    tr.extension                                           AS extension,
    tr.dup_login_yn                                        AS dup_login_yn,
    tr.status                                              AS status
FROM public.users u
LEFT JOIN public.trainee_registrations tr ON tr.user_id = u.id;

-- INSTEAD OF UPDATE — 인사 필드도 trainee_registrations 로 라우팅.
CREATE OR REPLACE FUNCTION public.admin_users_upd() RETURNS trigger AS $$
BEGIN
    UPDATE public.users
       SET name          = NEW.display_name,
           password_hash = NEW.password_hash
     WHERE id = OLD.user_id;

    UPDATE public.trainee_registrations
       SET role                 = COALESCE(NEW.role, 'agent')::public.userrole,
           status               = CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
           org_id               = NEW.org_id,
           department           = NEW.department,
           profile_image_path   = NEW.profile_image_path,
           must_change_password = COALESCE(NEW.must_change_password, false),
           name                 = NEW.display_name,
           hire_date            = NEW.hire_date,
           leave_date           = NEW.leave_date,
           extension            = NEW.extension,
           dup_login_yn         = COALESCE(NEW.dup_login_yn, 'N')
     WHERE user_id = OLD.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
