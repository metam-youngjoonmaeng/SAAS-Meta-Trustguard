-- ============================================================
-- 78_drop_ksqi_kind.sql — KSQI 판정방식(kind) 사본 컬럼 제거 (2026-07-29)
-- ------------------------------------------------------------
-- 배경 : KSQI 항목의 '판정 방식'(kind)이 MTG DB 두 곳에 사본으로 남아 있었다.
--          qa_call_ksqi_score.kind   — 채점 결과 행
--          ksqi_item_defs.kind       — 브랜드별 항목 정의
--        원본(SSOT)은 채점 파이프라인 v2/nodes/ksqi_stt/rules.py 의 규칙별 kind 다.
--
-- 제거 이유 : 사본이 원본과 어긋난 채 세 벌의 서로 다른 설명이 돌아다녔다.
--          코드 주석      llm / auto        (report.py · KsqiMgmt.jsx)
--          이 파일의 코멘트 llm / stt / rule  (68_table_comments.sql — 근거 없는 어휘)
--          스키마 뷰어    "종류(llm 등)"
--          실제 데이터    llm 뿐            (score 468행 · item_defs 108행, 예외 0건)
--        허용값을 강제하는 장치는 어디에도 없었다(CHECK 제약 없음). 즉 '문서가 유일한
--        강제 수단' 이라 어긋나도 아무도 잡지 못하는 구조였고, 실제로 어긋났다.
--
-- 소비처 검증 (제거 가능 근거):
--   · 상세 화면 components/Detail/KsqiEvalSection.jsx 는 kind 를 읽지 않는다
--     (item_number · item_name · area · score · max_score · na · defect · rationale · evidence 만).
--   · kind 로 분기하는 유일한 화면 views/KsqiMgmt.jsx 의 KindBadge 는
--     GET /api/ksqi-stt/catalog 를 쓴다 → 그 API 가 이제 DB 대신 파이프라인
--     GET /ksqi-stt/catalog (get_catalog() 응답에 kind 포함) 값을 실어 준다.
--     즉 화면 기능은 그대로이고 값의 출처만 사본 → 원본으로 바뀐다.
--
-- 대체 : 판정 방식은 파이프라인이 단독 보유. MTG 는 저장하지 않고 필요할 때 원본에서 받는다.
--   적재 server/qaPipelineIngest.mjs  — INSERT 에서 kind 제거 (score)
--   조회 server/index.js              — 상세 재조립 SELECT/매핑에서 kind 제거
--   카탈로그 server/index.js          — kind 를 파이프라인 병합값(p.kind)에서 취함
--   시더 server/defaultEvalItems.mjs  — 신규 브랜드 복제에서 kind 제거
--   DDL  63_ksqi_item_defs.sql · 65_qa_ksqi_rows.sql — CREATE·백필에서 컬럼 제거
--
-- 멱등: DROP COLUMN IF EXISTS — 시더가 매 기동 재적용해도 안전.
--   63·65 의 CREATE 에서도 제거했으므로 신규 DB 는 애초에 만들지 않는다(본 파일 no-op).
--   기존 DB 는 본 파일이 정리한다. 63·65 는 번호가 앞이라 매 부팅 뒤 본 파일이 수렴시킨다.
-- 롤백: logs/dbbackup/qa_call_ksqi_score_before_78.sql ·
--       logs/dbbackup/ksqi_item_defs_before_78.sql (제거 전 전량 백업, 각 468 / 108행).
--       컬럼 재생성은 ALTER TABLE ADD COLUMN ... DEFAULT 'llm' — 전 행이 llm 이므로 값 손실 없음.
-- ============================================================

-- ① 채점 결과 행의 판정방식 사본.
ALTER TABLE public.qa_call_ksqi_score
    DROP COLUMN IF EXISTS kind;

-- ② 브랜드별 항목 정의의 판정방식 사본.
ALTER TABLE public.ksqi_item_defs
    DROP COLUMN IF EXISTS kind;

COMMENT ON TABLE public.qa_call_ksqi_score IS
    'KSQI-STT 항목별 점수(콜 × 항목, 1항목=1행). 근거 발화는 evidence jsonb 로 인라인(72). '
    '판정 방식(kind)은 두지 않는다 — 원본은 파이프라인 v2/nodes/ksqi_stt/rules.py (78).';
