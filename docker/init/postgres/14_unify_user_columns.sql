-- ============================================================
-- 14_unify_user_columns.sql — admin_users 참조 컬럼 네이밍 통일
-- ------------------------------------------------------------
-- 모든 테이블의 admin_users 참조 컬럼을 원본 컬럼명 (user_id /
-- login_id / display_name / role) 로 통일.
--
-- 컨벤션:
--   - 한 테이블이 admin_users 를 1번만 참조하므로 role-prefix 불필요
--   - 감사/이력 테이블은 캐시(login_id, display_name, role) 3종 유지
--   - 활성 운영 테이블(qa_calls, qa_golden_set)은 FK 1개만, 나머지 정보는 JOIN
--
-- qa_golden_set 추가 정리:
--   - 등록자는 항상 그 콜의 검수자(qa_calls.user_id)이므로 user 컬럼 전부 제거
--   - call_datetime 도 qa_calls.CDATE 중복 사본이라 제거
--   - 수정 이력은 qa_audit_logs(resource_type='qa_golden_set')에 적재
--
-- idempotent: 모든 RENAME/DROP 은 IF EXISTS 가드 (DO 블록).
-- ============================================================

-- ---------- qa_calls : reviewed_by_user_id → user_id ----------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_calls'
          AND column_name = 'reviewed_by_user_id'
    ) THEN
        ALTER TABLE public.qa_calls RENAME COLUMN reviewed_by_user_id TO user_id;
    END IF;
END$$;

-- ---------- qa_audit_logs : actor_* → user_id / login_id / display_name / role ----------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='qa_audit_logs'
                 AND column_name='actor_user_id') THEN
        ALTER TABLE public.qa_audit_logs RENAME COLUMN actor_user_id TO user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='qa_audit_logs'
                 AND column_name='actor_login_id') THEN
        ALTER TABLE public.qa_audit_logs RENAME COLUMN actor_login_id TO login_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='qa_audit_logs'
                 AND column_name='actor_display_name') THEN
        ALTER TABLE public.qa_audit_logs RENAME COLUMN actor_display_name TO display_name;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='qa_audit_logs'
                 AND column_name='actor_role') THEN
        ALTER TABLE public.qa_audit_logs RENAME COLUMN actor_role TO role;
    END IF;
END$$;

-- ---------- qa_audit_logs__sandbox_snapshot (테이블이 있다면 동일하게) ----------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='qa_audit_logs__sandbox_snapshot') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='qa_audit_logs__sandbox_snapshot'
                     AND column_name='actor_user_id') THEN
            ALTER TABLE public.qa_audit_logs__sandbox_snapshot RENAME COLUMN actor_user_id TO user_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='qa_audit_logs__sandbox_snapshot'
                     AND column_name='actor_login_id') THEN
            ALTER TABLE public.qa_audit_logs__sandbox_snapshot RENAME COLUMN actor_login_id TO login_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='qa_audit_logs__sandbox_snapshot'
                     AND column_name='actor_display_name') THEN
            ALTER TABLE public.qa_audit_logs__sandbox_snapshot RENAME COLUMN actor_display_name TO display_name;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='qa_audit_logs__sandbox_snapshot'
                     AND column_name='actor_role') THEN
            ALTER TABLE public.qa_audit_logs__sandbox_snapshot RENAME COLUMN actor_role TO role;
        END IF;
    END IF;
END$$;

-- ---------- eval_item_change_log : actor_* → user_id / login_id / display_name ----------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='eval_item_change_log'
                 AND column_name='actor_user_id') THEN
        ALTER TABLE public.eval_item_change_log RENAME COLUMN actor_user_id TO user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='eval_item_change_log'
                 AND column_name='actor_login_id') THEN
        ALTER TABLE public.eval_item_change_log RENAME COLUMN actor_login_id TO login_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='eval_item_change_log'
                 AND column_name='actor_display_name') THEN
        ALTER TABLE public.eval_item_change_log RENAME COLUMN actor_display_name TO display_name;
    END IF;
END$$;

-- ---------- pentagon_axis_change_log : actor_* → user_id / login_id / display_name ----------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='pentagon_axis_change_log'
                 AND column_name='actor_user_id') THEN
        ALTER TABLE public.pentagon_axis_change_log RENAME COLUMN actor_user_id TO user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='pentagon_axis_change_log'
                 AND column_name='actor_login_id') THEN
        ALTER TABLE public.pentagon_axis_change_log RENAME COLUMN actor_login_id TO login_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='pentagon_axis_change_log'
                 AND column_name='actor_display_name') THEN
        ALTER TABLE public.pentagon_axis_change_log RENAME COLUMN actor_display_name TO display_name;
    END IF;
END$$;

-- ---------- qa_golden_set : user 캐시 3종 + call_datetime DROP ----------
-- 등록자는 qa_calls.user_id (검수자) 로 추적, call_datetime 은 qa_calls.CDATE 로 추적.
-- 수정 이력은 qa_audit_logs(resource_type='qa_golden_set')에 적재됨.
ALTER TABLE public.qa_golden_set DROP COLUMN IF EXISTS created_by_user_id;
ALTER TABLE public.qa_golden_set DROP COLUMN IF EXISTS created_by_login_id;
ALTER TABLE public.qa_golden_set DROP COLUMN IF EXISTS created_by_display_name;
ALTER TABLE public.qa_golden_set DROP COLUMN IF EXISTS call_datetime;

-- ---------- 인덱스 정리 ----------
-- idx_qa_audit_actor_time → idx_qa_audit_user_time (컬럼 RENAME 됐으니 인덱스명도 정렬)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname='public' AND indexname='idx_qa_audit_actor_time') THEN
        ALTER INDEX public.idx_qa_audit_actor_time RENAME TO idx_qa_audit_user_time;
    END IF;
END$$;

-- idx_qa_golden_set_creator → DROP (creator user_id 컬럼 자체가 없어짐)
DROP INDEX IF EXISTS public.idx_qa_golden_set_creator;
