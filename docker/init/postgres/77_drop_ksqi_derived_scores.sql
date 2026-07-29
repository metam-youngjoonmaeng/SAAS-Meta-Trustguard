-- ============================================================
-- 77_drop_ksqi_derived_scores.sql — KSQI 환산·등급·우수 파생컬럼 제거 (2026-07-29)
-- ------------------------------------------------------------
-- 배경 : qa_call_ksqi_summary 는 영역(A/B)별로 raw·max 와 함께
--        scaled·grade·excellent 까지 저장해 왔다. 그런데 이 셋은 전부
--        raw·max 만으로 재현되는 **순수 파생값**이다.
--
--          scaled    = round(raw / max * 100, 1)
--          excellent = scaled >= 임계 (A 92 · B 80)
--          grade     = excellent ? '우수' : '미달'
--
-- 근거 : 제거 전 적재분 39행 전수 검증 — 재현 불일치 0건.
--          area_a_max / area_b_max  = 50 / 70 (39행 전부 동일, 변동 이력 없음)
--          scaled    불일치 A 0건 · B 0건
--          excellent 불일치 A 0건 · B 0건 (임계 92 / 80)
--          grade     값 종류 = '우수' / '미달' 뿐
--        따라서 "채점 당시 기준" 을 보존하기 위해 남겨둘 이유가 없다.
--
-- 대체 : 조회 시 계산한다. server/index.js 의 KSQI 재조립(areaObj)이
--        raw·max 로 scaled/grade/excellent 를 산출해 **기존 응답 계약을 그대로**
--        유지하므로 프론트(components/Detail/KsqiEvalSection.jsx)는 무변경.
--        적재측(server/qaPipelineIngest.mjs)은 6컬럼을 더 이상 INSERT 하지 않는다.
--        엔진 응답(ksqi_stt_report)에는 여전히 3필드가 실려 오지만 저장하지 않고 버린다.
--
-- ★ 임계값(A 92 · B 80)의 원본은 채점 파이프라인
--   v2/nodes/ksqi_stt/rules.py 의 AREA_META[*].excellent_threshold 다.
--   파이프라인에서 임계를 바꾸면 index.js 의 KSQI_EXCELLENT_THRESHOLD 도 함께 고쳐야 한다
--   (저장을 안 하므로 과거 콜의 우수 판정이 소급 변경된다 — 의도된 트레이드오프).
--
-- 멱등: DROP COLUMN IF EXISTS — 시더가 매 기동 재적용해도 안전.
--   65_qa_ksqi_rows.sql 의 CREATE 문에서도 6컬럼을 함께 제거했으므로 신규 DB 는
--   애초에 만들지 않는다(본 파일은 no-op). 기존 DB 는 본 파일이 정리한다.
-- 롤백: 6컬럼을 ALTER TABLE ADD COLUMN 으로 되살린 뒤 raw·max 에서 UPDATE 로 재계산.
--   위 검증대로 손실 없이 복원된다(파생값이므로 원본이 남아 있음).
-- ============================================================

ALTER TABLE public.qa_call_ksqi_summary
    DROP COLUMN IF EXISTS area_a_scaled,
    DROP COLUMN IF EXISTS area_a_grade,
    DROP COLUMN IF EXISTS area_a_excellent,
    DROP COLUMN IF EXISTS area_b_scaled,
    DROP COLUMN IF EXISTS area_b_grade,
    DROP COLUMN IF EXISTS area_b_excellent;

COMMENT ON TABLE public.qa_call_ksqi_summary IS
    'KSQI-STT 콜 집계(콜당 1행). 영역 A/B 및 전체의 raw·max 원점수 + 종합 문장. '
    '환산(scaled)·등급(grade)·우수(excellent)는 raw/max 의 파생값이라 저장하지 않고 '
    '조회 시 계산한다(77). 임계 원본 = 파이프라인 rules.py AREA_META.excellent_threshold.';
