-- ============================================================
-- 골든셋(qa_golden_set)
-- ------------------------------------------------------------
-- 수기평가 결과 "AI평가와 동일" 로 확정된 케이스 중,
-- LLM Few-shot 예제로 활용할 통화 단위 평가행을 모아두는 테이블.
--
-- AI agent 는 (category, item) 기준으로 이 테이블을 SELECT 하여
-- "이 항목 평가 시 참고할 정답 케이스" 로 프롬프트에 주입한다.
-- 따라서 원본 qa_evaluation_rows / qa_calls 를 JOIN 하지 않고도
-- 한 행으로 케이스 한 건이 완결되도록 발화·사유·점수를 스냅샷한다.
-- (원본 eval 행이 후에 수정되어도 골든셋 판정 시점 값은 보존)
--
-- 동일 (qa_id, order_no) 쌍은 한 번만 골든셋에 들어갈 수 있다 (UNIQUE).
-- 골든셋에서 해제 = 해당 행 DELETE. 재등록 = INSERT (created_at 새로 기록).
--
-- seed-if-empty.sh 가 매 기동마다 idempotent 재적용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.qa_golden_set (
    golden_id               SERIAL PRIMARY KEY,

    -- 원본 평가행 참조 (콜 단위 PK = qa_calls."ID" + order_no)
    qa_id                   text NOT NULL
                            REFERENCES public.qa_calls("ID") ON DELETE CASCADE,
    order_no                integer NOT NULL,

    -- 멀티테넌시: 브랜드별 격리 (신한 / 한화 ...)
    org_id                  integer
                            REFERENCES public.organizations(id) ON DELETE SET NULL,

    -- ── 스냅샷 (등록 시점 기준, 이후 원본 수정과 무관하게 유지) ──
    call_datetime           text,                         -- qa_calls."CDATE" 사본
    category                text NOT NULL,                -- 예: '친절도'
    item                    text NOT NULL,                -- 예: '첫인사'
    reason_text             text,                         -- 평가 사유
    agent_utterance         text,                         -- 상담사 발화 원문
    score                   double precision NOT NULL,    -- 확정 점수 (manual = ai)

    -- ── 누가 / 언제 골든셋으로 지정했는지 ──
    created_at              timestamp with time zone NOT NULL DEFAULT now(),
    created_by_user_id      integer
                            REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
    -- 사용자 행이 지워져도 골든셋은 누가 등록했는지 알 수 있도록 캐시
    created_by_login_id     text,
    created_by_display_name text,

    CONSTRAINT qa_golden_set_call_order_uk UNIQUE (qa_id, order_no)
);

-- agent 의 주요 조회 패턴: (org_id, category, item) 으로 골든셋 케이스 가져오기
CREATE INDEX IF NOT EXISTS idx_qa_golden_set_lookup
    ON public.qa_golden_set (org_id, category, item);

-- 최근 등록순 / 사용자별 등록 이력 조회용
CREATE INDEX IF NOT EXISTS idx_qa_golden_set_created
    ON public.qa_golden_set (created_at DESC);
-- created_by_user_id 는 14_unify_user_columns 에서 제거된다. 시더가 매 기동마다 05 를
-- 재적용하므로, 컬럼이 이미 없는 상태에서 인덱스 생성이 터지지 않도록 컬럼 존재 시에만 생성.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'qa_golden_set'
          AND column_name = 'created_by_user_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_qa_golden_set_creator
            ON public.qa_golden_set (created_by_user_id, created_at DESC);
    END IF;
END$$;
