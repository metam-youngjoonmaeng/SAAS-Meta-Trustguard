-- ============================================================
-- 12_drop_gemini_confidence.sql — Gemini 2차 신뢰도 판정 레이어 제거 (통합DB 기준)
-- ------------------------------------------------------------
-- 구 docker/init/postgres/75_drop_gemini_confidence.sql 의 통합DB 재작성.
--   public.qa_call_annotation  → trustguard.eval_annotation
--   public.qa_confidence_prompt → trustguard.qa_confidence_prompt
--
-- 배경 : 구 구현은 Gemini 를 직접 호출해 콜별 { uncertain / weak / contradiction } 을
--        재판정하고 그 결과를 annotation 에 적재하는 **2차 레이어**였다.
--        평가 백엔드 라우팅을 우회했고 실사용 0 이라 폐기한다.
--
-- 대체 : 신뢰도 출처 = trustguard.eval_item_score.ai_confidence (11 에서 추가).
--        평가 백엔드가 응답에 실어 보내는 항목별 신뢰도를 그대로 쓴다.
--
-- 남는 것 : comments / comments_at — 관리자 코멘트(사람)로 구 qa_admin_comments 계보.
--           이건 신뢰도와 무관하므로 보존한다.
--
-- 멱등: DROP ... IF EXISTS — 매 기동 재실행해도 안전.
-- 롤백: 컬럼 재생성만으로는 값이 돌아오지 않는다(판정 결과는 재생성 불가).
--       제거 전 백업이 필요하면 아래 순서로:
--         CREATE TABLE trustguard.eval_annotation_before_12 AS
--           SELECT * FROM trustguard.eval_annotation;
--
-- ※ 실행 보류 — 통합DB 는 3개 서비스 공유. 2026-08-04 실측 기준 미반영
--   (judgments·has_uncertain·has_weak·has_contradiction·prompt_version·model·judged_at 잔존,
--    qa_confidence_prompt 테이블 잔존). 파괴적 DDL 이므로 적용 전 담당자 확인 필수.
-- ============================================================

DROP TABLE IF EXISTS trustguard.qa_confidence_prompt;

DROP INDEX IF EXISTS trustguard.idx_eval_annotation_flags;

ALTER TABLE trustguard.eval_annotation
    DROP COLUMN IF EXISTS judgments,
    DROP COLUMN IF EXISTS has_uncertain,
    DROP COLUMN IF EXISTS has_weak,
    DROP COLUMN IF EXISTS has_contradiction,
    DROP COLUMN IF EXISTS prompt_version,
    DROP COLUMN IF EXISTS model,
    DROP COLUMN IF EXISTS judged_at;

COMMENT ON TABLE trustguard.eval_annotation IS
    '콜 부가정보(콜당 1행, call_id→common.calls). comments=관리자 코멘트(사람). 구 qa_admin_comments. '
    'AI 신뢰도 판정 컬럼은 제거 — 신뢰도는 trustguard.eval_item_score.ai_confidence 사용.';
