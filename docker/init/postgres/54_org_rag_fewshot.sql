-- 루브릭 few-shot 토글 설정을 organizations 테이블로 이관 (DB 단일 소스화)
--
-- 기존: ./data/uploads/rag_fewshot_config.json (flat 파일 + 코드 DEFAULT_CONFIG 폴백).
--       운영 상태값을 데이터 볼륨 파일에 두던 것을 백엔드 DB(organizations)로 옮긴다.
-- shape: organizations.rag_rubric_id(text) + rag_fewshot_item_names(jsonb 배열).
--   getOrgFewshot 은 rag_rubric_id 와 item_names 가 모두 채워진 org 만 RAG 게이트 적용.
--   (구 config 의 pure 필드는 폐기 — 전 브랜드 자동 pure 로 ingest 가 하드코딩, getOrgPure 미사용.)
-- 멱등: 매 기동마다 seeder 가 재적용 → ADD COLUMN IF NOT EXISTS + 미설정 행에만 시드.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS rag_rubric_id text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS rag_fewshot_item_names jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 구 DEFAULT_CONFIG 이관: asdf(org10) 설명력 RAG.
-- 해당 org 가 없는 배포에서는 no-op. 이미 설정값이 있으면(rag_rubric_id<>'') 덮어쓰지 않아
-- 관리자 편집 보존 + 재기동 멱등.
UPDATE public.organizations
   SET rag_rubric_id = 'rbrc_asdf_org10',
       rag_fewshot_item_names = '["설명력"]'::jsonb
 WHERE id = 10
   AND rag_rubric_id = ''
   AND jsonb_array_length(rag_fewshot_item_names) = 0;
