-- 40_qa_calls_manual_review.sql
-- AI 평가 배치관리 — '사람 수기평가 대상' 표식(도장).
--
-- AI는 전수평가(통화시간 게이트 통과분). 그중 카드 조건(저품질·신뢰도·고점 등)에 맞는 콜에
-- manual_review 도장을 찍어, 평가 리스트에서 "수기평가 대상만" 으로 필터한다(최근순).
--   - manual_review        : 검토 대상 여부(도장)
--   - manual_review_reasons : 왜 뽑혔나(['저품질','신뢰도','고점'] 한글 라벨) — 행 배지용
--   - manual_review_at      : 처음 도장 찍힌 시각(누적 — 한 번 찍히면 유지)
-- 진행단계는 기존 review_status 가 담당(직교). 도장=대상 여부, status=검토 진행.
-- 멱등: ADD COLUMN IF NOT EXISTS — seeder 재실행 안전.

ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS manual_review         boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS manual_review_reasons jsonb       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS manual_review_at      timestamptz;

COMMENT ON COLUMN public.qa_calls.manual_review IS '사람 수기평가 대상 도장(배치 조건 매칭). review_status(진행단계)와 직교.';

-- "수기평가 대상만" 필터가 자주 → 도장된 행만 부분 인덱스.
CREATE INDEX IF NOT EXISTS idx_qa_calls_manual_review
    ON public.qa_calls (manual_review)
    WHERE manual_review = true;
