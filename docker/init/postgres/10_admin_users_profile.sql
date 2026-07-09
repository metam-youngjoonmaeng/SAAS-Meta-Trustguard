-- ============================================================
-- admin_users 프로필 셀프-편집 지원 컬럼 추가.
--   1) must_change_password : 관리자가 발급한 초기 비밀번호 사용자를 첫 로그인 시 비번 변경 강제.
-- (profile_image_path 는 프로필 사진 업로드 기능 폐지로 제거 — 61 참조)
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

-- 29/30 이후 admin_users 는 VIEW → 테이블일 때만(최초 init) 실행.
DO $$
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.admin_users')) = 'r' THEN
        ALTER TABLE public.admin_users
            ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
    END IF;
END $$;
