-- ============================================================
-- admin_users 프로필 셀프-편집 지원 컬럼 추가.
--   1) profile_image_path : 업로드된 아바타 파일 경로 (uploads/profiles/<user_id>.<ext>)
--   2) must_change_password : 관리자가 발급한 초기 비밀번호 사용자를 첫 로그인 시 비번 변경 강제.
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS profile_image_path text;

ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
