-- ============================================================
-- 09_eval_item_change_log.sql — 평가항목 변경 이력 (장기 보관)
-- ------------------------------------------------------------
-- 평가항목(eval_item_defs) 의 모든 변경을 추적하는 영속 audit log.
-- qa_audit_logs (retention 3일) 와 달리 retention 적용하지 않음.
-- 컴플라이언스/감사 측면에서 평가체계 변경은 영구 보관 영역.
--
-- 한 row = 한 번의 변경 이벤트. before_json / after_json 에 해당 필드만 담는다
-- (예: 프롬프트만 바뀌었으면 prompt_template 만, 기준만 바뀌었으면 criterion 만).
--
-- 화면: EvalItems.jsx 우측 패널의 "변경 이력" 탭에서 항목별로 조회.
-- 설계 근거: docs/EVALUATION_ITEMS.md "평가체계 버전 관리" 섹션.
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eval_item_change_log (
    id                  SERIAL PRIMARY KEY,
    org_id              integer NOT NULL
                        REFERENCES public.organizations(id) ON DELETE CASCADE,
    department          text NOT NULL,
    order_no            integer NOT NULL,
    -- 변경 시점의 항목명/대분류 스냅샷. 항목이 삭제되어도 통합 이력 화면에서 어떤 항목이었는지
    -- 표시 가능하도록 row 자체에 박음 (SSOT 와 결합도 끊음).
    item_name           text,
    category_name       text,
    version             integer,         -- 변경 시점의 활성 버전 (참고용)
    change_type         text NOT NULL,   -- 'criterion_update' / 'prompt_update' / 'item_rename' / 'new_version' / 'deactivate' / 'create'
    before_json         jsonb,           -- 변경 전 스냅샷 (변경된 필드만)
    after_json          jsonb,           -- 변경 후 스냅샷 (변경된 필드만)
    actor_user_id       integer,
    actor_login_id      text,
    actor_display_name  text,
    changed_at          timestamptz NOT NULL DEFAULT now()
);

-- 기존 볼륨 호환: 컬럼 없으면 추가
ALTER TABLE public.eval_item_change_log
  ADD COLUMN IF NOT EXISTS item_name     text,
  ADD COLUMN IF NOT EXISTS category_name text;

CREATE INDEX IF NOT EXISTS idx_eval_item_change_log_lookup
    ON public.eval_item_change_log (org_id, department, order_no, changed_at DESC);

-- 통합 이력 화면용 — org_id 기준 시간순 정렬에 최적화
CREATE INDEX IF NOT EXISTS idx_eval_item_change_log_org_time
    ON public.eval_item_change_log (org_id, changed_at DESC);
