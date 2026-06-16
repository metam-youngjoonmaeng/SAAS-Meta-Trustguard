-- ============================================================
-- 07_eval_item_defs.sql — 평가항목 정의(criterion + prompt) + 버전 관리
-- ------------------------------------------------------------
-- 항목명/대분류/순서/만점/Pentagon 매핑 등 메타는 프론트 constants.js
-- (COLLECTION_CHECKLIST / COLLECTION_POINTS_BY_ROLE / RADAR_*) 가 SSOT.
-- 이 테이블은 그 위에 **편집 가능한 필드** 와 **버전 메타** 를 저장한다:
--   - criterion         : 평가 기준 텍스트
--   - prompt_template   : AI 평가 프롬프트 텍스트
--   - department        : 부서 (버전 단위)
--   - version           : 부서별 평가체계 버전 (의미 변경/추가/삭제 시 +1)
--   - effective_from    : 효력 시작 시점
--   - deactivated_at    : 비활성화 시점 (의미 변경으로 갈아끼우거나 삭제된 경우)
-- 키는 (org_id, department, order_no, version). 행이 없으면 UI 는 빈 값.
--
-- 콜→버전 매핑은 콜의 qa_calls.CDATE 와 effective_from/deactivated_at 의 range 매칭으로 derive.
-- 평가체계 버전 관리 설계는 docs/EVALUATION_ITEMS.md "평가체계 버전 관리" 섹션 참조.
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eval_item_defs (
    id              SERIAL PRIMARY KEY,
    org_id          integer NOT NULL
                    REFERENCES public.organizations(id) ON DELETE CASCADE,
    order_no        integer NOT NULL,
    category        text NOT NULL,
    item            text NOT NULL,
    criterion       text,
    prompt_template text,
    department      text NOT NULL DEFAULT '기본',
    version         integer NOT NULL DEFAULT 1,
    effective_from  timestamptz NOT NULL DEFAULT now(),
    deactivated_at  timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 기존 볼륨 호환: 컬럼이 없으면 추가
ALTER TABLE public.eval_item_defs
  ADD COLUMN IF NOT EXISTS department      text NOT NULL DEFAULT '기본',
  ADD COLUMN IF NOT EXISTS version         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS effective_from  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deactivated_at  timestamptz;

-- DEFAULT 갱신 (이전 마이그에서 '컬렉션관리부' DEFAULT 가 박힌 볼륨 대비)
ALTER TABLE public.eval_item_defs
    ALTER COLUMN department SET DEFAULT '기본';

-- 신한 부서명만 허용하던 CHECK 제거 — 멀티 브랜드 지원으로 free-form text 로 전환
-- (department 는 버전 스코프이지 qa_calls.department 와 1:1 매칭 강제 안 함).
ALTER TABLE public.eval_item_defs
    DROP CONSTRAINT IF EXISTS eval_item_defs_department_check;

-- 구 유니크 제약 제거 (있으면)
ALTER TABLE public.eval_item_defs
    DROP CONSTRAINT IF EXISTS eval_item_defs_org_order_uk;

-- 신 유니크 제약 추가 (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eval_item_defs_versioned_uk'
          AND conrelid = 'public.eval_item_defs'::regclass
    ) THEN
        ALTER TABLE public.eval_item_defs
            ADD CONSTRAINT eval_item_defs_versioned_uk
                UNIQUE (org_id, department, order_no, version);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_eval_item_defs_org
    ON public.eval_item_defs (org_id, order_no);

CREATE INDEX IF NOT EXISTS idx_eval_item_defs_effective
    ON public.eval_item_defs (org_id, department, effective_from DESC);

-- ALTER ADD COLUMN 으로 기존 행에 채워진 effective_from(=마이그레이션 시점) 을
-- updated_at(=해당 정의가 마지막으로 변경된 시점) 으로 backdate. PoC 단계에서 과거 콜이
-- "효력 이전" 으로 잡히지 않도록 보정. API 가 effective_from = now() 만 발행하는 동안은
-- effective_from > updated_at 인 케이스가 본 마이그레이션 결과뿐이라 idempotent.
-- 향후 "미래 시점 효력 발행" 기능 추가 시 본 UPDATE 는 제거 필요.
UPDATE public.eval_item_defs
   SET effective_from = updated_at
 WHERE effective_from > updated_at;
