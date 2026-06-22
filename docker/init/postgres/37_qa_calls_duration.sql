-- 37_qa_calls_duration.sql
-- qa_calls 에 통화 소요시간(초) 컬럼 추가.
--
-- 배경: AI 평가 배치관리의 "통화시간 범위" 조건이 콜 선별에 쓰는 신호.
--   ICS(mtm30) tb_stt_master 에는 소요시간 전용 컬럼이 없고
--   CALL_START_DATE / CALL_END_DATE(datetime) 만 있어
--   duration_sec = TIMESTAMPDIFF(SECOND, start, end) 로 산출한다.
--   적재 시점에 우리 qa_calls 로 들고 와 1급 속성으로 보관 → 배치 선별은
--   ICS 의존 없이 Postgres 안에서 끝난다(콜 종료 후 불변값이므로 캐싱 안전).
--
-- 멱등: ADD COLUMN IF NOT EXISTS — seeder 재실행 안전.
-- NULL 의미: 아직 백필되지 않았거나(레거시) 시작/종료시각이 없어 산출 불가(ICS null 6건).
--   배치 "통화시간" 조건은 NULL 을 범위에서 제외한다(미상 → 선별 대상 아님).

ALTER TABLE public.qa_calls
    ADD COLUMN IF NOT EXISTS duration_sec integer;

COMMENT ON COLUMN public.qa_calls.duration_sec IS
    '통화 소요시간(초). ICS CALL_END_DATE-CALL_START_DATE 차. NULL=미상/미백필.';

-- 배치 선별이 통화시간 범위로 자주 필터 → 부분 인덱스(값이 있는 행만).
CREATE INDEX IF NOT EXISTS idx_qa_calls_duration_sec
    ON public.qa_calls (duration_sec)
    WHERE duration_sec IS NOT NULL;
