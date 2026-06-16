-- 콜 ↔ 담당 상담사 연결.
--
-- 배경: qa_calls 에는 "어떤 콜을 누가 응대했는지"를 담는 컬럼이 없었다.
--   "UID" 는 콜마다 유니크한 녹취ID(상담사 아님), user_id 는 검수자/적재자다.
--   → 상담사 랭킹·"상담사 본인 콜만 보기" 권한을 위해 담당 상담사 식별자를 직접 보관한다.
--
-- 별도 agents 마스터는 만들지 않는다. admin_users(role='agent')가 이미 "이름+권한 가진 사람"이고,
-- ICS SSO 가 상담사를 admin_users 에 provisioning(login_id = '{user_cd}@{proj_cd}' 소문자) 한다.
--
--   agent_code     : ICS user_m.USER_CD (예: 'demo02') — 안정적 상담사 업무키. 항상 보관.
--   agent_user_id  : 해석된 admin_users.user_id (이름 조인·권한 필터용). 계정 없으면 NULL(=미지정).
-- 둘 다 NULL = 비-ICS/시드 콜처럼 상담사 정보 없는 경우(랭킹에서 '미지정' 으로 묶임).
ALTER TABLE public.qa_calls ADD COLUMN IF NOT EXISTS agent_code text;
ALTER TABLE public.qa_calls ADD COLUMN IF NOT EXISTS agent_user_id integer
    REFERENCES public.admin_users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.qa_calls.agent_code IS
    'ICS user_m.USER_CD(담당 상담사 업무키). 적재 시 ICS USER_ID→USER_CD 로 해석. NULL=상담사 정보 없음.';
COMMENT ON COLUMN public.qa_calls.agent_user_id IS
    '담당 상담사의 admin_users.user_id(이름 조인·본인필터용). 매칭 계정 없으면 NULL(미지정).';

CREATE INDEX IF NOT EXISTS idx_qa_calls_agent_user ON public.qa_calls (agent_user_id);
CREATE INDEX IF NOT EXISTS idx_qa_calls_agent_code ON public.qa_calls (agent_code);

-- 기존 SSO provisioning 계정과 agent_code 를 연결(멱등 백필).
-- login_id = lower(agent_code || '@' || proj_cd) 규칙(icsSso.mjs)과 동형 매칭.
UPDATE public.qa_calls c
   SET agent_user_id = u.user_id
  FROM public.admin_users u
 WHERE c.agent_user_id IS NULL
   AND c.agent_code IS NOT NULL
   AND c.proj_cd IS NOT NULL
   AND lower(u.login_id) = lower(c.agent_code || '@' || c.proj_cd);
