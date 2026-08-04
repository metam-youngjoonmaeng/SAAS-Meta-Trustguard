-- ============================================================
-- 13_drop_ksqi_kind.sql — KSQI 판정방식(kind) 사본 컬럼 제거 (통합DB 기준)
-- ------------------------------------------------------------
-- 구 docker/init/postgres/78_drop_ksqi_kind.sql 의 통합DB 재작성.
--   public.qa_call_ksqi_score → trustguard.eval_ksqi_score
--   public.ksqi_item_defs     → trustguard.ksqi_item_defs
--
-- 배경 : KSQI 항목의 '판정 방식'(kind)이 DB 두 곳에 사본으로 남아 있다.
--          eval_ksqi_score.kind  — 채점 결과 행
--          ksqi_item_defs.kind   — 테넌트별 항목 정의
--        원본(SSOT)은 채점 파이프라인 v2/nodes/ksqi_stt/rules.py 의 규칙별 kind 다.
--
-- 제거 이유 : 사본이 원본과 어긋난 채 세 벌의 서로 다른 설명이 돌아다녔다.
--          코드 주석      llm / auto        (report.py · KsqiMgmt.jsx)
--          테이블 코멘트   llm / stt / rule  (근거 없는 어휘)
--          스키마 뷰어    "종류(llm 등)"
--          실제 데이터    llm 뿐
--        허용값을 강제하는 장치가 없다(CHECK 제약 없음). 즉 '문서가 유일한 강제 수단'
--        이라 어긋나도 아무도 잡지 못하는 구조였고, 실제로 어긋났다.
--
-- 소비처 검증 (제거 가능 근거):
--   · 상세 화면 components/Detail/KsqiEvalSection.jsx 는 kind 를 읽지 않는다
--     (item_number · item_name · area · score · max_score · na · defect · rationale · evidence 만).
--   · kind 로 분기하는 유일한 화면 views/KsqiMgmt.jsx 의 KindBadge 는
--     GET /api/ksqi-stt/catalog 를 쓴다 → 그 API 가 DB 대신 파이프라인
--     GET /ksqi-stt/catalog (get_catalog() 응답에 kind 포함) 값을 실어 준다.
--     즉 화면 기능은 그대로이고 값의 출처만 사본 → 원본으로 바뀐다.
--
-- 대체 : 판정 방식은 파이프라인이 단독 보유. 대시보드는 저장하지 않고 필요할 때 원본에서 받는다.
--
-- 멱등: DROP COLUMN IF EXISTS — 매 기동 재적용해도 안전.
-- 롤백: 컬럼 재생성은 ALTER TABLE ADD COLUMN kind text DEFAULT 'llm'
--       — 실데이터가 전 행 llm 이므로 값 손실 없음.
--
-- ※ 실행 보류 — 통합DB 는 3개 서비스 공유. 2026-08-04 실측 기준 미반영(양쪽 kind 잔존).
--   본 파일 적용 전에 server/qaPipelineIngest.mjs 의 INSERT, server/index.js 의 상세
--   재조립 SELECT, server/defaultEvalItems.mjs 의 신규 테넌트 복제에서 kind 를 먼저
--   제거해야 한다(컬럼이 사라지면 INSERT 가 깨진다). 순서: 코드 → DDL.
-- ============================================================

-- ① 채점 결과 행의 판정방식 사본.
ALTER TABLE trustguard.eval_ksqi_score
    DROP COLUMN IF EXISTS kind;

-- ② 테넌트별 항목 정의의 판정방식 사본.
ALTER TABLE trustguard.ksqi_item_defs
    DROP COLUMN IF EXISTS kind;

COMMENT ON TABLE trustguard.eval_ksqi_score IS
    'KSQI-STT 항목별 점수(콜 × 항목, 1항목=1행, call_id→common.calls). 근거 발화는 evidence jsonb 인라인. '
    '판정 방식(kind)은 두지 않는다 — 원본은 파이프라인 v2/nodes/ksqi_stt/rules.py.';
