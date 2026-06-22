-- 41_qa_batch_prompt_parts.sql
-- AI 신뢰도 검증 ② — 판정 프롬프트를 '관리자 편집 가능한 두 정의문'으로 분리.
--
-- 설계: 관리자는 두 판단 기준만 편집한다(B안 — 화면 2섹션 / 저장은 1프롬프트).
--   - uncertain_def      : "불확실 표현"을 무엇으로 볼지(정의문)
--   - contradiction_def  : "근거-점수 모순"을 무엇으로 볼지(정의문)
-- 출력 JSON 포맷·역할 지시 같은 골격은 코드(geminiJudge.buildSystemPrompt)가 고정 →
--   admin 이 포맷을 깨뜨려 판정 전체가 망가지는 사고를 방지한다.
-- system_prompt(기존 컬럼)에는 두 정의문을 끼운 '조립된 전체 프롬프트'를 그대로 저장 →
--   판정 경로(resolvePrompt → judgeReasons)는 무변경(기존대로 system_prompt 사용).
-- 멱등: ADD COLUMN IF NOT EXISTS — seeder 재실행 안전.

ALTER TABLE public.qa_batch_prompts ADD COLUMN IF NOT EXISTS uncertain_def     text;
ALTER TABLE public.qa_batch_prompts ADD COLUMN IF NOT EXISTS contradiction_def text;

COMMENT ON COLUMN public.qa_batch_prompts.uncertain_def IS
    'AI 신뢰도 검증 ② "불확실 표현" 판정 기준(관리자 편집). NULL=코드 기본값.';
COMMENT ON COLUMN public.qa_batch_prompts.contradiction_def IS
    'AI 신뢰도 검증 ② "근거-점수 모순" 판정 기준(관리자 편집). NULL=코드 기본값.';
