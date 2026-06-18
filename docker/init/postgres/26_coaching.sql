-- ============================================================
-- 26_coaching.sql — 코칭 배정 영구저장 (평가관리 → 코칭 배정)
-- ------------------------------------------------------------
-- 관리자가 평가관리 화면에서 만든 "코칭 배정"을 DB 에 영구 보관한다.
-- 그래야 관리자 배정 ↔ 상담사 본인화면(CounselorResults) 조회가 실제로 연결된다.
--
-- 보수적 설계: 실제 생성 모달에서 입력되는 값만 단일 테이블에 담는다.
-- 다중값(대상 상담사·액션아이템·시나리오)은 배열 컬럼으로 보관(테이블 분리 X).
--   입력값 : target_type(개인/그룹), members(대상), title(집중영역), action_items, scenario_codes
--   자동값 : assigned_by_user_id(배정자), assigned_at(배정일시), created_at
-- (reason/criteria/status/priority/icon 등 입력란 없는 항목은 두지 않음)
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

-- 이전(과분리) 설계 폐기 — 데이터 없던 초기 테이블 정리.
DROP TABLE IF EXISTS public.coaching_scenarios;
DROP TABLE IF EXISTS public.coaching_items;
DROP TABLE IF EXISTS public.coaching_members;
DROP TABLE IF EXISTS public.coaching_groups;

CREATE TABLE IF NOT EXISTS public.coaching_assignments (
    id                  bigserial   PRIMARY KEY,                          -- 코칭 고유번호
    org_id              integer     REFERENCES public.organizations(id),  -- 소속 조직(브랜드)
    title               text        NOT NULL,                             -- 코칭 제목(집중 영역명)
    target_type         text        NOT NULL DEFAULT 'group',             -- 대상 유형 (group=그룹 / individual=개인)
    members             integer[]   NOT NULL DEFAULT '{}',                -- 대상 상담사 user_id 목록(admin_users.user_id)
    action_items        text[]      NOT NULL DEFAULT '{}',                -- 개선 액션 아이템 목록
    scenario_codes      text[]      NOT NULL DEFAULT '{}',                -- 연결 Tutor 시나리오 코드 목록(slug, 예 'S1')
    channel             text        NOT NULL DEFAULT 'call',              -- 학습 채널 ('call'=전화 / 'chat'=채팅). 취약했던 채널 기준 배정.
    assigned_by_user_id integer     REFERENCES public.admin_users(user_id) ON DELETE SET NULL,  -- 배정한 관리자
    assigned_at         timestamptz NOT NULL DEFAULT now(),               -- 배정 일시
    created_at          timestamptz NOT NULL DEFAULT now()                -- 생성 일시
);

-- 구버전(컬럼 과다) 정리 — 표시메타 제거(데이터 보존, 멱등).
ALTER TABLE public.coaching_assignments DROP COLUMN IF EXISTS priority;
ALTER TABLE public.coaching_assignments DROP COLUMN IF EXISTS icon;
-- 학습 채널 컬럼(기존 테이블 보강, 멱등). 기존 배정은 기본 'call'.
ALTER TABLE public.coaching_assignments ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'call';

CREATE INDEX IF NOT EXISTS idx_coaching_assignments_org ON public.coaching_assignments (org_id);
-- 상담사 본인화면에서 "나에게 배정된 코칭" 조회( members @> ARRAY[user_id] )용 GIN 인덱스.
CREATE INDEX IF NOT EXISTS idx_coaching_assignments_members ON public.coaching_assignments USING gin (members);
