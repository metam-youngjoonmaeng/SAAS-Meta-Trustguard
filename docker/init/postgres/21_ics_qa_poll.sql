-- ICS(mtm30) → 09 QA 폴링 워터마크
-- 08(TA)과 동일 패턴: ICS MariaDB 의 tb_stt_master.END_YN='Y'(통화 종료)를 주기 폴링하며
-- proj_cd 별로 "어디까지 적재했는지"(마지막 CALL_END_DATE)를 기억해 중복/누락을 막는다.
-- 콜 자체의 멱등 적재는 qa_calls 의 PK("ID") + ON CONFLICT 가 담당하므로 별도 UID 유니크는 불필요.
CREATE TABLE IF NOT EXISTS ics_qa_poll_watermark (
    proj_cd            text PRIMARY KEY,
    org_id             integer NOT NULL,
    last_call_end_date timestamptz,         -- 마지막으로 적재한 콜의 CALL_END_DATE (다음 폴링의 하한)
    last_uid           text,                -- 마지막 적재 UID (참고/디버깅용)
    processed_count    bigint NOT NULL DEFAULT 0,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ics_qa_poll_watermark IS 'ICS(mtm30) END_YN=Y 폴링 진행상태 — proj_cd별 마지막 적재 CALL_END_DATE 워터마크';
