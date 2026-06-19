-- 관리자 코멘트 영속 — 평가 상세(qa_id = qa_calls."ID") 단위로 코멘트 배열 보관.
-- qa_calls 는 ICS 미러(minimal schema)라 직접 컬럼을 안 늘리고 별도 테이블에 보관한다.
-- 프론트(Detail.jsx)는 전체 배열을 PUT 으로 보내므로 qa_id 단일 행에 jsonb 배열로 저장(전체 교체).
-- 코멘트 객체 예: { author, created_at, text, updated_at? }.
CREATE TABLE IF NOT EXISTS public.qa_admin_comments (
    qa_id      text PRIMARY KEY,
    comments   jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
