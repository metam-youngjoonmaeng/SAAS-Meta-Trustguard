-- 45: trainee_registrations.department 를 NOT NULL + DEFAULT '고객지원실' 로 강제.
--
-- 부서는 모든 사용자에게 필수값(미지정/NULL 금지). 기본값은 기본 브랜드(METAM 등) 부서인
-- '고객지원실'. 신한/한화 등 별도 부서 체계 브랜드는 화면 드롭다운(constants.js BRAND_CONFIG)
-- 이 브랜드별 옵션을 강제하므로, 본 DEFAULT 는 부서 미입력 시의 폴백(안전망)으로만 동작한다.
--
-- admin_users 뷰의 INSERT 트리거는 NEW.department 를 그대로 넣으므로(빈문자열도 통과),
-- 트리거에서 NULLIF + COALESCE 로 기본값을 적용해 NOT NULL 위반/빈값 유입을 막는다.
-- idempotent: 시더가 매 기동 재적용해도 안전(백필 + ALTER … SET … 은 멱등).

-- 1) 기존 NULL/빈값 백필
UPDATE public.trainee_registrations
   SET department = '고객지원실'
 WHERE department IS NULL OR btrim(department) = '';

-- 2) DEFAULT + NOT NULL
ALTER TABLE public.trainee_registrations
    ALTER COLUMN department SET DEFAULT '고객지원실';
ALTER TABLE public.trainee_registrations
    ALTER COLUMN department SET NOT NULL;

-- 3) admin_users INSERT 트리거: 빈값/NULL → 기본값 (마이그레이션 30 정의 + COALESCE 보정)
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
        COALESCE(NULLIF(btrim(NEW.department), ''), '고객지원실'),
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
