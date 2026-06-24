-- ============================================================
-- 47_domain_default_eval_items.sql — 도메인(업종)별 기본 평가항목 카탈로그
-- ------------------------------------------------------------
-- 목적: 신규 브랜드 생성 시, 선택한 도메인(organizations.domain_id)의
--   "기본 평가항목"을 eval_item_defs 로 자동 복제하기 위한 소스 카탈로그.
--   (기존: 도메인 무관하게 '첫인사' 1개만 시드 → 도메인별 디폴트 상속으로 개선)
--
-- 이 테이블은 eval_item_defs 의 "템플릿" 격이다. 컬럼은 eval_item_defs 와
--   정렬(order_no)·내용(category/item/criterion/prompt_template)·메타
--   (pentagon_axis/scoring_type/max_score) 가 1:1 대응되며, 버전 관리
--   (version/department/effective_from/deactivated_at) 는 갖지 않는다 —
--   템플릿이므로 평탄한 단일 트랙. 복제 시 eval_item_defs 에 department='기본',
--   version=1 로 박힌다.
--
-- 콘텐츠 입력은 관리자 UI (브랜드 관리 → 도메인 기본 평가항목) 에서 super_admin 이 수행.
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용 (DDL 만; 콘텐츠 시드는 DB 가 SSOT).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.domain_default_eval_items (
    id              SERIAL PRIMARY KEY,
    domain_id       integer NOT NULL
                    REFERENCES public.domains(id) ON DELETE CASCADE,
    order_no        integer NOT NULL,
    category        text NOT NULL,
    item            text NOT NULL,
    criterion       text,
    prompt_template text,
    pentagon_axis   text,
    scoring_type    text NOT NULL DEFAULT 'numeric',
    max_score       integer,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT domain_default_eval_items_scoring_type_chk
        CHECK (scoring_type IN ('numeric', 'yes_no'))
);

-- 도메인 내 순번 유일 — eval_item_defs 의 order_no 슬롯 모델과 동일 사상.
CREATE UNIQUE INDEX IF NOT EXISTS domain_default_eval_items_uk
    ON public.domain_default_eval_items (domain_id, order_no);

-- 도메인별 조회(복제·편집 핫패스) 인덱스.
CREATE INDEX IF NOT EXISTS idx_domain_default_eval_items_domain
    ON public.domain_default_eval_items (domain_id);
