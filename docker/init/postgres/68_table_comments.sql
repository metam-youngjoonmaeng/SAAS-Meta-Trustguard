-- ============================================================
-- 68_table_comments.sql — 전 테이블 역할 주석 (2026-07-27)
-- ------------------------------------------------------------
-- 이름만으로 역할이 안 드러나는 테이블이 많아, DB 자체에 설명을 붙인다.
--   psql:  \dt+            → Description 열에 바로 표시
--          \d+ <테이블>    → 컬럼 주석까지
--   SQL :  SELECT relname, obj_description(oid) FROM pg_class WHERE relkind='r';
--
-- 테이블 개명(00) 과 달리 주석은 코드 영향이 0 이라 어떤 테이블에든 안전하게 붙일 수 있다.
-- 따라서 개명 스코프에서 제외한 계정·조직 코어에도 설명만은 부여한다.
--
-- 멱등: COMMENT ON 은 항상 덮어쓰기. 재실행 안전.
-- ============================================================

DO $$
DECLARE
    t text; c text;
    pairs text[][] := ARRAY[
    -- ── 조직·업종 ───────────────────────────────────────────────
    ['domains',                    '업종(도메인) 마스터. 브랜드의 상위 분류이며 신규 브랜드의 기본 평가항목·펜타곤축 템플릿 소유자.'],
    ['organizations',              '브랜드 = 멀티테넌시 최상위 단위. 콜·평가항목·상담사·스킬이 모두 org_id 로 이 테이블에 귀속.'],

    -- ── 평가기준(루브릭) 정의 ───────────────────────────────────
    ['eval_item_defs',             '브랜드별 평가항목(루브릭) 정의. 항목명·만점·기준문·LLM 판정 프롬프트. version 으로 이력 관리.'],
    ['rubric_change_log',          '루브릭 변경 이력(감사). target_kind 로 평가항목(item)/펜타곤축(axis) 구분. 생성/수정/폐기 시 before/after JSON 스냅샷 append. 구 eval_item_change_log + pentagon_axis_change_log 병합.'],
    ['pentagon_axes',              '브랜드별 펜타곤 5축 정성평가 축 정의. 축 라벨·설명·판정 프롬프트.'],
    ['domain_default_eval_items',  '업종 기본 평가항목 템플릿. 신규 브랜드 생성 시 eval_item_defs 로 복사되는 원본.'],
    ['domain_default_pentagon_axes','업종 기본 펜타곤 축 템플릿. 신규 브랜드 생성 시 복사되는 5축 원본.'],
    ['ksqi_item_defs',             '브랜드별 KSQI(한국형 상담품질지표) 항목 정의(번호·명칭·영역·대분류·배점·활성). 판정 방식(kind)은 여기 두지 않는다 — 원본은 채점 파이프라인 v2/nodes/ksqi_stt/rules.py 이고 카탈로그 API 가 거기서 직접 받는다(78).'],

    -- ── 콜 + 평가 결과 ─────────────────────────────────────────
    ['qa_calls',                   '콜(상담) 본체 — 전 평가 데이터의 루트. 콜 1건 = 1행. 점수·상담일시·검수상태·담당 상담사 보유.'],
    ['qa_call_transcript',         '콜 전사(대화 턴). 콜 1건당 N행. STT 결과를 순번·화자·발화로 정규화 적재.'],
    ['qa_call_item_score',         '항목별 평가 결과 — 점수와 근거를 함께 보유(구 evaluation_rows + checklist_rows 병합). '
                                   'max_score=NULL 은 총점 분모 제외(Y/N 가·부 항목).'],
    ['qa_call_pentagon_result',    '펜타곤 5축 정성 분석 결과. 콜 × 축(1~5). 축 정의는 pentagon_axes. 99 종합행은 읽기 시 합성하므로 미적재.'],
    ['qa_call_ksqi_score',         'KSQI 항목별 평가 결과 — 점수·판정 사유와 근거 발화(evidence jsonb)를 함께 보유. 일반 평가 qa_call_item_score 에 대응하는 별도 축.'],
    ['qa_call_ksqi_summary',       'KSQI 콜 단위 집계(콜당 1행). 영역 A/B 원점수·환산·등급 및 전체 점수. 콜 목록의 KSQI 필터·정렬이 이 테이블을 조인한다.'],
    ['qa_call_comment',            '콜별 관리자 코멘트 누적(jsonb 배열). 콜 상세 화면의 코멘트 영역.'],
    ['qa_call_confidence',         '콜별 AI 신뢰도 판정(사전계산). 항목별 불확실·근거취약·모순 플래그. 검수 우선순위 선별용.'],
    ['qa_call_review_event',       '콜 검수 이벤트 로그. 회차별 조치(제출/승인/이의/재검토)와 변경 항목 기록.'],
    ['qa_call_emotion_recovery',   '외부 TA 감정 세그먼트 기반 감정 회복 분석. 부정 감정 발생 후 상담사 회복 여부 집계.'],

    -- ── 검수·감사 ──────────────────────────────────────────────
    ['qa_audit_logs',              '시스템 감사 로그(API 액션 전반). 주체·경로·클라이언트·성공여부 기록. append-only.'],
    ['login_history',              '로그인 이력. 계정·시각·이벤트 종류. append-only.'],

    -- ── 골든셋·LLM 스킬 ────────────────────────────────────────
    ['qa_golden_set',              '골든셋(사람 확정 정답 라벨). RAG few-shot 예시 및 프롬프트 튜닝 기준 정답.'],
    ['qa_skill_store',             'LLM 스킬 저장소(루브릭별 1행). memory=검수 정정 자동학습 메모리, store=스킬 버전 스토어(배포 스왑 시 소실 방지). 구 qa_skill_memory + qa_skill_versions 병합.'],
    ['qa_skill_excluded',          '스킬 학습 제외 지정. 학습에 쓰지 않을 콜·항목 목록.'],

    -- ── 배치·판정 설정 ─────────────────────────────────────────
    ['qa_batch_configs',           '브랜드별 AI 평가 배치 조건(jsonb). 통화시간 게이트·평가 주기·학습 스케줄. org_id=0 은 전체 기본값.'],
    ['qa_batch_prompts',           '브랜드별 신뢰도 검증 LLM 판정 프롬프트. 미설정 시 코드 기본 프롬프트 사용.'],
    ['qa_batch_prompt_history',    '신뢰도 판정 프롬프트 변경 이력(append-only, 조회 전용).'],

    -- ── 코칭·알림 ──────────────────────────────────────────────
    ['coaching_assignments',       '상담사 코칭 과제(그룹/개인). 대상 멤버·액션아이템·시나리오 코드.'],
    ['coaching_assignment_reasons','코칭 배정 근거 콜 매핑. 배정과 특정 콜을 연결.'],
    ['notifications',              '사용자 알림(검수 요청·코칭 배정 등). 수신자별 적재, read_at 으로 읽음 처리.'],
    ['notification_prefs',         '사용자별 알림 수신 설정(jsonb).'],

    -- ── 계정·인증 ──────────────────────────────────────────────
    ['users',                      '사용자(계정) 마스터 — 인증 정체성 SSOT. 관리자·검수자·상담사 공용 로그인 계정.'],
    ['trainee_registrations',      '멤버십(사용자 × 브랜드). 상담사 명부이자 다중 소속의 핵심. 부서·역할·재직 상태 보유.'],
    ['auth_sessions',              '인증 세션 토큰(발급·만료·폐기). 형제 프로젝트 스키마 파리티용 — 현재 MTG 앱은 미사용.'],

    -- ── 외부 연동 상태 ─────────────────────────────────────────
    ['ics_qa_poll_watermark',      'ICS(mtm30) 폴링 진행 커서. proj_cd 별 마지막 적재 콜 종료시각·UID 로 재폴링 중복 방지.']
    ];
BEGIN
    FOR i IN 1 .. array_length(pairs, 1) LOOP
        t := pairs[i][1];
        c := pairs[i][2];
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('COMMENT ON TABLE public.%I IS %L', t, c);
        END IF;
    END LOOP;
END $$;

-- admin_users 는 VIEW 라 별도 처리
DO $$
BEGIN
    IF to_regclass('public.admin_users') IS NOT NULL THEN
        COMMENT ON VIEW public.admin_users IS
            '(뷰) users + 활성 trainee_registrations 조합 — 레거시 호환용. 구 코드의 login_id/user_id 접근 경로. 실 테이블 아님.';
    END IF;
END $$;
