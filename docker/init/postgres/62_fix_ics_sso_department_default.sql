-- 62: admin_users INSERT 트리거의 department 기본값 처리 복원 (ICS SSO 신규계정 500 수정).
--
-- 배경: 마이그레이션 45 가 admin_users_ins() 에서 department 를
--   COALESCE(NULLIF(btrim(NEW.department), ''), '고객지원실') 로 보정해
--   NULL/빈값 → 기본값('고객지원실') 이 되도록 고쳤다.
-- 그러나 이후의 56_multi_membership.sql 이 admin_users_ins() 를 다중소속용으로
--   재정의하면서 department 라인을 다시 `NEW.department` 로 되돌려(회귀), 45 의 보정이 사라졌다.
--
-- 증상: ICS 메뉴(?userId=USER_CD@PROJ_CD)로 처음 진입하는 신규 계정(예: demo20@metam)은
--   admin_users 뷰에 INSERT → 트리거가 trainee_registrations 에 department=NULL 명시 삽입 →
--   NOT NULL 위반(DEFAULT 는 컬럼 생략 시에만 적용, 명시적 NULL 에는 미적용) →
--   POST /api/auth/ics-sso 500 → 프론트가 로그인창으로 폴백.
--   (기존 계정은 UPDATE 경로라 department 를 건드리지 않아 정상 → 200.)
--
-- 조치: 56 의 admin_users_ins() 본문을 유지한 채 department 라인만 45 의 COALESCE 보정으로 복원.
-- idempotent: CREATE OR REPLACE 라 시더가 매 기동 재적용해도 안전. 56 이후 번호(62)라 회귀 방지.

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
        COALESCE(NULLIF(btrim(NEW.department), ''), '고객지원실'),
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
