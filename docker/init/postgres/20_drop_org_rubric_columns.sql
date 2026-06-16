-- ============================================================
-- 20_drop_org_rubric_columns.sql — organizations 루브릭 컬럼 제거
-- ------------------------------------------------------------
-- 목적:
--   organizations.rubric_id / rubric_item_order 제거. 루브릭 push 구조
--   (대시보드 → POST/PUT /v2/rubrics → rubric_id 참조) 폐기 — 백엔드
--   (QA_RUBRIC_SOURCE=db) 가 평가 시 eval_item_defs 를 직접 읽으므로
--   org 별 매핑 보관이 불필요. orderMap 은 평가마다 동일 쿼리로 재파생.
--
-- 멱등: DROP COLUMN IF EXISTS — 없어도 오류 없음.
-- ============================================================

BEGIN;

ALTER TABLE public.organizations
    DROP COLUMN IF EXISTS rubric_id,
    DROP COLUMN IF EXISTS rubric_item_order;

COMMIT;
