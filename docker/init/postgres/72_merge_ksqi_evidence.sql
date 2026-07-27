-- ============================================================
-- 72_merge_ksqi_evidence.sql — KSQI 근거 발화를 항목 행으로 흡수 (2026-07-27)
-- ------------------------------------------------------------
-- qa_call_ksqi_evidence → qa_call_ksqi_score.evidence (jsonb)
--
-- ★ 병합 근거
--  1) 원래 3층이었던 이유가 사라졌다.
--     65_qa_ksqi_rows.sql 원주석: "일반 평가 결과와 완전 동형의 3층 구조로 분리한다
--       qa_call_ksqi_evidence ↔ qa_call_item_evidence".
--     그런데 67 에서 qa_call_item_evidence 를 qa_call_item_score 로 흡수해 일반 평가는 2층이 됐다.
--     즉 KSQI 만 사라진 구조를 따라하고 있었다 → 흡수해야 동형성이 복원된다.
--  2) 항목과 떨어져 조회되는 경로가 없다. 유일한 읽기부(index.js::loadKsqiReport)는
--     3테이블을 각각 SELECT 한 뒤 evByItem Map 으로 다시 항목에 붙여 중첩 객체로 되돌린다.
--     = 쓸 때 쪼개고 읽을 때 도로 합치는 순수 왕복 비용이었다. 조회 3회 → 2회.
--  3) 양이 작다. 항목당 0~5건(0건 144 / 1건 194 / 2건 27 / 3건 28 / 4건 2 / 5건 1),
--     인용문 평균 33자·최대 124자. 행으로 쪼갤 규모가 아니다.
--  4) 적재부(qaPipelineIngest.mjs)가 항목 루프 안에서 근거를 1건씩 INSERT 하는 N+1 이었다.
--     인라인 후 항목당 1 INSERT 로 끝난다.
--
-- ※ qa_call_ksqi_summary 는 병합하지 않는다 — /api/calls 목록이 has_ksqi·area_a/b_scaled·
--   overall 을 JOIN 해 필터·정렬하므로 스칼라 컬럼으로 남아야 한다(jsonb 로 묻으면 목록 필터가 깨진다).
-- ※ qa_call_ksqi_score 를 summary 의 jsonb 로 말아넣지도 않는다 — 항목별 결함률 같은
--   콜 횡단 집계가 QA 대시보드의 자연스러운 다음 지표인데, jsonb 로 묻으면 그 길이 막힌다.
--
-- 멱등: 컬럼 추가 IF NOT EXISTS, 이관은 원본 테이블 존재 시에만, DROP 은 IF EXISTS.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- 65 가 이미 보장하지만, 65 미적용 DB 에서도 단독 적용 가능하도록 재보장
ALTER TABLE public.qa_call_ksqi_score
    ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 구 테이블 → jsonb 배열 (seq 순서 보존)
DO $$
BEGIN
    IF to_regclass('public.qa_call_ksqi_evidence') IS NOT NULL THEN
        UPDATE public.qa_call_ksqi_score s
           SET evidence = agg.arr
          FROM (
              SELECT "ID", item_number,
                     jsonb_agg(jsonb_build_object('speaker', speaker, 'quote', quote)
                               ORDER BY seq) AS arr
                FROM public.qa_call_ksqi_evidence
               GROUP BY "ID", item_number
          ) agg
         WHERE agg."ID" = s."ID"
           AND agg.item_number = s.item_number
           AND s.evidence = '[]'::jsonb;   -- 이미 이관된 행은 건드리지 않음
    END IF;
END $$;

DROP TABLE IF EXISTS public.qa_call_ksqi_evidence CASCADE;

COMMENT ON COLUMN public.qa_call_ksqi_score.evidence IS
    '근거 발화 배열 [{speaker, quote}, ...] — 원본 순서 보존. 구 qa_call_ksqi_evidence 테이블 흡수.';

COMMIT;
