-- 61_drop_profile_image_path.sql
-- 프로필 사진 업로드 기능 폐지에 따라 더 이상 사용하지 않는 profile_image_path 컬럼 제거.
--
-- 경로: trainee_registrations.profile_image_path(text) → admin_users 뷰로 노출.
--   · 데이터: 항상 NULL(업로드한 사용자 0명)  · 코드 참조: 0건(server/*, frontend/* 정리 완료)
--   · admin_users 뷰가 이 컬럼을 SELECT 하고, admin_users_upd 트리거가 대입하므로
--     단순 DROP COLUMN 은 뷰 의존성으로 막힘 → 뷰(+INSTEAD OF 트리거) 재생성 후 컬럼 DROP.
--
-- 멱등: 컬럼이 이미 없으면 ALTER 는 no-op. 뷰/함수/트리거는 항상 라이브 정의(profile_image_path 제외)로 재생성.
-- 라이브 DB 는 seeder 가 재적용하지 않으므로 수동 적용함(신규 설치는 seed-if-empty 가 순서대로 실행).

BEGIN;

-- 1) 뷰 드롭 — INSTEAD OF 트리거(trg_admin_users_ins/upd/del)도 함께 제거된다.
--    (의존하는 다른 뷰/룰 없음을 확인함 — pg_depend 검사)
DROP VIEW IF EXISTS public.admin_users;

-- 2) 뷰 의존성이 사라졌으므로 베이스 테이블에서 컬럼 제거.
ALTER TABLE public.trainee_registrations DROP COLUMN IF EXISTS profile_image_path;

-- 3) admin_users 뷰 재생성 — profile_image_path 두 곳(외부 SELECT + LATERAL 서브쿼리)만 제외, 나머지 동일.
CREATE VIEW public.admin_users AS
 SELECT u.id AS user_id,
    COALESCE(u.username, regexp_replace(u.email, '\.ics$'::text, ''::text)) AS login_id,
    u.password_hash,
    u.name AS display_name,
    tr.role::text AS role,
        CASE
            WHEN tr.status::text = 'active'::text THEN 1
            ELSE 0
        END::smallint AS is_active,
    tr.org_id,
    tr.department,
    COALESCE(tr.must_change_password, false) AS must_change_password,
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
     LEFT JOIN LATERAL ( SELECT t.id,
            t.user_id,
            t.org_id,
            t.name,
            t.department,
            t.hire_date,
            t.role,
            t.status,
            t.must_change_password,
            t.leave_date,
            t.extension,
            t.dup_login_yn
           FROM trainee_registrations t
          WHERE t.user_id = u.id
          ORDER BY (t.id = u.last_active_trainee_id) DESC NULLS LAST, (t.status::text = 'active'::text) DESC, t.id
         LIMIT 1) tr ON true;

-- 4) INSTEAD OF UPDATE 트리거 함수 재생성 — profile_image_path 대입 라인 제거.
--    (ins/del 함수는 원래 이 컬럼을 참조하지 않아 그대로 유지)
CREATE OR REPLACE FUNCTION public.admin_users_upd()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE public.users
       SET name          = NEW.display_name,
           password_hash = NEW.password_hash
     WHERE id = OLD.user_id;

    UPDATE public.trainee_registrations tr
       SET role                 = COALESCE(NEW.role, 'agent')::public.userrole,
           status               = CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
           org_id               = NEW.org_id,
           department           = NEW.department,
           must_change_password = COALESCE(NEW.must_change_password, false),
           name                 = NEW.display_name
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

-- 5) INSTEAD OF 트리거 재부착 (뷰 재생성으로 사라졌으므로 동일 정의로 복원).
CREATE TRIGGER trg_admin_users_ins INSTEAD OF INSERT ON public.admin_users FOR EACH ROW EXECUTE FUNCTION admin_users_ins();
CREATE TRIGGER trg_admin_users_upd INSTEAD OF UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION admin_users_upd();
CREATE TRIGGER trg_admin_users_del INSTEAD OF DELETE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION admin_users_del();

COMMIT;
