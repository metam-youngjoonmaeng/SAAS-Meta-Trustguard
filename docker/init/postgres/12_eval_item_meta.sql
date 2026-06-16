-- ============================================================
-- 12_eval_item_meta.sql — eval_item_defs 메타 필드 확장
-- ------------------------------------------------------------
-- EvalItems 페이지의 ItemModal 이 편집하는 메타 필드들 (Pentagon 매핑·채점 방식·
-- 만점·활성 여부) 을 영속화한다. 기존에는 console.log 만 찍는 mock 이라
-- 새로고침 시 사용자 변경이 다 날아갔음.
--
-- 추가 컬럼:
--   - pentagon_axis text  : Pentagon 축 라벨 (NULL = 매핑 없음, 총점에만 반영)
--                           pentagon_axes 테이블의 label 과 정합. FK 강제는 안 함
--                           — code default (brandConfig.radarLabels) fallback 도 함께 쓰므로.
--   - scoring_type  text  : 'numeric' | 'yes_no'. 기본 'numeric'.
--   - max_score     integer : numeric 일 때 만점. yes_no 면 무시 (충족=1).
--                             기본은 brandConfig 의 정의를 따르되, 행이 있으면 override.
--   - is_active     boolean : 비활성 시 채점·통계 제외 대상. 기본 true.
--
-- 변경 이력 (eval_item_change_log) 에는 새 필드도 함께 적재되므로,
--   change_type 종류는 그대로 두되 before/after JSON 에 새 키가 들어올 수 있다.
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

ALTER TABLE public.eval_item_defs
    ADD COLUMN IF NOT EXISTS pentagon_axis text,
    ADD COLUMN IF NOT EXISTS scoring_type  text NOT NULL DEFAULT 'numeric',
    ADD COLUMN IF NOT EXISTS max_score     integer,
    ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eval_item_defs_scoring_type_chk'
          AND conrelid = 'public.eval_item_defs'::regclass
    ) THEN
        ALTER TABLE public.eval_item_defs
            ADD CONSTRAINT eval_item_defs_scoring_type_chk
            CHECK (scoring_type IN ('numeric', 'yes_no'));
    END IF;
END$$;
