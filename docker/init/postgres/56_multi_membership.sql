-- ============================================================
-- 56_multi_membership.sql — 04 를 02/03 과 동일한 다중 소속 구조로
-- ------------------------------------------------------------
-- 배경: 02/03 은 trainee_registrations 에 유니크 제약이 없어 한 유저가
--   여러 조직(브랜드)에 소속 가능(멤버십 = 사람 × 조직, 1:N). 04 만
--   uq_trainee_registrations_user_id 로 1인=1멤버십을 강제해 왔다(29 참조).
--   3개 시스템을 단일 users 테이블로 병합하려면 이 제약이 걸림돌이라 제거한다.
--
-- 핵심(로그인 무회귀): admin_users 는 수많은 코드가 "유저당 1행"으로 읽는
--   호환 VIEW 다. 멤버십이 여러 개가 돼도 깨지지 않도록, VIEW 가 항상
--   "활성 멤버십 1행"만 반환하게 한다(users.last_active_trainee_id 우선,
--   없으면 active 중 최소 id). 02 의 _pick_active_trainee 와 동일 우선순위.
--   → user_id 키 구조·기존 쿼리·트리거는 그대로, org/role 만 활성 멤버십을 따름.
--
-- 멱등: CREATE OR REPLACE / DROP INDEX IF EXISTS / 제약 존재검사. 재실행 안전.
-- ============================================================

BEGIN;

-- ── 1) 1인=1멤버십 유니크 제거 (02/03 과 동일: 다중 소속 허용) ──
DROP INDEX IF EXISTS public.uq_trainee_registrations_user_id;

-- ── 2) users.last_active_trainee_id — FK + 백필 (활성 멤버십 포인터) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_last_active_trainee_fk') THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_last_active_trainee_fk
            FOREIGN KEY (last_active_trainee_id)
            REFERENCES public.trainee_registrations(id) ON DELETE SET NULL;
    END IF;
END$$;

-- 기존 유저(현재 1멤버십)의 활성 포인터 채움 — active 우선, 그다음 최소 id.
UPDATE public.users u
   SET last_active_trainee_id = (
       SELECT t.id FROM public.trainee_registrations t
        WHERE t.user_id = u.id
        ORDER BY (t.status = 'active') DESC, t.id ASC
        LIMIT 1
   )
 WHERE u.last_active_trainee_id IS NULL;

-- ── 3) admin_users VIEW — 활성 멤버십 1행만 반환 (컬럼/순서 동일 → 트리거 보존) ──
--   LATERAL 로 유저당 1개 멤버십만 고른다: last_active → active → 최소 id.
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
    u.created_at                                           AS updated_at,
    u.email                                                AS email,
    u.username                                             AS username,
    tr.hire_date                                           AS hire_date,
    tr.leave_date                                          AS leave_date,
    tr.extension                                           AS extension,
    tr.dup_login_yn                                        AS dup_login_yn,
    tr.status                                              AS status
FROM public.users u
LEFT JOIN LATERAL (
    SELECT t.*
      FROM public.trainee_registrations t
     WHERE t.user_id = u.id
     ORDER BY (t.id = u.last_active_trainee_id) DESC NULLS LAST,  -- 활성 포인터 우선
              (t.status = 'active') DESC,                          -- 그다음 active
              t.id ASC                                             -- 그다음 최소 id(가입순)
     LIMIT 1
) tr ON TRUE;

-- ── 4) INSTEAD OF UPDATE — 활성 멤버십 1건만 갱신 (WHERE user_id → 활성 id) ──
--   여러 멤버십이 있어도 admin_users 를 통한 수정은 "현재 활성 멤버십"에만 적용.
--   (다른 org 로의 추가/전환은 별도 멤버십 API 로 — 이 트리거로 전 멤버십을 덮지 않는다.)
CREATE OR REPLACE FUNCTION public.admin_users_upd() RETURNS trigger AS $$
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
           profile_image_path   = NEW.profile_image_path,
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
$$ LANGUAGE plpgsql;

-- ── 5) INSTEAD OF INSERT — 새 유저 생성 시 활성 포인터도 세팅 ──
CREATE OR REPLACE FUNCTION public.admin_users_ins() RETURNS trigger AS $$
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
        (user_id, org_id, name, department, role, status, must_change_password)
    VALUES (
        v_uid,
        NEW.org_id,
        NEW.display_name,
        NEW.department,
        COALESCE(NEW.role, 'agent')::public.userrole,
        CASE WHEN COALESCE(NEW.is_active, 1) = 1 THEN 'active' ELSE 'suspended' END,
        COALESCE(NEW.must_change_password, false)
    )
    RETURNING id INTO v_tid;

    UPDATE public.users SET last_active_trainee_id = v_tid WHERE id = v_uid;

    NEW.user_id := v_uid;
    NEW.is_active := COALESCE(NEW.is_active, 1);
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
