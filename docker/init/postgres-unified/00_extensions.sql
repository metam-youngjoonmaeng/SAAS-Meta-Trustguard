-- ============================================================
-- 00_extensions.sql — 통합DB 스키마의 전제 확장
-- ------------------------------------------------------------
-- 01_unified_schema.sql 은 `pg_dump --schema=common --schema=trustguard` 산출이라
-- public 스키마에 설치된 확장이 빠져 있다. citext 가 없으면 첫 CREATE TABLE 에서
--   ERROR: type "public.citext" does not exist
-- 로 즉시 멈춘다(common.tenants.tenant_id 가 citext).
--
-- 통합DB(10.13.2.45:5440/aicc) 실측 확장:
--   citext        (public)   — tenant_id 대소문자 무시 비교. 필수.
--   pgcrypto      (public)   — 해시/암호화 함수. 필수.
--   plpgsql       (pg_catalog) — 기본 설치.
--   postgres_fdw  (common)   — 원격 테이블 연동용. 로컬 재구축에는 불필요하므로 제외
--                              (서버가 FDW 외부테이블을 쓰지 않는다. 필요해지면 여기 추가).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
