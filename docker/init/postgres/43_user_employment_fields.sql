-- 사용자(멤버십) 인사 필드 확장 — 입퇴사일/내선번호/중복로그인.
--   hire_date(입사일)·status(계정상태)·department(팀)·role(권한)은 이미 trainee_registrations 에 존재.
--   여기서 leave_date(퇴사일)·extension(내선번호)·dup_login_yn(중복로그인 Y/N) 신규 추가.
--   ICS 계정은 SSO 동기화로 채우고(icsSso), 비-ICS(로컬) 계정은 아래 백필로 기본값 부여.
--   idempotent — ADD COLUMN IF NOT EXISTS + 빈값만 백필.

ALTER TABLE public.trainee_registrations ADD COLUMN IF NOT EXISTS leave_date    varchar(10);          -- 퇴사일(없으면 NULL)
ALTER TABLE public.trainee_registrations ADD COLUMN IF NOT EXISTS extension     varchar(20);          -- 내선번호(없으면 NULL)
ALTER TABLE public.trainee_registrations ADD COLUMN IF NOT EXISTS dup_login_yn  char(1) NOT NULL DEFAULT 'N';  -- 중복로그인 허용 Y/N

-- 비-ICS(로컬) 계정 백필: 입사일 2025-04-01, 재직중(active). password_hash 가 있으면 로컬 계정.
--   입사일은 비어 있을 때만 채움(운영 중 수정값 보존). status 는 active 로 정규화.
UPDATE public.trainee_registrations tr
   SET hire_date = '2025-04-01'
 WHERE (tr.hire_date IS NULL OR tr.hire_date = '')
   AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = tr.user_id AND u.password_hash IS NOT NULL);

UPDATE public.trainee_registrations tr
   SET status = 'active'
 WHERE (tr.status IS NULL OR tr.status = '')
   AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = tr.user_id AND u.password_hash IS NOT NULL);
