-- ============================================================
-- 74_qa_call_item_score_ai_confidence.sql — 항목별 AI 신뢰도 컬럼 (2026-07-28)
-- ------------------------------------------------------------
-- 목적: 평가 백엔드(qa-pipeline)가 응답에 실어 보내는 '항목별 AI 신뢰도'를
--       콜 × 평가항목 grain 그대로 보관한다.
--
-- 왜 여기인가:
--   qa_call_item_score 의 PK 가 ("ID", order_no) = 콜 × 평가항목 이라
--   "콜당 · 평가항목당 신뢰도" 와 grain 이 정확히 일치한다. 별도 테이블 불필요.
--
-- ★ NULL 의 의미 = '신뢰도 미제공' (값 0 과 구분).
--   기존 행과, 백엔드가 값을 안 보낸 항목은 NULL 로 남는다.
--   같은 테이블 max_score 에서 이미 겪은 함정이다 — NULL(분모 제외)을
--   코드가 5 로 폴백해 총점이 조용히 틀어졌고, 프론트 사본까지 왜곡됐다.
--   읽는 쪽에서 NULL 에 기본값을 채우지 말 것.
--
-- ★ 스케일 = 0~1 (확정). 백엔드 dashboard_output.py::_item_confidence 가 0~1 로 통일해서 보낸다.
--   내부 표현이 경로마다 달라(confidence dict {final:1~5} / self_confidence 1~5 / 이미 환산된 0~1)
--   백엔드에서 흡수하고, 대시보드는 받은 값을 **그대로** 저장한다(적재 단계 환산 없음).
--   order 1개가 파이프라인 항목 여러 개에 대응하므로 백엔드가 구성 항목 신뢰도의 **최솟값**을 보낸다
--   (용도가 '사람이 다시 볼 콜 선별' 이라 하나라도 불확실하면 대상 — 보수적 집계).
--   numeric(자릿수 미지정)으로 두는 것은 소수 3자리 값을 손실 없이 받기 위함.
--
-- 멱등: ADD COLUMN IF NOT EXISTS — 시더가 매 기동 재실행해도 안전.
-- ============================================================

ALTER TABLE public.qa_call_item_score
    ADD COLUMN IF NOT EXISTS ai_confidence numeric;

COMMENT ON COLUMN public.qa_call_item_score.ai_confidence IS
    '평가 백엔드가 산출한 항목별 AI 신뢰도(원값 그대로). NULL=미제공(0 과 구분). 스케일 규약 미확정.';

-- 저신뢰 항목 조회용 부분 인덱스 — 값이 있는 행만 색인(현재 전량 NULL 이라 사실상 빈 인덱스).
CREATE INDEX IF NOT EXISTS idx_qa_call_item_score_ai_confidence
    ON public.qa_call_item_score ("ID", ai_confidence)
    WHERE ai_confidence IS NOT NULL;
