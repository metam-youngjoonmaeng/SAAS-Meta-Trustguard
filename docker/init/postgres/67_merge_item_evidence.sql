-- ============================================================
-- 67_merge_item_evidence.sql — 항목 평가/근거 테이블 병합 (2026-07-27)
-- ------------------------------------------------------------
-- qa_call_item_evidence  →  qa_call_item_score 로 흡수.
--
-- 근거: 두 테이블은 PK 가 ("ID", order_no) 로 동일 grain 이고 category·item 이 중복 저장된다.
--       적재 코드(qaPipelineIngest)도 같은 응답을 루프 두 번 돌려 각각 INSERT 했다.
--       실측(2026-07-27, 로컬 86콜): 공통 1070행 / score 단독 1행(Y/N 항목) / evidence 단독 0행
--                                    category 불일치 0건 · item 불일치 0건.
--
-- ★ 분모 의미 보존이 이 마이그레이션의 핵심
--   구 모델: Y/N 항목은 evidence 행을 '아예 만들지 않아' 총점 분모에서 빠졌다.
--            (qaPipelineIngest.mjs 979행 주석 — 목록 분모 파서가 무조건 최소 5점을 더하는 것을 막으려는 의도)
--   신 모델: 모든 항목이 한 행이므로, 만점을 max_score NULL 로 두어 '분모 제외'를 표현한다.
--            → NULL 은 SUM 에서 자동 제외되고, JS 쪽은 maxPointsOf() 가 null 을 반환해 건너뛴다.
--   따라서 evidence 행이 있던 항목만 max_score 를 채우고, 없던 항목은 NULL 로 남긴다.
--
-- 성능: '배점 N' 텍스트를 매 조회마다 regexp_replace 로 파싱하던 것을 numeric 컬럼으로 대체.
--       콜 목록(GET /api/calls)의 총점 분모가 행마다 정규식 → 단순 SUM(max_score) 으로 바뀐다.
--
-- 멱등: 컬럼 추가는 IF NOT EXISTS, 백필은 원본 테이블이 남아 있을 때만, DROP 은 IF EXISTS.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- ① 흡수 컬럼 추가
ALTER TABLE public.qa_call_item_score
    ADD COLUMN IF NOT EXISTS agent_utterance text,
    ADD COLUMN IF NOT EXISTS max_score       numeric;

COMMENT ON COLUMN public.qa_call_item_score.agent_utterance IS
    '근거 상담사 발화(구 qa_checklist_rows.agent_utterance). 응답 evidence[].quote 개행 결합.';
COMMENT ON COLUMN public.qa_call_item_score.max_score IS
    '항목 만점(구 validation_time ''배점 N'' 의 숫자화). NULL = 총점 분모 제외(구 모델의 체크리스트 행 부재와 동일 의미).';

-- ② 백필 — 구 파서 parseMaxPointsFromValidationTime() 규칙을 그대로 재현
--    ('배점' 으로 시작하지 않거나 파싱 실패/0 이하 → 5 폴백)
DO $$
BEGIN
    IF to_regclass('public.qa_call_item_evidence') IS NOT NULL THEN
        UPDATE public.qa_call_item_score e
           SET agent_utterance = c.agent_utterance,
               max_score = CASE
                   WHEN c.validation_time LIKE '배점%'
                       THEN COALESCE(
                                NULLIF(NULLIF(regexp_replace(c.validation_time, '[^0-9.]', '', 'g'), '')::numeric, 0),
                                5)
                   ELSE 5
               END
          FROM public.qa_call_item_evidence c
         WHERE c."ID" = e."ID" AND c.order_no = e.order_no
           AND e.max_score IS NULL;          -- 재실행 시 이미 채운 행은 건드리지 않음
    END IF;
END $$;

-- ③ 원본 제거
DROP TABLE IF EXISTS public.qa_call_item_evidence CASCADE;

-- ④ 근거 발화 보유 항목 조회 가속 (상세 화면 체크리스트 = max_score IS NOT NULL 필터)
CREATE INDEX IF NOT EXISTS idx_qa_call_item_score_scored
    ON public.qa_call_item_score ("ID") WHERE max_score IS NOT NULL;

COMMIT;
