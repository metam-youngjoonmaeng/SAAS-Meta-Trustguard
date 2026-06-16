-- ============================================================
-- 19_drop_kms_merge_org_settings.sql — 폐기 테이블 정리
-- ------------------------------------------------------------
-- 목적:
--   qa_pipeline_org_settings : 루브릭 push 매핑 보관용 — DB 직접 읽기 구조
--                              (백엔드 QA_RUBRIC_SOURCE=db 가 eval_item_defs 를
--                              평가 시 직접 조회) 로 전환되어 불필요.
--   qa_kms_results            : dev프론트는 /evaluate 응답 kms 블록 미저장
--                               (백엔드 KMS 노드는 유지하나 어댑터가 적재하지 않음).
--
-- 멱등: DROP TABLE IF EXISTS — 없어도 오류 없음.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.qa_pipeline_org_settings;
DROP TABLE IF EXISTS public.qa_kms_results;

COMMIT;
