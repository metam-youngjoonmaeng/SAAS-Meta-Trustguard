-- ============================================================
-- 66_drop_dead_call_tables.sql — 죽은 콜 관련 테이블 제거 (2026-07-27)
-- ------------------------------------------------------------
-- 스코프: 콜(qa_calls) 관련 자식 테이블만. 계정·조직 코어(users / trainee_registrations /
--         admin_users / auth_sessions / organizations / domains / qa_calls)는 건드리지 않는다.
--
-- ① *__sandbox_snapshot 9종
--    스냅샷→복원 샌드박스 모델이 폐기됨(server/sandboxSession.mjs 상단 주석).
--    현재는 qa_calls.is_sandbox 컬럼으로 운영/샌드박스를 구분하고, 로그아웃 시
--    is_sandbox=true 행만 DELETE 한다. 앱 코드에 'sandbox_snapshot' 참조 0건(읽기·쓰기 전무).
--    폐기 이전 시점의 유령 데이터가 250행 잔존 중이라 실제 용량도 회수된다.
--
-- ② qa_consumer_* 3종
--    신한카드 PoC 시절 '소비자보호부' 전용 평가 트랙(20항목 Y/N + 금칙어 + 12카테고리).
--    브랜드별 동적 루브릭(eval_item_defs + rubric_inline)으로 세대교체되어 분기 자체가
--    호출되지 않는다. 앱에 INSERT 경로 없음(SELECT/UPDATE 만), 3테이블 모두 0행.
--
-- 멱등: DROP TABLE IF EXISTS — 재실행/미존재 안전.
-- 선행 정리: 02_brands_domains.sql 의 qa_calls__sandbox_snapshot ALTER/UPDATE 구문 제거 완료.
--            14_unify_user_columns.sql 의 참조는 information_schema 존재검사 가드 안이라 무영향.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

BEGIN;

-- ① 폐기된 샌드박스 스냅샷 미러 9종
DROP TABLE IF EXISTS public.qa_calls__sandbox_snapshot                 CASCADE;
DROP TABLE IF EXISTS public.qa_conversations__sandbox_snapshot         CASCADE;
DROP TABLE IF EXISTS public.qa_evaluation_rows__sandbox_snapshot       CASCADE;
DROP TABLE IF EXISTS public.qa_checklist_rows__sandbox_snapshot        CASCADE;
DROP TABLE IF EXISTS public.qa_analysis_report__sandbox_snapshot       CASCADE;
DROP TABLE IF EXISTS public.qa_audit_logs__sandbox_snapshot            CASCADE;
DROP TABLE IF EXISTS public.qa_consumer_ai_categories__sandbox_snapshot CASCADE;
DROP TABLE IF EXISTS public.qa_consumer_eval_rows__sandbox_snapshot    CASCADE;
DROP TABLE IF EXISTS public.qa_consumer_keywords__sandbox_snapshot     CASCADE;

-- ② 세대교체된 소비자보호부 트랙 3종
DROP TABLE IF EXISTS public.qa_consumer_ai_categories CASCADE;
DROP TABLE IF EXISTS public.qa_consumer_eval_rows     CASCADE;
DROP TABLE IF EXISTS public.qa_consumer_keywords      CASCADE;

-- ③ 복합 UNIQUE 의 선행 컬럼이라 대체되는 중복 인덱스
--    (계정 코어인 users/trainee_registrations 의 중복 인덱스는 스코프 제외 — 손대지 않음)
DROP INDEX IF EXISTS public.idx_domain_default_eval_items_domain;
DROP INDEX IF EXISTS public.idx_domain_default_pentagon_axes_domain;

COMMIT;
