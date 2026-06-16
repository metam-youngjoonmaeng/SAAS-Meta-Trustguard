-- ============================================================
-- 06_revert_eval_items.sql — 평가항목관리 1단계 MVP 전면 롤백
-- ------------------------------------------------------------
-- 직전 시도(구 06_eval_items.sql + 07_eval_items_seed.sql)에서 생성된 객체를
-- 모두 idempotent 하게 제거한다. 신한 운영 데이터는 처음부터 건드린 적 없고,
-- 본 스크립트도 운영 테이블(qa_calls, qa_checklist_rows, qa_evaluation_rows,
-- qa_analysis_report, qa_consumer_eval_rows, admin_users, qa_golden_set)
-- 의 데이터는 절대 수정하지 않는다.
--
-- 제거 대상:
--   1) qa_evaluation_rows.item_version_id     (구 06 이 ADD COLUMN 한 nullable FK)
--   2) qa_analysis_report.axis_version_id     (구 06 이 ADD COLUMN 한 nullable FK)
--   3) eval_items / eval_item_versions / pentagon_axes / pentagon_axis_versions 4 테이블
--   4) 트리거 / 함수 7개
-- ============================================================

BEGIN;

-- 1) ALTER 로 추가됐던 스냅샷 FK 컬럼 제거 (값이 채워진 적이 없어 데이터 손실 0)
ALTER TABLE IF EXISTS public.qa_evaluation_rows DROP COLUMN IF EXISTS item_version_id;
ALTER TABLE IF EXISTS public.qa_analysis_report DROP COLUMN IF EXISTS axis_version_id;

-- 2) 4 테이블 — eval_item_versions/pentagon_axis_versions 가 부모 참조이므로 자식부터
DROP TABLE IF EXISTS public.eval_item_versions      CASCADE;
DROP TABLE IF EXISTS public.eval_items              CASCADE;
DROP TABLE IF EXISTS public.pentagon_axis_versions  CASCADE;
DROP TABLE IF EXISTS public.pentagon_axes           CASCADE;

-- 3) 트리거 함수 + 시드 헬퍼 함수
DROP FUNCTION IF EXISTS public.eval_items_enforce_yes_no_max()    CASCADE;
DROP FUNCTION IF EXISTS public.pentagon_axes_touch_updated_at()   CASCADE;
DROP FUNCTION IF EXISTS public.eval_items_seed_one(INT, INT, TEXT, TEXT, TEXT, NUMERIC, BIGINT, TEXT, TEXT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.pentagon_axes_seed_one(INT, SMALLINT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.seed_default_eval_template(INT)    CASCADE;

COMMIT;
