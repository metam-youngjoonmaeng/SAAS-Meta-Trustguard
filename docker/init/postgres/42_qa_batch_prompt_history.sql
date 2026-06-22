-- 42_qa_batch_prompt_history.sql
-- AI 신뢰도 검증 ② 판정 프롬프트 '변경 이력'(append-only).
--
-- 저장(PUT /api/batch/prompt)으로 정의문이 바뀔 때마다 1행 append → 버전별 스냅샷.
-- 스냅샷은 '실제 적용된 전체 문구'(기본값 포함)를 그대로 저장 → 이력만으로 그 시점 기준을
-- 완전히 재현/조회 가능(읽기전용). 되돌리기 버튼은 v1 미포함(필요 시 스냅샷 복사 또는 후속).
-- 멱등: CREATE TABLE IF NOT EXISTS — seeder 재실행 안전.

CREATE TABLE IF NOT EXISTS public.qa_batch_prompt_history (
    id                bigserial   PRIMARY KEY,
    org_id            integer     NOT NULL DEFAULT 0,   -- 0 = 전체/기본
    version           integer     NOT NULL,             -- 저장 후 부여된 버전
    uncertain_def     text,                             -- 그 시점 '불확실 표현' 기준(전체 문구)
    contradiction_def text,                             -- 그 시점 '근거-점수 모순' 기준(전체 문구)
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        integer,                          -- admin user_id
    updated_by_name   text                              -- 편집자 표시명(작성 시점 denormalize)
);

CREATE INDEX IF NOT EXISTS idx_qa_batch_prompt_history_org_ver
    ON public.qa_batch_prompt_history (org_id, version DESC);

COMMENT ON TABLE public.qa_batch_prompt_history IS
    'AI 신뢰도 검증 ② 판정 프롬프트 변경 이력(append-only, 버전별 스냅샷). 읽기전용 조회용.';
