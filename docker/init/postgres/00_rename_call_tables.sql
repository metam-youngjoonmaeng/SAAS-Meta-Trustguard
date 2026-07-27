-- ============================================================
-- 00_rename_call_tables.sql — 콜 자식 테이블 개명 (2026-07-27)
-- ------------------------------------------------------------
-- 목적: qa_calls 에 매달린 자식 테이블을 qa_call_* 접두어로 통일해
--       `\dt qa_call*` 한 번에 콜 데이터 모델 전체가 묶여 보이게 한다.
--
-- 스코프: 콜 관련 자식만. 계정·조직 코어는 절대 건드리지 않는다.
--   제외 → users / trainee_registrations / admin_users / auth_sessions /
--          organizations / domains / qa_calls / login_history / notifications /
--          coaching_* / eval_item_defs / pentagon_axes / qa_skill_* / qa_batch_* /
--          qa_golden_set(학습 자산) / ics_qa_poll_watermark
--
-- ★ 실행 순서가 00_ 인 이유:
--   seed-if-empty.sh 는 [0-9][0-9]_*.sql 을 사전순으로 매 기동 재실행하며 01_ 만 건너뛴다.
--   개명이 02~66 보다 먼저 끝나야 이후 파일들이 신규 이름으로 정상 동작한다.
--     · 빈 볼륨: 01_init(구 이름 생성) → 00_rename(신규로 개명) → 02~66(신규 이름) ✔
--     · 기존 DB: 00_rename(개명)                              → 02~66(신규 이름) ✔
--     · 재실행 : 구 이름 부재 → 전부 no-op                              ✔
--
-- 멱등: 구 이름이 존재할 때만 RENAME. 재실행/신규 설치 모두 안전.
-- 롤백: logs/dbbackup/qa_dashboard_before_optimize.sql
-- ============================================================

DO $$
DECLARE
    m  text[];
    pair text[];
BEGIN
    FOREACH m SLICE 1 IN ARRAY ARRAY[
        ['qa_conversations',        'qa_call_transcript'],
        ['qa_evaluation_rows',      'qa_call_item_score'],
        ['qa_checklist_rows',       'qa_call_item_evidence'],
        -- 펜타곤 축 결과 — 2단 개명(구 DB 는 1행째, 1차 개명만 끝난 DB 는 2행째가 잡힌다).
        -- '축(axis)' 만으로는 무슨 축인지 안 보여서 pentagon_axes / domain_default_pentagon_axes
        -- 와 같은 '펜타곤' 어휘로 통일한다.
        ['qa_analysis_report',      'qa_call_pentagon_result'],
        ['qa_call_axis_result',     'qa_call_pentagon_result'],
        ['qa_ksqi_rows',            'qa_call_ksqi_score'],
        ['qa_ksqi_evidence',        'qa_call_ksqi_evidence'],
        ['qa_ksqi_summary',         'qa_call_ksqi_summary'],
        ['qa_admin_comments',       'qa_call_comment'],
        ['qa_confidence_judgments', 'qa_call_confidence'],
        ['qa_review_events',        'qa_call_review_event'],
        ['qa_call_recovery',        'qa_call_emotion_recovery']
    ]
    LOOP
        pair := m;
        -- 구 이름이 '테이블로' 존재하고 신규 이름이 아직 없을 때만 개명
        IF to_regclass('public.' || pair[1]) IS NOT NULL
           AND to_regclass('public.' || pair[2]) IS NULL THEN
            EXECUTE format('ALTER TABLE public.%I RENAME TO %I', pair[1], pair[2]);
            RAISE NOTICE '[00_rename] % -> %', pair[1], pair[2];
        END IF;
    END LOOP;
END $$;
