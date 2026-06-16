-- 09-AI-QA_Dashboard <- 05-AI-Tutor-ICS 사용자 마이그레이션 (생성: 2026-06-11)
-- login_id/display_name/role 동일, org_id=METAM, 초기비번 test1234!(SHA256), must_change_password=true
-- 멱등: ON CONFLICT(login_id) DO NOTHING (재적용 시 비번 덮어쓰지 않음)
BEGIN;
INSERT INTO public.admin_users (login_id, password_hash, display_name, role, is_active, org_id, must_change_password, created_at, updated_at) VALUES
  ('jinwoo.jung', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '정진우', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('sijin.yoo', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '유시진', 'admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('minsu.shin', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '신민수', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('eugene.kim', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '김유진', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('hari.kim', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '김하리', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('youngjoon.maeng', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '맹영준', 'admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('eunkyu.choi', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '최은규', 'admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('seokmin.kim', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '김석민', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('suhyun.lee', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', '이수현', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('demo02', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', 'demo02', 'admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('system', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', 'system', 'super_admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('ittest', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', 'ITTEST', 'admin', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now()),
  ('ittest2', 'd27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', 'ITTEST2', 'agent', 1, (SELECT id FROM public.organizations WHERE name='METAM' LIMIT 1), true, now(), now())
ON CONFLICT (login_id) DO NOTHING;
-- '전부 다' 요청: 기존 admin1/test1 포함 전 사용자 비번 test1234! 리셋 + 강제변경
UPDATE public.admin_users SET password_hash='d27c5b2db7dc392a0cfeb18b9782f34709d1dea7bdb8dd7209f6d4c7387c7910', must_change_password=true, updated_at=now();
COMMIT;
