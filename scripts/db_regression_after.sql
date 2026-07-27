-- [AFTER] 개명 후 판 — 라벨은 구 이름 유지(전후 diff 비교용)
-- MTG DB 회귀 검증 — 최적화(삭제/병합/개명) 전후 동일 결과 보장용.
-- index.js 의 실제 읽기 경로를 그대로 재현한다. 스키마가 바뀌어도 이 쿼리들의
-- 출력이 동일해야 회귀 없음.
--   실행: docker exec -i <pg> psql -U qa -d qa_dashboard -f - < scripts/db_regression.sql
-- 개명 후에는 scripts/db_regression_after.sql (신규 테이블명 판) 을 사용한다.

\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on

-- ① 콜 목록 집계 (GET /api/calls) — 총점 분모는 checklist.validation_time('배점 N') 파싱
SELECT 'R1_calls_agg', c."ID", c."AI_SCORE", c."TOTAL_SCORE", c.review_status,
       (SELECT COALESCE(SUM(ch.max_score), 0)
        FROM qa_call_item_score ch WHERE ch."ID" = c."ID") AS max_total
FROM qa_calls c
ORDER BY c."ID";

-- ② 항목별 평가 결과 (GET /api/evaluations/:id)
SELECT 'R2_eval_rows', "ID", order_no, category, item, reason_text, ai_eval, manual_eval,
       manual_eval_option, counselor_eval
FROM qa_call_item_score
ORDER BY "ID", order_no;

-- ③ 체크리스트 근거 (GET /api/evaluations/:id 우측)
SELECT 'R3_checklist', "ID", order_no, category, item, agent_utterance,
       '배점 ' || CASE WHEN max_score = trunc(max_score) THEN trunc(max_score)::int::text ELSE max_score::text END
FROM qa_call_item_score WHERE max_score IS NOT NULL
ORDER BY "ID", order_no;

-- ④ 펜타곤 축별 분석 (GET /api/analysis/:id)
SELECT 'R4_axis', "ID", item_type_no, item_type, rating, comment, summary
FROM qa_call_axis_result
ORDER BY "ID", item_type_no;

-- ⑤ 전사
SELECT 'R5_transcript', "ID", turn_no, speaker, "text"
FROM qa_call_transcript
ORDER BY "ID", turn_no;

-- ⑥ KSQI 3종
SELECT 'R6_ksqi_rows', "ID", item_number, item_name, area, kind, score, max_score, na, defect, rationale
FROM qa_call_ksqi_score ORDER BY "ID", item_number;
SELECT 'R7_ksqi_evidence', "ID", item_number, seq, speaker, quote
FROM qa_call_ksqi_evidence ORDER BY "ID", item_number, seq;
SELECT 'R8_ksqi_summary', "ID", area_a_raw, area_a_max, area_a_scaled, area_a_grade,
       area_b_raw, area_b_max, area_b_scaled, area_b_grade, overall_raw, overall_max
FROM qa_call_ksqi_summary ORDER BY "ID";

-- ⑦ 설정/마스터 (브랜드·평가항목·축)
SELECT 'R9_org', id, name, short, active, domain_id, proj_cd, rag_rubric_id, ksqi_stt_enabled
FROM organizations ORDER BY id;
SELECT 'R10_item_defs', id, org_id, order_no, category, item, department, version,
       pentagon_axis, scoring_type, max_score, is_active
FROM eval_item_defs ORDER BY id;
SELECT 'R11_axes', id, org_id, department, axis_no, label, is_active, version
FROM pentagon_axes ORDER BY id;
SELECT 'R12_golden', golden_id, qa_id, order_no, org_id, category, item, score
FROM qa_golden_set ORDER BY golden_id;

-- ⑧ 계정/상담사
SELECT 'R13_users', id, email, name, username FROM users ORDER BY id;
SELECT 'R14_trainee', id, user_id, org_id, name, department, role, status
FROM trainee_registrations ORDER BY id;
SELECT 'R15_adminview', user_id, login_id, display_name, role, org_id, department, is_active
FROM admin_users ORDER BY user_id;

-- ⑨ 행 수 총괄 (구조 변경으로 데이터가 새거나 늘지 않았는지)
SELECT 'R16_counts', 'qa_calls', COUNT(*) FROM qa_calls
UNION ALL SELECT 'R16_counts','qa_call_transcript', COUNT(*) FROM qa_call_transcript
UNION ALL SELECT 'R16_counts','qa_call_item_score', COUNT(*) FROM qa_call_item_score
UNION ALL SELECT 'R16_counts','qa_checklist_rows', COUNT(*) FROM qa_call_item_score WHERE max_score IS NOT NULL
UNION ALL SELECT 'R16_counts','qa_call_axis_result', COUNT(*) FROM qa_call_axis_result
UNION ALL SELECT 'R16_counts','qa_call_ksqi_score', COUNT(*) FROM qa_call_ksqi_score
UNION ALL SELECT 'R16_counts','qa_call_ksqi_evidence', COUNT(*) FROM qa_call_ksqi_evidence
UNION ALL SELECT 'R16_counts','qa_call_ksqi_summary', COUNT(*) FROM qa_call_ksqi_summary
UNION ALL SELECT 'R16_counts','qa_golden_set', COUNT(*) FROM qa_golden_set
UNION ALL SELECT 'R16_counts','eval_item_defs', COUNT(*) FROM eval_item_defs
UNION ALL SELECT 'R16_counts','pentagon_axes', COUNT(*) FROM pentagon_axes
UNION ALL SELECT 'R16_counts','organizations', COUNT(*) FROM organizations
UNION ALL SELECT 'R16_counts','users', COUNT(*) FROM users
ORDER BY 2;
