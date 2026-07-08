-- ============================================================
-- 60_notification_prefs.sql — 사용자별 알림 수신 on/off 선호
-- ------------------------------------------------------------
-- 설정 > 알림 설정에서 유형별 알림 수신을 켜고 끈다.
-- prefs(JSONB): { "<type>": false } 형태로 "끈 유형"만 기록.
--   → 키가 없으면 수신(on)이 기본. 새 알림 유형이 추가돼도 별도 마이그레이션 없이 기본 on.
-- 발행 게이트: server/index.js createNotification() 이 INSERT 전에 이 테이블을 조회해
--   해당 유형이 false 면 발송을 스킵한다(기본 on, 조회 실패 시에도 발송=안전).
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

-- admin_users 는 호환 VIEW(users/trainee twin) 라 FK 대상이 될 수 없음 → FK 없이 user_id PK 만.
-- 선호는 부가정보라 참조무결성이 필수는 아니며, 사용자 삭제 시 남는 고아 행은 무해(재로그인 시 재생성).
CREATE TABLE IF NOT EXISTS public.notification_prefs (
    user_id    integer     PRIMARY KEY,                    -- 대상 사용자(admin_users/users 의 user_id)
    prefs      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { "<type>": false, ... } — 미기재 = 수신(on)
    updated_at timestamptz NOT NULL DEFAULT now()
);
