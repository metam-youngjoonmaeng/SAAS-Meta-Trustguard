-- 46: trainee_registrations.registered_at(가입일) 폐기.
--   가입일 개념은 사용자 정보로 불필요(입사/퇴사만 사용). 02/03 와 동일 결정.
--   admin_users VIEW 가 updated_at 을 tr.registered_at 에서 끌어쓰므로, 먼저 VIEW 를
--   CREATE OR REPLACE 로 갱신(updated_at ← u.created_at)해 의존을 끊은 뒤 컬럼을 드롭한다.
--   (44 의 VIEW 정의를 그대로 재현 + updated_at 소스만 교체. 트리거는 registered_at 미참조라 불변.)
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
    u.created_at                                           AS updated_at,   -- registered_at 폐기 → 식별 생성시각으로 대체(미사용 호환 컬럼)
    u.email                                                AS email,
    u.username                                             AS username,
    tr.hire_date                                           AS hire_date,
    tr.leave_date                                          AS leave_date,
    tr.extension                                           AS extension,
    tr.dup_login_yn                                        AS dup_login_yn,
    tr.status                                              AS status
FROM public.users u
LEFT JOIN public.trainee_registrations tr ON tr.user_id = u.id;

ALTER TABLE public.trainee_registrations DROP COLUMN IF EXISTS registered_at;

COMMIT;
