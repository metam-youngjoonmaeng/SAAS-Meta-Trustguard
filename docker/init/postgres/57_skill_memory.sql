-- ============================================================
-- 57_skill_memory.sql — LLM 스킬화 메모리(P1) 저장소
-- ------------------------------------------------------------
-- 배경: qa-pipeline v2/mtg_skill 의 검수 정정 학습 메모리(핵심설계 §2 6종:
--   cases/journal/patterns/effect/last_learned/근거핀)는 지금까지 파이프라인
--   서버 파일(v2/prompts/mtg_skills/{rubric}/memory.json)에 저장돼 왔다. 파이프라인
--   재배포 시 유실 위험 + 브랜드 삭제와 무관하게 고아로 남는 문제가 있어, 소유권을
--   MTG DB 로 옮긴다. 파이프라인은 무상태 — 학습 요청 body.memory 로 받아 쓰고
--   응답 body.memory 로 최종본을 돌려주며(=이 테이블이 SSOT), 파일은 폴백으로만 잔존.
--
-- 저장 단위: 브랜드(rubric_id) 1행 = memory.json 전체를 jsonb 로 통째 보관
--   ({schema_version, rubric_id, items:{"<item_number>":{...}}}). 키는 파이프라인
--   load_memory(rubric_id) 시그니처와 정합하도록 rubric_id 를 PK 로 둔다(파일 경로와 동일 의미).
--   org_id 는 브랜드 하드삭제 시 CASCADE 정리 + 조회용 컬럼(조인은 id 로만 — 이름 중복 사고 방지).
--
-- 쓰기 주체: skillLearn(수동/스케줄) 학습 마감 1회뿐 + 동시 학습은 already_running 가드로
--   차단되므로 blob 통째 UPSERT 라도 lost-update 없음.
--
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS — seeder 매 기동 재적용 안전.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.qa_skill_memory (
    rubric_id   text         PRIMARY KEY,                                              -- 파이프라인 학습/평가 조회 키(= memory.json 파일 단위)
    org_id      integer      REFERENCES public.organizations(id) ON DELETE CASCADE,    -- 브랜드 삭제 시 메모리 자동 정리
    memory      jsonb        NOT NULL DEFAULT '{}'::jsonb,                             -- memory.json 전체({schema_version, rubric_id, items})
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- org 단위 조회/정리용 보조 인덱스(rubric_id ↔ org_id 다대일 가능성 대비).
CREATE INDEX IF NOT EXISTS idx_qa_skill_memory_org
    ON public.qa_skill_memory (org_id);
