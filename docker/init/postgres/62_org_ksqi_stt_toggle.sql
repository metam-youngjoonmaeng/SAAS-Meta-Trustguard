-- KSQI-STT(신규 17항목, 코오롱 9항목 레거시 v2/nodes/ksqi 와 완전 분리) 브랜드별 실행 토글.
--
-- organizations.ksqi_stt_enabled=true 인 org 의 평가 콜만 파이프라인이 신규 KSQI-STT 모듈을
-- 실행한다(state["ksqi_stt_enabled"]). MTG 는 /evaluate 호출 시 metadata.ksqi_stt_enabled 로
-- 이 값을 그대로 전달(qaPipelineIngest.mjs). 기본 false — 미설정 브랜드는 기존 거동 무회귀.
-- 멱등: 매 기동마다 seeder 가 재적용 → ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS ksqi_stt_enabled boolean NOT NULL DEFAULT false;
