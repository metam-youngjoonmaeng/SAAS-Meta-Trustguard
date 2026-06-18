-- ============================================================
-- admin_users.department 컬럼 추가 (원본 01-AI-Tutor-dev TraineeRegistration.department 와 동일 개념)
-- 사용자 관리 페이지의 "부서" 컬럼에 표시되며, 브랜드(org_id) 와는 독립적인 자유 텍스트.
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

-- 29/30 이후 admin_users 는 VIEW → 테이블일 때만(최초 init) 실행.
DO $$
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.admin_users')) = 'r' THEN
        ALTER TABLE public.admin_users
            ADD COLUMN IF NOT EXISTS department text;
        -- 시드: admin1 / test1 둘 다 "AICC 플랫폼실"
        UPDATE public.admin_users SET department = 'AICC 플랫폼실'
        WHERE login_id IN ('admin1', 'test1') AND (department IS NULL OR department = '');
    END IF;
END $$;
