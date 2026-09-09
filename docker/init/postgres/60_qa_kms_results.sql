-- ============================================================
-- 60_qa_kms_results.sql — KMS 필수사항 체크 결과 콜 단위 적재 (2026-08-31)
-- ------------------------------------------------------------
-- 목적:
--   /evaluate 응답 top-level `kiwoom_coverage` 블록(충족률 모델 · 점수 미연동)을 콜 1건당
--   1행으로 원문 보존. 평가 결과 [KMS] 탭
--   (frontend/src/components/Detail/KmsMandatoryPanel.jsx)이 이 payload 를 그대로 렌더한다 —
--   종합 충족률 · 인텐트별 필수항목 O/X/△/- · 업무 트리거 · 확신도 · 적대검증 렌즈.
--
-- 내력:
--   18_qa_pipeline_org_settings.sql 이 같은 목적의 public.qa_kms_results 를 만들었으나
--   19_drop_kms_merge_org_settings.sql 에서 "dev프론트는 /evaluate 응답 kms 블록 미저장"
--   사유로 DROP 됐다. 이제 MTG 가 그 블록을 실제로 쓰므로 되살린다.
--   ★ 구 정의와 다른 점 = **키가 call_id(bigint)** 다. 통합DB 컷오버로 콜 자연키가
--     public.qa_calls."ID"(text) → common.calls.call_id(bigint) 로 바뀌었고, 라이브 경로는
--     common.calls / trustguard.qa_evaluations 다(public.qa_calls 는 레거시 414행).
--
-- 멱등/non-clobbering:
--   - CREATE TABLE IF NOT EXISTS — 재적용 안전.
--   - 신규 테이블만 추가(additive). 기존 테이블·컬럼·제약 **무변경**.
--   - FK ON DELETE CASCADE(common.calls) — 콜 삭제 시 함께 정리.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS trustguard.qa_kms_results (
    call_id     bigint PRIMARY KEY REFERENCES common.calls(call_id) ON DELETE CASCADE,
    payload     jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trustguard.qa_kms_results IS
    'KMS 필수사항 체크(QA-PAIR) 결과 — /evaluate 응답 kiwoom_coverage 원문. 콜 1건당 1행.';
COMMENT ON COLUMN trustguard.qa_kms_results.payload IS
    'kiwoom_coverage 블록 전문 (detected[] · mandatory.evaluations_by_intent · verification · adversarial).';

COMMIT;
