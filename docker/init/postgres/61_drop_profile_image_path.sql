-- 61: profile_image_path 컬럼 최종 제거 (프로필 사진 업로드 기능 폐지 후속).
--
-- 참조 제거 순서상 안전 보장:
--   · 10  : (구)admin_users 테이블에 컬럼 추가하던 것 제거
--   · 29  : trainee_registrations CREATE TABLE 컬럼 + admin_users 백필 참조 제거
--   · 30  : admin_users 뷰/upd 트리거에서 참조 제거 (DROP VIEW + 재생성)
--   · 44/46/56 : admin_users 뷰/upd 트리거 CREATE OR REPLACE 에서 참조 제거(동일 순서 유지)
--   → 이 시점(61)에는 어떤 뷰/트리거도 컬럼에 의존하지 않으므로 DROP COLUMN 이 성공한다.
--
-- 신규 설치: 컬럼이 애초에 생성되지 않음 → IF EXISTS no-op.
-- 기존 설치: 남아있던 컬럼(항상 NULL) 제거.
-- 멱등: 재실행 시 이미 없으므로 no-op.

ALTER TABLE public.trainee_registrations DROP COLUMN IF EXISTS profile_image_path;
