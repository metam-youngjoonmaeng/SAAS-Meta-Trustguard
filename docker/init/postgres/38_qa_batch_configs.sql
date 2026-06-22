-- 38_qa_batch_configs.sql
-- AI 평가 배치관리 조건 설정 저장.
--
-- BatchManage 화면의 조건 세트(5개 카드 on/off + 하위규칙 + 공통 통화시간 범위/스케줄)를
-- 브랜드(org) 단위로 1행 보관한다. 화면 state 를 그대로 JSONB 로 직렬화 — 카드/규칙이
-- 늘어도 스키마 변경 없이 수용(조건 모델이 아직 진화 중인 PoC 단계라 정규화보다 유연성 우선).
--
-- org_id 키: 브랜드별 별도 정책. super_admin '전체' 컨텍스트(activeOrgId=null)는 0 으로 보관.
-- 멱등: CREATE TABLE IF NOT EXISTS — seeder 재실행 안전.

CREATE TABLE IF NOT EXISTS public.qa_batch_configs (
    org_id      integer PRIMARY KEY,          -- 브랜드 org_id. 0 = 전체/기본(super_admin)
    config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  integer                       -- 마지막 저장 admin user_id (감사용, FK 없음)
);

COMMENT ON TABLE public.qa_batch_configs IS
    'AI 평가 배치 조건 설정(브랜드별 1행). config=BatchManage 화면 state 직렬화. org_id 0=전체.';
