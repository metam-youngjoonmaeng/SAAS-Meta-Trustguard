-- ============================================================
-- 13_pentagon_axes.sql — Pentagon 5축 정의 (편집 가능 + 변경 이력)
-- ------------------------------------------------------------
-- 그동안 Pentagon 축은 프론트 constants.js (RADAR_LABELS_* / brandConfig.radarLabels)
-- 가 SSOT 였고, EvalItems 의 AxisModal 은 console.log mock 이었다. 이 테이블은
-- eval_item_defs 와 같은 패턴으로 (org_id, department, axis_no, version) 키 위에
-- 편집 가능한 라벨·설명·프롬프트·활성 여부를 영속화한다.
--
-- 행이 없으면 UI 는 brandConfig.radarLabels 기본값으로 떨어진다 (eval_item_defs 와 동일 패턴).
--
-- 변경 이력은 별도 분리하지 않고 eval_item_change_log 와 같은 톤으로 본 파일에서
-- pentagon_axis_change_log 를 새로 만든다 (감사 측면에서 평가체계 변경은 영구 보관 영역).
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pentagon_axes (
    id              SERIAL PRIMARY KEY,
    org_id          integer NOT NULL
                    REFERENCES public.organizations(id) ON DELETE CASCADE,
    department      text NOT NULL DEFAULT '기본',
    axis_no         integer NOT NULL,
    label           text NOT NULL,
    description     text,
    prompt_template text,
    is_active       boolean NOT NULL DEFAULT true,
    version         integer NOT NULL DEFAULT 1,
    effective_from  timestamptz NOT NULL DEFAULT now(),
    deactivated_at  timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pentagon_axes_versioned_uk'
          AND conrelid = 'public.pentagon_axes'::regclass
    ) THEN
        ALTER TABLE public.pentagon_axes
            ADD CONSTRAINT pentagon_axes_versioned_uk
                UNIQUE (org_id, department, axis_no, version);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pentagon_axes_org
    ON public.pentagon_axes (org_id, axis_no);

CREATE INDEX IF NOT EXISTS idx_pentagon_axes_effective
    ON public.pentagon_axes (org_id, department, effective_from DESC);


-- ─── 변경 이력 ─────────────────────────────────────────────────
-- 패턴은 eval_item_change_log 와 동일하되 axis_no 키로 인덱싱.
CREATE TABLE IF NOT EXISTS public.pentagon_axis_change_log (
    id                  SERIAL PRIMARY KEY,
    org_id              integer NOT NULL
                        REFERENCES public.organizations(id) ON DELETE CASCADE,
    department          text NOT NULL,
    axis_no             integer NOT NULL,
    label_snapshot      text,
    version             integer,
    change_type         text NOT NULL,   -- 'create' / 'label_rename' / 'description_update' /
                                         -- 'prompt_update' / 'deactivate' / 'reactivate' / 'new_version'
    before_json         jsonb,
    after_json          jsonb,
    actor_user_id       integer,
    actor_login_id      text,
    actor_display_name  text,
    changed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pentagon_axis_change_log_lookup
    ON public.pentagon_axis_change_log (org_id, department, axis_no, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pentagon_axis_change_log_org_time
    ON public.pentagon_axis_change_log (org_id, changed_at DESC);
