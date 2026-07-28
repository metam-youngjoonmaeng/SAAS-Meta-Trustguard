-- ============================================================
-- 75_drop_gemini_confidence.sql — Gemini 신뢰도 판정 경로 제거 (2026-07-28)
-- ------------------------------------------------------------
-- 배경 : ② 'AI 신뢰도 검증' 은 평가 엔진의 confidence 를 쓰지 않고, MTG 서버가
--        Gemini REST(generativelanguage.googleapis.com)를 **직접** 호출해 항목별
--        { uncertain / contradiction } 을 재판정하는 2차 레이어였다.
--
-- 제거 이유 (아키텍처 위반):
--   · 평가 본선은 resolvePipelineBaseUrl() 로 라우팅된다
--     — pipeline_target='ec2' → 54.235.200.151:8081 · QA_PIPELINE_FORCE_LOCAL=1 → 로컬 :8081.
--   · 그런데 geminiJudge.mjs 는 이 함수를 import 조차 하지 않고 외부로 직행했다.
--     → 로컬/dev/운영 어디서 돌려도 구글로 나가며, 평가 백엔드와 무관하게 동작.
--   · BATCH_JUDGE_PROVIDER 는 docker-compose.yml 에만 선언돼 있고 코드에서 읽는 곳이 0건
--     — provider 추상화가 껍데기였고 구현체는 geminiJudge.mjs 하나뿐이었다.
--   · 실사용 0 — GEMINI_API_KEY 미설정(로컬·운영 모두)이라 judgeEnabled()=false,
--     qa_confidence_prompt 0행 · qa_call_annotation.judgments 0행. 구 테이블까지 거슬러도 0행.
--
-- 대체 : 평가 백엔드가 응답에 실어 보내는 항목별 신뢰도를
--        qa_call_item_score.ai_confidence (마이그레이션 74) 에 적재해 사용한다.
--        평가와 같은 백엔드/같은 요청이라 라우팅 정합이 자동으로 맞는다.
--
-- ★ qa_call_annotation 은 테이블을 남긴다 — comments/comments_at(관리자 코멘트)는
--   콜 상세 로드 경로(index.js:1968)에서 조회되는 **살아있는 기능**이다. 테이블을 지우면
--   콜 상세가 500(Failed to load evaluations)으로 안 열린다. 판정 컬럼만 떼어낸다.
--
-- 멱등: DROP ... IF EXISTS — 시더가 매 기동 재적용해도 안전.
--   (70 이 qa_call_annotation·qa_confidence_prompt 를 재생성하지만 순수 DDL 이라
--    INSERT 가 없고, 번호가 앞이라 본 파일이 매 부팅 뒤에 정리한다 — 기존 §8-1 왕복 패턴과 동일.)
-- 롤백: logs/dbbackup/ 백업 + 70_absorb_satellite_tables.sql 재실행으로 스키마 복원 가능
--       (데이터는 원래 0행이라 손실 없음).
-- ============================================================

-- ① Gemini 판정 프롬프트 저장소 — 전량 미사용(0행). 관리 화면·API 도 함께 제거됨.
DROP TABLE IF EXISTS public.qa_confidence_prompt;

-- ② 판정 결과 컬럼 — Gemini 산출물 전용. comments/comments_at 는 보존.
DROP INDEX IF EXISTS public.idx_qa_call_annotation_flags;

ALTER TABLE public.qa_call_annotation
    DROP COLUMN IF EXISTS judgments,
    DROP COLUMN IF EXISTS has_uncertain,
    DROP COLUMN IF EXISTS has_weak,
    DROP COLUMN IF EXISTS has_contradiction,
    DROP COLUMN IF EXISTS prompt_version,
    DROP COLUMN IF EXISTS model,
    DROP COLUMN IF EXISTS judged_at;

COMMENT ON TABLE public.qa_call_annotation IS
    '콜 부가정보(콜당 1행). comments=관리자 코멘트(사람). 구 qa_admin_comments. '
    'AI 신뢰도 판정 컬럼은 75 에서 제거 — 신뢰도는 qa_call_item_score.ai_confidence 사용.';
