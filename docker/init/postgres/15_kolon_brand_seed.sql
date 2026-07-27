-- ============================================================
-- 15_kolon_brand_seed.sql — 코오롱 브랜드 등록 (표준 18항목 트랙용)
-- ------------------------------------------------------------
-- 목적: qa-pipeline 표준 18항목 트랙(POST /api/ingest/from-qa-pipeline, track='standard')
--       으로 적재되는 코오롱 콜이 코오롱 브랜드로 귀속되도록 organizations + eval_item_defs 시드.
-- - organizations 에 '코오롱'(short '코') 1건 등록. name 에 UNIQUE 제약이 없으므로
--   id 하드코딩 대신 name NOT EXISTS 가드로 idempotent INSERT(admin UI SERIAL 발번과 충돌 회피).
--   INSERT 후 organizations_id_seq 동기화(02/04 선례와 동일).
-- - 등록된 org id 로 eval_item_defs 18항목 시드 (server/defaultEvalItems.mjs SSOT,
--   department='기본', version=1, ON CONFLICT (org_id, department, order_no, version) DO NOTHING).
-- - qa_calls.department CHECK 의 '고객지원실' 은 04/08 마이그가 이미 widest 리스트로 확장 →
--   표준 트랙(department='고객지원실', role='전체')에 추가 변경 불필요. (참고용 idempotent 재보강 포함)
-- - pentagon_axes 시드는 생략: 분석 라우트(server/index.js)가 qa_call_item_score.ai_eval 로
--   Pentagon 5축을 LIVE 도출하고, FE constants(DEFAULT_BRAND_CONFIG) fallback 으로 표시되므로
--   고정 축 시드가 불필요(오히려 live 도출과 이중관리 위험).
-- - mock 콜(qa_calls/qa_call_transcript/checklist/evaluation/analysis)은 시드하지 않음 —
--   실데이터는 표준 트랙 ingest(파이프라인 평가 결과)로만 유입.
-- - seed-if-empty.sh 가 매 기동 idempotent 재적용하므로 모든 쓰기는 NOT EXISTS / ON CONFLICT 가드.
-- ============================================================

BEGIN;

-- ── 1. qa_calls.department CHECK 보강 (idempotent: '고객지원실' 미포함 시에만 교체) ─
-- 04/08 마이그가 이미 widest 리스트로 확장했으나, 실행 순서/볼륨 상태와 무관하게 안전하도록 재보강.
DO $$
DECLARE
    cur_def text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO cur_def
      FROM pg_constraint c
     WHERE c.conname = 'qa_calls_department_chk'
       AND c.conrelid = 'public.qa_calls'::regclass;

    IF cur_def IS NULL OR cur_def NOT LIKE '%고객지원실%' THEN
        ALTER TABLE public.qa_calls DROP CONSTRAINT IF EXISTS qa_calls_department_chk;
        ALTER TABLE public.qa_calls ADD CONSTRAINT qa_calls_department_chk
            CHECK (department = ANY (ARRAY['컬렉션관리부'::text, '소비자보호부'::text, '고객센터'::text, '고객지원실'::text]));
    END IF;
END$$;

-- ── 2. organizations 에 코오롱 등록 + eval_item_defs 18항목 시드 ──────────────
-- name UNIQUE 제약 없음 → name NOT EXISTS 가드로 중복 등록 방지(id 는 SERIAL 자동 발번).
DO $$
DECLARE
    target_org_id integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE name = '코오롱') THEN
        INSERT INTO public.organizations (name, short, color, domain_id)
        VALUES ('코오롱', '코', '#005EB8', 1);

        -- 시퀀스 동기화 (02/04 선례) — SERIAL 자동발번 후 MAX(id) 기준 정렬.
        PERFORM setval('public.organizations_id_seq',
                       GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.organizations), 1));
    END IF;

    SELECT id INTO target_org_id
      FROM public.organizations
     WHERE name = '코오롱'
     LIMIT 1;

    IF target_org_id IS NULL THEN
        RAISE NOTICE '코오롱 브랜드 등록에 실패했습니다(organizations 조회 NULL). 시드를 건너뜁니다.';
        RETURN;
    END IF;

    -- eval_item_defs 18 항목 (server/defaultEvalItems.mjs SSOT).
    -- 07_eval_item_defs.sql 의 4-tuple UNIQUE (org_id, department, order_no, version).
    -- department 는 버전 스코프 marker — 신규 브랜드는 '기본' 단일 트랙.
    INSERT INTO public.eval_item_defs
        (org_id, order_no, category, item, criterion, prompt_template,
         department, version, effective_from, deactivated_at, updated_at)
    VALUES
        (target_org_id,  1, '인사 예절',        '첫인사',                       NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  2, '인사 예절',        '끝인사',                       NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  3, '경청 및 소통',     '경청 (말겹침/말자름)',         NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  4, '경청 및 소통',     '호응 및 공감',                 NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  5, '경청 및 소통',     '대기 멘트',                    NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  6, '언어 표현',        '정중한 표현',                  NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  7, '언어 표현',        '쿠션어 활용',                  NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  8, '니즈 파악',        '문의 파악 및 재확인(복창)',    NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id,  9, '니즈 파악',        '고객정보 확인',                NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 10, '설명력 및 전달력', '설명의 명확성',                NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 11, '설명력 및 전달력', '두괄식 답변',                  NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 12, '적극성',           '문제 해결 의지',               NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 13, '적극성',           '부연 설명 및 추가 안내',       NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 14, '적극성',           '사후 안내',                    NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 15, '업무 정확도',      '정확한 안내',                  NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 16, '업무 정확도',      '필수 안내 이행',               NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 17, '개인정보 보호',    '정보 확인 절차',               NULL, NULL, '기본', 1, now(), NULL, now()),
        (target_org_id, 18, '개인정보 보호',    '정보 보호 준수',               NULL, NULL, '기본', 1, now(), NULL, now())
    ON CONFLICT (org_id, department, order_no, version) DO NOTHING;

    RAISE NOTICE '코오롱(org_id=%) 등록 완료: 18 평가항목 시드. mock 콜 없음(표준 트랙 ingest 로 유입).', target_org_id;
END $$;

COMMIT;
