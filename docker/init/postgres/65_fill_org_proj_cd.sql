-- 04 QA organizations.proj_cd 채움 — 03 TA · 02 튜터 와 브랜드 매칭키 정렬
-- 인입 라우팅은 ICS_QA_ORG_ID 오버라이드가 담당하므로 이 값은 ICS 적재에 영향 없음.
-- /api/svc/brand-qa-scores (03 SLA 'QA 평가' 연동, 서비스 토큰 게이트) 의 브랜드 매칭키로 쓰인다.
-- proj_cd 는 non-null 유일 제약(organizations_proj_cd_uk). metabank/metashop 은 미사용 값이라 안전.
UPDATE organizations SET proj_cd = 'metabank' WHERE name = '은행'      AND proj_cd IS NULL;  -- org 48
UPDATE organizations SET proj_cd = 'metashop' WHERE name = '0703_이커' AND proj_cd IS NULL;  -- org 42
