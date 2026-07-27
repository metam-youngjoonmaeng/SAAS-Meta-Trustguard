-- 변경 후 회귀 — db_regression_ksqi.sql 과 완전히 같은 출력이 나와야 한다.
-- (근거는 jsonb 인라인, 펜타곤 테이블은 개명됐지만 '내용'은 불변임을 증명)
\pset footer off
\pset format unaligned
\pset fieldsep '|'

-- K1) KSQI 항목 점수 — evidence jsonb 를 구 테이블과 같은 문자열로 펼쳐 비교
SELECT 'K1' tag, s."ID", s.item_number, s.item_name, s.area, s.kind,
       s.score, s.max_score, s.na, s.defect, s.rationale,
       COALESCE((SELECT string_agg((e->>'speaker') || '␟' || (e->>'quote'), '␞' ORDER BY ord)
                   FROM jsonb_array_elements(s.evidence) WITH ORDINALITY AS x(e, ord)), '') AS evidence_flat
  FROM public.qa_call_ksqi_score s
 ORDER BY s."ID", s.item_number;

-- K2) KSQI 콜 집계
SELECT 'K2' tag, * FROM public.qa_call_ksqi_summary ORDER BY "ID";

-- K3) 근거 총량 (유실 없음 확인)
SELECT 'K3' tag, count(*) AS evidence_rows, sum(length(e->>'quote')) AS quote_chars
  FROM public.qa_call_ksqi_score s, jsonb_array_elements(s.evidence) AS e;

-- P1) 펜타곤 축별 결과 (개명 후 테이블)
SELECT 'P1' tag, * FROM public.qa_call_pentagon_result ORDER BY "ID", item_type_no;

-- P2) 행수
SELECT 'P2' tag, 'ksqi_score' t, count(*) FROM public.qa_call_ksqi_score
UNION ALL SELECT 'P2', 'ksqi_summary', count(*) FROM public.qa_call_ksqi_summary
UNION ALL SELECT 'P2', 'axis_result',  count(*) FROM public.qa_call_pentagon_result
ORDER BY 2;
