-- data/seed/load.sql
-- QA Dashboard baseline 시드 적재 (고객사 PoC).
-- psql 에서 \i data/seed/load.sql 로 실행.
-- 또는 docker exec -i qa-ai-postgres psql -U qa -d qa_dashboard < data/seed/load.sql

BEGIN;

-- 자식 테이블 → 부모 순으로 비움 (재실행 안전성)
TRUNCATE TABLE qa_consumer_ai_categories,
               qa_consumer_keywords,
               qa_consumer_eval_rows,
               qa_analysis_report,
               qa_evaluation_rows,
               qa_checklist_rows,
               qa_conversations,
               qa_calls
RESTART IDENTITY CASCADE;

-- qa_calls.csv 는 org_id 미포함(baseline)을 가정. \COPY 컬럼 리스트로 명시 후 default org=신한카드(id=1)로 backfill.
\COPY qa_calls ("ID", "CALL_SEQ", "CDATE", "UID", "AI_SCORE", "TOTAL_SCORE", department, role, ai_analysis_target, ai_analysis_reason, voc_code, promotion_code) FROM 'data/seed/qa_calls.csv' WITH (FORMAT CSV, HEADER, NULL '');
UPDATE qa_calls SET org_id = 1 WHERE org_id IS NULL;
\COPY qa_conversations FROM 'data/seed/qa_conversations.csv' WITH (FORMAT CSV, HEADER, NULL '');
\COPY qa_checklist_rows FROM 'data/seed/qa_checklist_rows.csv' WITH (FORMAT CSV, HEADER, NULL '');
\COPY qa_evaluation_rows FROM 'data/seed/qa_evaluation_rows.csv' WITH (FORMAT CSV, HEADER, NULL '');
\COPY qa_analysis_report FROM 'data/seed/qa_analysis_report.csv' WITH (FORMAT CSV, HEADER, NULL '');
-- 컬럼 명시 적재 — generator 가 evidence_line_no / evidence_text 까지 함께 내보냄.
\COPY qa_consumer_eval_rows ("ID", item_no, major_category, sub_no, criterion, item_text, yn, detail_text, evidence_line_no, evidence_text) FROM 'data/seed/qa_consumer_eval_rows.csv' WITH (FORMAT CSV, HEADER, NULL '');
-- keyword_id 는 시퀀스 자동 채움 — 컬럼 명시 적재
\COPY qa_consumer_keywords ("ID", level, major_category, sub_category, keyword, line_no, line_text) FROM 'data/seed/qa_consumer_keywords.csv' WITH (FORMAT CSV, HEADER, NULL '');
\COPY qa_consumer_ai_categories FROM 'data/seed/qa_consumer_ai_categories.csv' WITH (FORMAT CSV, HEADER, NULL '');

COMMIT;
