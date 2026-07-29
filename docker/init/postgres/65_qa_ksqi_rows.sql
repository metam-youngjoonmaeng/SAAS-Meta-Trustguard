-- KSQI-STT 평가 결과 정규화 (3테이블 신설 + 기존 jsonb 백필).
--
-- 기존에는 파이프라인 응답(ksqi_stt_report)을 qa_calls.ksqi_report(로컬 임시 jsonb)에 통짜 저장했다.
-- 이 파일은 일반 평가 결과와 동형 구조로 분리한다(★ 2026-07-27 마이그레이션 72 이후 2층):
--   qa_call_ksqi_score   ↔ qa_call_item_score (항목별 점수·판정 사유 + 근거 evidence jsonb)
--   qa_call_ksqi_summary ↔ qa_calls 콜 집계   (영역 A/B·전체 집계 + 종합 문장)
-- 구 qa_call_ksqi_evidence(항목당 0~N행)는 일반 평가에서 qa_call_item_evidence 를
-- qa_call_item_score 로 흡수한 것과 같은 이유로 score 행에 인라인됐다(동형성 유지).
-- 항목 정의는 63_ksqi_item_defs.sql(ksqi_item_defs)이 담당하며, item_number 가
-- ksqi_item_defs(org_id, number)와 대응한다. item_name/area 등은 평가 시점 스냅샷으로 보관.
-- 멱등: 매 기동 재적용 → CREATE IF NOT EXISTS / 백필 ON CONFLICT DO NOTHING.
-- 백필은 qa_calls.ksqi_report 컬럼이 있는 DB(로컬)에서만 동작하고, 컬럼이 없는 DB(운영)에서는
-- 테이블 생성만 수행한다(DO 블록 가드로 컬럼 부재 시 파싱조차 되지 않아 무회귀).

-- kind(판정 방식) 컬럼은 두지 않는다 — 원본은 파이프라인 rules.py 이고 여기 컬럼은 사본이었다
-- (전 행 'llm'). 상세 화면도 이 필드를 쓰지 않았다. 기존 DB 는 마이그레이션 78 이 정리한다.
CREATE TABLE IF NOT EXISTS public.qa_call_ksqi_score (
    "ID"        text    NOT NULL REFERENCES public.qa_calls("ID") ON DELETE CASCADE,
    item_number integer NOT NULL,
    item_name   text    NOT NULL DEFAULT '',
    area        text    NOT NULL DEFAULT '',
    score       double precision,
    max_score   double precision,
    na          boolean NOT NULL DEFAULT false,
    defect      boolean NOT NULL DEFAULT false,
    rationale   text    NOT NULL DEFAULT '',
    PRIMARY KEY ("ID", item_number)
);

-- 근거 발화는 별도 테이블이 아니라 항목 행에 인라인 보관한다(마이그레이션 72 에서 병합).
-- 항목당 0~5건·평균 33자뿐이고 항목과 떨어져 조회되는 경로가 없어 행 분리 이득이 없었다.
ALTER TABLE public.qa_call_ksqi_score
    ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 환산(scaled)·등급(grade)·우수(excellent)는 컬럼으로 두지 않는다 — raw/max 의 순수 파생값이라
-- 조회 시 계산한다(마이그레이션 77, 2026-07-29 합의). 기존 DB 의 6컬럼은 77 이 정리한다.
CREATE TABLE IF NOT EXISTS public.qa_call_ksqi_summary (
    "ID"             text PRIMARY KEY REFERENCES public.qa_calls("ID") ON DELETE CASCADE,
    area_a_raw       double precision,
    area_a_max       double precision,
    area_b_raw       double precision,
    area_b_max       double precision,
    overall_raw      double precision,
    overall_max      double precision,
    summary          text NOT NULL DEFAULT ''
);

-- 백필 — 기존 qa_calls.ksqi_report(jsonb) 를 3테이블로 1회 이관. 이미 이관된 콜은 건드리지 않음.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_calls' AND column_name = 'ksqi_report'
    ) THEN
        -- scaled/grade/excellent 는 백필하지 않는다 — 컬럼 자체가 없다(위 CREATE + 77 참조).
        INSERT INTO public.qa_call_ksqi_summary (
            "ID",
            area_a_raw, area_a_max,
            area_b_raw, area_b_max,
            overall_raw, overall_max, summary
        )
        SELECT c."ID",
               (c.ksqi_report->'area_a'->>'raw')::float8,
               (c.ksqi_report->'area_a'->>'max')::float8,
               (c.ksqi_report->'area_b'->>'raw')::float8,
               (c.ksqi_report->'area_b'->>'max')::float8,
               (c.ksqi_report->'overall'->>'raw')::float8,
               (c.ksqi_report->'overall'->>'max')::float8,
               COALESCE(c.ksqi_report->>'summary', '')
          FROM public.qa_calls c
         WHERE c.ksqi_report IS NOT NULL
            ON CONFLICT ("ID") DO NOTHING;

        -- 근거(evidence)는 항목 행에 인라인 — 원본 배열 순서를 그대로 보존해 담는다.
        INSERT INTO public.qa_call_ksqi_score (
            "ID", item_number, item_name, area, score, max_score, na, defect, rationale, evidence
        )
        SELECT c."ID",
               (it->>'item_number')::int,
               COALESCE(it->>'item_name', ''),
               COALESCE(it->>'area', ''),
               (it->>'score')::float8,
               (it->>'max_score')::float8,
               COALESCE((it->>'na')::boolean, false),
               COALESCE((it->>'defect')::boolean, false),
               COALESCE(it->>'rationale', ''),
               COALESCE(
                   (SELECT jsonb_agg(jsonb_build_object(
                               'speaker', COALESCE(ev.e->>'speaker', ''),
                               'quote',   COALESCE(ev.e->>'quote', ''))
                           ORDER BY ev.ord)
                      FROM jsonb_array_elements(COALESCE(it->'evidence', '[]'::jsonb))
                           WITH ORDINALITY AS ev(e, ord)),
                   '[]'::jsonb)
          FROM public.qa_calls c
         CROSS JOIN LATERAL jsonb_array_elements(c.ksqi_report->'items') AS it
         WHERE c.ksqi_report IS NOT NULL
           AND (it->>'item_number') IS NOT NULL
            ON CONFLICT ("ID", item_number) DO NOTHING;
    END IF;
END $$;
