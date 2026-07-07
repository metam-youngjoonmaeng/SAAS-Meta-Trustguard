-- 59: LLM 스킬셋 버전 영속 저장소 (2026-07-07)
-- 스킬 버전·룰 원문(파이프라인 store-dump 전체: {store, files, manifests})을 브랜드당 1행 jsonb 로 보관.
-- 배경: 스킬 버전은 파이프라인 디스크 파일로만 존재해 배포 스왑 시 소실(org4 사고) —
--       qa_skill_memory(57)와 동일 소유 모델로 DB 를 생존 계층으로 승격.
-- 기존 환경(이미 생성된 볼륨)은 서버 런타임 CREATE TABLE IF NOT EXISTS 가 동일 DDL 을 보장한다.

CREATE TABLE IF NOT EXISTS public.qa_skill_versions (
    rubric_id  text        PRIMARY KEY,
    org_id     integer     REFERENCES public.organizations(id) ON DELETE CASCADE,
    store      jsonb       NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now()
);
