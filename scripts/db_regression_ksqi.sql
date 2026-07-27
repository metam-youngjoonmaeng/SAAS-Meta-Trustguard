-- KSQI/펜타곤 병합·개명 회귀 검증 — 변경 전후 출력이 완전히 같아야 한다.
-- 테이블명·컬럼 구조가 바뀌어도 '애플리케이션이 재조립하는 결과'는 불변임을 증명한다.
\pset footer off
\pset format unaligned
\pset fieldsep '|'

-- K1) KSQI 항목 점수 (콜×항목) — 근거를 문자열로 접어 저장 형태와 무관하게 비교
SELECT 'K1' tag, s."ID", s.item_number, s.item_name, s.area, s.kind,
       s.score, s.max_score, s.na, s.defect, s.rationale,
       COALESCE((SELECT string_agg(e.speaker || '␟' || e.quote, '␞' ORDER BY e.seq)
                   FROM public.qa_call_ksqi_evidence e
                  WHERE e."ID" = s."ID" AND e.item_number = s.item_number), '') AS evidence_flat
  FROM public.qa_call_ksqi_score s
 ORDER BY s."ID", s.item_number;

-- K2) KSQI 콜 집계
SELECT 'K2' tag, * FROM public.qa_call_ksqi_summary ORDER BY "ID";

-- K3) 근거 총량 (유실 없음 확인)
SELECT 'K3' tag, count(*) AS evidence_rows, sum(length(quote)) AS quote_chars
  FROM public.qa_call_ksqi_evidence;

-- P1) 펜타곤 축별 결과
SELECT 'P1' tag, * FROM public.qa_call_axis_result ORDER BY "ID", item_type_no;

-- P2) 행수
SELECT 'P2' tag, 'ksqi_score' t, count(*) FROM public.qa_call_ksqi_score
UNION ALL SELECT 'P2', 'ksqi_summary', count(*) FROM public.qa_call_ksqi_summary
UNION ALL SELECT 'P2', 'axis_result',  count(*) FROM public.qa_call_axis_result
ORDER BY 2;
