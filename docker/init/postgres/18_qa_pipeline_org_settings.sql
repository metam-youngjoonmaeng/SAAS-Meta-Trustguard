-- ============================================================
-- 18_qa_pipeline_org_settings.sql — qa-pipeline 커스텀 루브릭 연동 설정 + KMS 결과 적재 테이블
-- ------------------------------------------------------------
-- 목적:
--   (A) qa_pipeline_org_settings — org(브랜드) 당 qa-pipeline 커스텀 루브릭 매핑 1행.
--       평가항목 관리(department='기본') 저장 시 rubricSync 가 루브릭을 생성/갱신하고
--       발급된 rubric_id('rbrc_<12hex>') 와 index→order_no 매핑(item_order) 을 보관.
--       다음 /evaluate 부터 metadata.rubric_id 로 루브릭 트랙(5000번대 항목) 평가.
--   (B) qa_kms_results — /evaluate 응답 top-level kms_evaluation 블록(충족률 모델, 점수 없음) 적재.
--       콜 1건당 1행, payload jsonb 원문 보존. GET /api/evaluations/:qaId 가 kms 필드로 에코.
--
-- 컬럼 의미:
--   qa_pipeline_org_settings.rubric_id   : qa-pipeline 발급 'rbrc_<12hex>'. NULL=커스텀 루브릭 미사용(표준18항목).
--   qa_pipeline_org_settings.item_order  : 루브릭 index → 대시보드 order_no 매핑(번호-5000 기반).
--                                          저장마다 eval_item_number 재발번되므로 index 기반 환원 필수.
--   qa_kms_results."ID"                  : qa_calls."ID" 와 동일 콜 식별자.
--   qa_kms_results.payload               : kms_evaluation 블록 원문(detected_intents/mandatory_checks_by_intent 등).
--
-- 멱등/non-clobbering:
--   - CREATE TABLE IF NOT EXISTS — seed-if-empty.sh idempotent 재적용 안전.
--   - 신규 테이블만 추가(additive). 기존 동작·신한/한화 적재 경로 불변.
--   - FK ON DELETE CASCADE(organizations / qa_calls) — 02_brands_domains.sql:30 패턴 일치.
-- ============================================================

BEGIN;

-- ── (A) org → 커스텀 루브릭 매핑 ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_pipeline_org_settings (
    org_id      integer PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    rubric_id   text,
    item_order  jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── (B) KMS 충족률 결과 적재 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_kms_results (
    "ID"        text PRIMARY KEY REFERENCES public.qa_calls("ID") ON DELETE CASCADE,
    payload     jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
