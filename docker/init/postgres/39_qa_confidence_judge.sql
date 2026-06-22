-- 39_qa_confidence_judge.sql
-- AI 평가 배치관리 ② "AI 신뢰도 검증" — LLM 판정 기반.
--
-- 설계(엔진 confidence 와 독립된, 우리가 100% 제어하는 2차 AI 레이어):
--   AI가 매긴 점수+근거 텍스트를 우리가 붙인 LLM(Gemini)이 읽고
--   "사람이 다시 들어봐야 하는 평가인지"를 맥락으로 판정 → 결과를 저장(precompute).
--   배치 미리보기/선별은 저장된 플래그만 필터 → 빠르고 저렴(LLM 을 실시간 경로에 두지 않음).
--   판정 기준(프롬프트)은 관리자가 소유·편집 — 키워드 사전이 아니라 '맥락 판단 지시문'.
-- 멱등: CREATE TABLE IF NOT EXISTS — seeder 재실행 안전.

-- 관리자 관리 판정 프롬프트(브랜드별 1행). 없으면 코드의 DEFAULT_PROMPT 사용.
-- 편집 시 version 증가 → 기존 판정이 stale 처리되어 재판정 대상이 된다.
CREATE TABLE IF NOT EXISTS public.qa_batch_prompts (
    org_id        integer PRIMARY KEY,         -- 0 = 전체/기본
    version       integer     NOT NULL DEFAULT 1,
    system_prompt text        NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    integer
);

-- 콜별 신뢰도 판정 결과(precompute). 항목별 플래그는 judgments(jsonb)에,
-- 콜 단위 빠른 필터용 롤업은 has_* 컬럼에.
--   judgments = [{order_no, uncertain, weak, contradiction, note}]
CREATE TABLE IF NOT EXISTS public.qa_confidence_judgments (
    qa_id             text PRIMARY KEY,
    judgments         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    has_uncertain     boolean     NOT NULL DEFAULT false,
    has_weak          boolean     NOT NULL DEFAULT false,
    has_contradiction boolean     NOT NULL DEFAULT false,
    prompt_version    integer     NOT NULL DEFAULT 0,  -- 판정에 쓰인 프롬프트 버전(재판정 판별)
    model             text,
    judged_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.qa_batch_prompts IS
    'AI 신뢰도 검증 LLM 판정 프롬프트(관리자 관리, 브랜드별). 없으면 코드 DEFAULT_PROMPT.';
COMMENT ON TABLE public.qa_confidence_judgments IS
    '콜별 신뢰도 LLM 판정 결과(precompute). judgments=항목별 플래그, has_*=콜 롤업.';
