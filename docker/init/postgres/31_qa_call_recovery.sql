-- ============================================================
-- 31: 회복률(부정→긍정 회복) 분석 결과 — 05 자체 테이블/기준.
--
-- 배경: 03 tb_ta_rslt 는 통화당 종합감정(sentiment_cls) 1개라 '통화 내 감정 흐름'을
--       알 수 없다. 단, tb_ta_rslt.segments(JSON).segments[] 에는 구간별 sentiment
--       (긍정/부정/중립) + turn 범위가 있다. 05 가 이 구간 감정열을 입력으로 받아
--       자체 '회복' 기준을 적용해 콜 단위로 저장한다(조인 키 proj_cd, uid).
--
-- 05 회복 기준(확정): "부정으로 안 끝남"
--   - had_negative : 부정 구간이 1회 이상 등장 → 회복률 분모
--   - recovered    : had_negative 이고 마지막 구간 감정이 '긍정' 또는 '중립' → 분자
--   회복률 = recovered 통화수 / had_negative 통화수
--
-- 채움: 서버가 본인 콜 uid 로 03 segments 를 읽어 기준 적용 후 upsert(lazy 동기화).
-- 멱등: CREATE TABLE IF NOT EXISTS — seeder 재실행 안전.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.qa_call_recovery (
    id              SERIAL PRIMARY KEY,
    proj_cd         text NOT NULL,
    uid             text NOT NULL,
    agent_user_id   integer REFERENCES public.admin_users(user_id) ON DELETE SET NULL,  -- 담당 상담사(집계 키)
    segment_count   integer NOT NULL DEFAULT 0,     -- 구간 수
    neg_seg_count   integer NOT NULL DEFAULT 0,     -- 부정 구간 수
    first_neg_idx   integer,                        -- 첫 부정 구간 순번(1-base), 없으면 NULL
    final_sentiment text,                           -- 마지막 구간 감정(긍정/부정/중립)
    had_negative    boolean NOT NULL DEFAULT false, -- 부정 구간 존재 → 회복률 분모
    recovered       boolean NOT NULL DEFAULT false, -- 05 기준: 부정 발생 && 마지막 긍정/중립
    source          text NOT NULL DEFAULT 'ta_segments',  -- 분석 입력 출처
    analyzed_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (proj_cd, uid)
);

CREATE INDEX IF NOT EXISTS idx_qa_call_recovery_agent ON public.qa_call_recovery (agent_user_id);
