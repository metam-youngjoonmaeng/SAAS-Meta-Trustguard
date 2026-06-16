-- organizations.proj_cd — ICS PROJ_CD ↔ 09 org 매핑 (08-Meta_Summary Organization.proj_cd 와 동형)
-- 목적: 09/08/05 단일 DB 병합 대비 스키마 정렬 + ICS QA 폴러의 PROJ_CD→org_id 매핑을 DB 기준으로.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS proj_cd text;

COMMENT ON COLUMN organizations.proj_cd IS 'ICS(mtm30) PROJ_CD 외부 별칭 — 콜 적재/연동 시 org 매핑 키 (08 Organization.proj_cd 와 동일 규약)';

-- METAM 브랜드 매핑 시드 (이미 채워져 있으면 유지). 이름 기준이라 id 변동에 안전.
UPDATE organizations SET proj_cd = 'METAM'
 WHERE name = 'METAM' AND (proj_cd IS NULL OR proj_cd = '');

-- proj_cd 는 채워진 경우 전역 유일 (NULL 다수 허용).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_proj_cd_uk
    ON organizations (proj_cd) WHERE proj_cd IS NOT NULL;

-- qa_calls 에도 proj_cd 보관(08 결과행 proj_cd 와 동형) — 콜이 어느 ICS 프로젝트에서 왔는지 추적 + 병합 정렬.
ALTER TABLE qa_calls ADD COLUMN IF NOT EXISTS proj_cd text;
COMMENT ON COLUMN qa_calls.proj_cd IS '콜 출처 ICS PROJ_CD (외부 소스 적재분). 내부/샘플 적재는 NULL.';
CREATE INDEX IF NOT EXISTS idx_qa_calls_proj_cd ON qa_calls (proj_cd) WHERE proj_cd IS NOT NULL;
