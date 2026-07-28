-- ============================================================
-- 76_qa_call_annotation_fk.sql — qa_call_annotation → qa_calls FK (2026-07-28)
-- ------------------------------------------------------------
-- 배경: ERD(qa_new.json) note 는 "qa_call_* 접두어는 전부 qa_calls 의 자식
--       (ON DELETE CASCADE)" 이라고 선언하는데, 실제로는 qa_call_annotation 에
--       FK 가 걸려 있지 않았다. 조인은 정상 동작하지만(qa_id text → "ID" text)
--       물리적 제약이 없어 아래 보장이 실제로는 없었다:
--         · 존재하지 않는 콜을 가리키는 행 삽입 차단
--         · 콜 삭제 시 코멘트 동반 삭제 (CASCADE)
--       → 콜을 지우면 도달 불가한 고아 코멘트가 남는다.
--
-- 다른 자식 6종은 이미 FK 보유 (참조 명명 규칙 확인용):
--   qa_call_item_score."ID"      → qa_evaluation_rows_ID_fkey
--   qa_call_ksqi_score."ID"      → qa_ksqi_rows_ID_fkey
--   qa_call_ksqi_summary."ID"    → qa_ksqi_summary_ID_fkey
--   qa_call_pentagon_result."ID" → qa_analysis_report_ID_fkey
--   qa_call_review_event.qa_id   → qa_review_events_qa_id_fkey
--   qa_call_transcript."ID"      → qa_conversations_ID_fkey
--
-- ★ qa_call_emotion_recovery 는 이 마이그레이션 대상이 아니다.
--   그 테이블은 qa_id/"ID" 컬럼이 없고 키가 (proj_cd, uid) 복합이다. 부모
--   qa_calls 에 (proj_cd, "UID") UNIQUE 가 없어(PK 는 "ID" 단독) 복합 FK 가
--   성립하지 않고, qa_calls.proj_cd 는 현재 전량 NULL 이라 짝도 맞지 않는다.
--   연결을 원한다면 별도 설계(부모 UNIQUE 추가 또는 qa_id 컬럼 도입)가 선행돼야 한다.
--
-- 고아 행 처리: 부모가 사라진 코멘트는 UI 어디서도 도달할 수 없으므로 삭제한다.
--   삭제 건수는 RAISE NOTICE 로 남긴다(시더 로그에서 확인 가능). 현재 로컬은 0행.
--
-- 멱등: 제약 존재 여부를 pg_constraint 로 확인 후 추가 — 시더가 매 기동
--   전 마이그레이션을 재실행해도 안전(ADD CONSTRAINT 에는 IF NOT EXISTS 가 없다).
-- ============================================================

DO $$
DECLARE
    orphan_count bigint := 0;
BEGIN
    IF to_regclass('public.qa_call_annotation') IS NULL THEN
        RAISE NOTICE '76: qa_call_annotation 없음 — 스킵';
        RETURN;
    END IF;
    IF to_regclass('public.qa_calls') IS NULL THEN
        RAISE NOTICE '76: qa_calls 없음 — 스킵';
        RETURN;
    END IF;

    -- 이미 걸려 있으면 아무것도 하지 않는다(고아 삭제도 건너뜀 — 재실행 무해).
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.qa_call_annotation'::regclass
           AND contype  = 'f'
           AND conname  = 'qa_call_annotation_qa_id_fkey'
    ) THEN
        RAISE NOTICE '76: FK 이미 존재 — 스킵';
        RETURN;
    END IF;

    -- 고아 행 정리 (부모 콜이 없는 코멘트 = 도달 불가).
    SELECT count(*) INTO orphan_count
      FROM public.qa_call_annotation a
      LEFT JOIN public.qa_calls c ON c."ID" = a.qa_id
     WHERE c."ID" IS NULL;

    IF orphan_count > 0 THEN
        DELETE FROM public.qa_call_annotation a
         WHERE NOT EXISTS (SELECT 1 FROM public.qa_calls c WHERE c."ID" = a.qa_id);
        RAISE NOTICE '76: 고아 행 % 건 삭제', orphan_count;
    ELSE
        RAISE NOTICE '76: 고아 행 없음';
    END IF;

    ALTER TABLE public.qa_call_annotation
        ADD CONSTRAINT qa_call_annotation_qa_id_fkey
        FOREIGN KEY (qa_id) REFERENCES public.qa_calls ("ID") ON DELETE CASCADE;

    RAISE NOTICE '76: qa_call_annotation_qa_id_fkey 추가 완료 (ON DELETE CASCADE)';
END $$;

COMMENT ON CONSTRAINT qa_call_annotation_qa_id_fkey ON public.qa_call_annotation IS
    'qa_calls("ID") 참조 · ON DELETE CASCADE. 콜 삭제 시 관리자 코멘트 동반 삭제. 2026-07-28 추가(그전까지 FK 미설정으로 고아 행 발생 가능).';
