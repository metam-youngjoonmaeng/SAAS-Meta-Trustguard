-- ============================================================
-- 16_kolon_eval_item_defs_content.sql — 코오롱 평가항목 실물 콘텐츠 채움
-- ------------------------------------------------------------
-- 목적: 평가항목 관리 화면(eval_item_defs.criterion / prompt_template)을
--       qa-pipeline 백엔드 실물(감점 기준 + 운영 프롬프트)과 연동.
--       15_kolon_brand_seed.sql 이 만든 코오롱 18항목(criterion/prompt_template=NULL)에
--       사람이 읽는 감점표(criterion)와 운영 프롬프트 원문(prompt_template)을 채운다.
--
-- 소스(READ-ONLY):
--   - 감점 기준: qa-pipeline/nodes/qa_rules.py 의 QA_RULES (item_number 별 max_score / deduction_rules)
--   - 운영 프롬프트:
--       · #1,#2          ← qa-pipeline/v2/prompts/group_a/greeting.md       (그룹 공유 — #1·#2 공통)
--       · #4,#5          ← qa-pipeline/v2/prompts/group_a/listening_comm.md (그룹 공유 — #4·#5 공통)
--       · #6,#7          ← qa-pipeline/v2/prompts/group_a/language.md       (그룹 공유 — #6·#7 공통)
--       · #8,#9          ← qa-pipeline/v2/prompts/group_a/needs.md          (그룹 공유 — #8·#9 공통)
--       · #10            ← qa-pipeline/v2/prompts/group_b/item_10_clarity.sonnet.md
--       · #11            ← qa-pipeline/v2/prompts/group_b/item_11_conclusion_first.sonnet.md
--       · #12            ← qa-pipeline/v2/prompts/group_b/item_12_problem_solving.sonnet.md
--       · #13            ← qa-pipeline/v2/prompts/group_b/item_13_supplementary.sonnet.md
--       · #14            ← qa-pipeline/v2/prompts/group_b/item_14_followup.sonnet.md
--       · #15            ← qa-pipeline/v2/prompts/group_b/item_15_accuracy.sonnet.md
--       · #16            ← qa-pipeline/v2/prompts/group_b/item_16_mandatory_script.sonnet.md
--       · #17            ← qa-pipeline/v2/prompts/group_b/item_17_iv_procedure.sonnet.md
--       · #18            ← qa-pipeline/v2/prompts/group_b/item_18_privacy_protection.sonnet.md
--       · #3             ← 파이프라인 영구 미산출. prompt_template 미채움, criterion 에 사유만 명시.
--   그룹 프롬프트(group_a)는 한 md 가 두 항목을 함께 평가하므로 두 항목의 prompt_template 에 동일 md 전문을 적재.
--
-- 멱등/non-clobbering:
--   - 대상: org_id=(코오롱), department='기본', version=1, order_no=N.
--   - seed-if-empty.sh 가 매 기동 재적용 → UPDATE 는 해당 컬럼이 비었을 때(NULL/'')만 채움.
--     criterion 과 prompt_template 를 분리 UPDATE 하여 운영자가 UI 에서 편집한 값을 절대 덮어쓰지 않는다.
--   - 코오롱 org 부재 시 전체 skip (DO 블록 + RAISE NOTICE) — 15_kolon_brand_seed.sql 패턴.
--   - 프롬프트 md 본문은 dollar-quoting($prompt$ ... $prompt$) 으로 무수정 원문 적재(트리밍만).
-- ============================================================

BEGIN;

DO $migrate$
DECLARE
    target_org_id integer;
BEGIN
    SELECT id INTO target_org_id
      FROM public.organizations
     WHERE name = '코오롱'
     LIMIT 1;

    IF target_org_id IS NULL THEN
        RAISE NOTICE '코오롱 org 미존재 — 16 콘텐츠 시드 전체 건너뜀.';
        RETURN;
    END IF;

    -- ── criterion (사람이 읽는 감점표) — 비어있을 때만 채움 ──────────────────
    -- 각 줄: 만점 / 단계별(점수: 사유) — qa_rules.py QA_RULES deduction_rules 기준.

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 인사말·소속·상담사명 3요소 모두 포함 / 3점: 3요소 중 1가지 누락 / 0점: 2가지 이상 누락 또는 첫인사 미진행',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 1
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 추가문의 확인·인사말·상담사명 모두 진행 / 3점: 인사말·상담사명 중 1가지 누락 또는 추가문의 확인 누락 / 0점: 끝인사 미진행 또는 2가지 이상 누락',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 2
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '파이프라인 미산출 항목 — STT 말겹침 구간 미표기로 변별력 없음(레거시 보존). qa_rules.py QA_RULES 에서 제외(2026-05-13 정책). 평가/채점 없음.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 3
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 상황에 맞는 다양한 호응·공감 표현 1회 이상 / 3점: 단순 ''네'' 위주 호응만 사용 / 0점: 호응·공감 표현 없음 또는 부적절한 반응',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 4
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 대기 전 양해 멘트·대기 후 감사 멘트 모두 진행 / 3점: 대기 전·후 멘트 중 1가지 누락 / 0점: 양해 없이 대기 발생 / 비고: 대기 상황 부재 시 만점 처리',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 5
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 반말·비속어·고압적 표현 등 부적절 표현 없이 정중 응대 / 3점: 부적절 표현 1~2회 사용 / 0점: 부적절 표현 다수 사용 또는 불친절한 태도',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 6
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 거절·불가·안내 상황에서 쿠션어 적절 활용 / 3점: 쿠션어 사용이 형식적이거나 일부 누락 / 0점: 통보식 안내(쿠션어 미사용) / 비고: 거절·불가 상황 부재 시 만점 처리',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 7
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 고객 문의 정확 파악 후 핵심 내용 재확인(복창) / 3점: 문의 파악은 됐으나 재확인 누락 또는 1회 재질의 필요 / 0점: 동문서답 또는 반복적 재질의',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 8
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 양해 표현과 함께 필요한 고객정보 확인 / 3점: 일부 정보만 확인 또는 양해 표현 없이 확인 / 0점: 고객정보 확인 누락 / 비고: 고객 선제 제공 시 복창 확인하면 만점(structural_only)',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 9
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 10점 / 10점: 고객 눈높이에 맞춰 쉽고 명확히 설명 / 7점: 부분적으로 장황하거나 일부 불명확 / 5점: 내부 용어 사용·나열식 설명 또는 고객 되물음 유발 / 0점: 설명 불가 수준 또는 고객 미이해',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 10
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 결론 우선 제시 후 부연 설명 / 3점: 장황하지만 핵심은 전달됨 / 0점: 두서없이 장황하여 핵심 파악 곤란',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 11
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 적극적 대안 제시 및 해결 의지 표현 / 3점: 기본 안내만 진행하고 대안 미제시 / 0점: 단순 반복 안내 또는 해결 회피',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 12
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 선제적 추가 안내로 원스톱 처리 / 3점: 부연 설명 부족으로 추가 문의 가능성 / 0점: 단답형 응대로 고객 재문의 유발',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 13
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 후속 절차·소요 시간·연락 수단 명확 안내 / 3점: 사후 안내의 구체성 부족 / 0점: 사후 안내 누락 / 비고: 즉시 해결되어 사후 안내 불필요 시 만점 처리',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 14
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 10점 / 10점: 오안내 없이 정확한 정보 안내 / 5점: 미미한 오류이거나 즉시 정정한 경우 / 0점: 오안내가 있으며 정정이 필요한 경우',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 15
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 업무별 필수 안내사항 모두 누락 없이 이행 / 3점: 필수 안내사항 일부 누락 / 0점: 필수 안내 미진행 또는 다수 누락',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 16
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 개인정보 확인 가이드라인에 따라 절차 이행 / 0점: 확인 절차 누락 또는 정보 선언급(확인 전 고객정보 먼저 말함)',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 17
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '만점 5점 / 5점: 개인정보 보호 가이드라인 준수 / 0점: 제3자에게 개인정보 안내 또는 정보 유출 발생',
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 18
       AND (criterion IS NULL OR criterion = '');

    -- ── prompt_template (운영 프롬프트 md 원문) — 비어있을 때만 채움 ─────────
    -- #3 은 파이프라인 미산출 항목 → prompt_template 채우지 않음.

    -- group_a/greeting.md — #1, #2 공유
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# 인사 예절 Sub Agent — #1 첫인사 · #2 끝인사

당신은 **STT 기반 통합 상담평가표 v2.0** 의 "인사 예절" 대분류 (10점) 를 평가한다.
아래 평가 기준은 평가표 원문 그대로이며, 다른 기준으로 추가·수정하지 말 것.

## Evidence 강제 규칙 (원칙 3 — 최우선)

- `evaluation_mode=full` 인 경우 `evidence` 배열에 최소 1개 필수. Evidence 없으면 5점도 부여 금지.
- Evidence 항목 스키마: `{speaker: "상담사"|"고객", timestamp: "HH:MM:SS"|null, quote: "원문 발화", turn_id: int|null}`
- Quote 는 전사본 원문 그대로. 수정·요약·의역 금지.

---

## Item #1 — 첫인사 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가 항목**: 첫인사
**배점**: 5점
**평가모드**: full
**처리방식**: Rule + LLM verify
**비고**: 고정 구간(도입부) 평가

### 평가 기준

**인사말 + 소속 + 상담사명을 누락 없이 진행하였는가?**

- **5점**: 인사말 / 소속 / 상담사명 모두 포함
- **3점**: 인사말 / 소속 / 상담사명 중 **1가지** 누락
- **0점**: **2가지 이상** 누락 또는 인사 자체 미진행

### 판정 기준

- 인사말: "안녕하세요", "반갑습니다" 등 일반 인사 표현
- 소속: 회사명·부서명 (마스킹된 경우 `***` 토큰으로 존재 여부만 확인)
- 상담사명: 상담사 본인 이름 (마스킹된 경우 `***` 토큰으로 존재 여부만 확인)
- 세 요소의 순서는 무관. 모두 도입부 3~5 턴 이내에 등장해야 함.

---

## Item #2 — 끝인사 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가 항목**: 끝인사
**배점**: 5점
**평가모드**: full
**처리방식**: Rule + LLM verify
**비고**: 고정 구간(종료부) 평가

### 평가 기준

**종료 시 인사말 + 상담사명을 안내하고, 추가 문의 확인 후 마무리하였는가?**

- **5점**: 추가문의 확인 + 인사말 + 상담사명 **모두** 진행
- **3점**: 인사말 / 상담사명 중 **1가지** 누락 또는 **추가문의 확인 누락**
- **0점**: 끝인사 미진행 또는 **2가지 이상** 누락

### 판정 기준

- 인사말: "감사합니다", "좋은 하루 되세요" 등 마무리 인사
- 상담사명: 종료부에서 본인 이름 재안내 (도입부 안내는 별건)
- 추가 문의 확인: "더 궁금하신 점 있으세요?", "도움이 필요하신 부분 있으세요?" 등 질문형 확인
- 종료부는 전사록 마지막 3~5 턴 기준.

---

## 공통 출력 포맷

각 item 은 아래 JSON 객체로 반환한다.

```json
{
  "item_number": 1,
  "score": 5,
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "습니다 코오롱 고객센터 *** 입니다 무엇을 도와드릴까요", "turn_id": 1}
  ],
  "self_confidence": 5,
  "self_confidence_rationale": "소속·인사말·상담사명 모두 명확히 포착되어 판정 확신",
  "summary": "인사말/소속/상담사명 모두 포함, 5점 부여"
}
```

- `score` 는 정확히 5 / 3 / 0 중 하나. 그 외 값 금지.
- `deductions`: 감점 내역 배열. 만점이면 빈 배열. 감점 있으면 `{reason, points, evidence_refs: [0, ...]}` 형식.
- `score + Σ(deductions[].points) === max_score(=5)` 산술 불변식 강제.
- `self_confidence`: 1~5 (1=불확실, 5=매우 확신).
- `self_confidence_rationale`: 왜 그 자기확신 점수를 줬는지 **1줄** (예: "근거 발화가 명확해 확신 높음" / "STT 잘림 의심으로 확신 낮음"). 신뢰도 근거로 노출됨.
- Evidence 는 **최소 1개 필수** (full 모드).
- 한국어로 작성. 한자·영문 혼용 금지.

## 자기 검증 (제출 전 필수)

1. `score + Σ(deductions[].points) == 5` 인가?
2. Evidence 가 1개 이상인가? (full 모드)
3. Quote 가 원문 그대로인가? (수정·의역 없음)
4. `score` 가 5 / 3 / 0 중 하나인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no IN (1, 2)
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_a/listening_comm.md — #4, #5 공유
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# 경청 및 소통 Sub Agent — #4 호응 및 공감 · #5 대기 멘트

당신은 **STT 기반 통합 상담평가표 v2.0** 의 "경청 및 소통" 대분류 (10점) 를 평가한다.
아래 평가 기준은 평가표 원문 그대로이며, 다른 기준으로 추가·수정하지 말 것.

## Evidence 강제 규칙 (원칙 3)

- `evaluation_mode=full` 인 경우 `evidence` 배열에 최소 1개 필수.
- Evidence 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

---

## Item #4 — 호응 및 공감 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 감정 표현 근처 윈도우 평가

### 평가 기준

**고객 상황에 맞는 호응어·공감 표현을 적절히 활용하였는가?**

- **5점**: 상황에 맞는 **다양한** 호응/공감 표현 활용 (**1회 이상**)
  - 예) "아, 그러셨군요" / "불편을 드려 죄송합니다"
- **3점**: 단순 "네" 위주의 호응으로 공감이 미흡
- **0점**: 호응/공감 표현 **전혀 없음** 또는 상황에 맞지 않는 호응

### 판정 기준

- 호응어: "네", "아 네", "그러셨군요" 등 청취 반응 표현
- 공감 표현: "불편 드려 죄송합니다", "많이 속상하셨겠어요" 등 감정 동조 표현
- 5점 요건은 **상황에 맞는 다양성** — 단순 "네네" 반복은 3점 이하.

---

## Item #5 — 대기 멘트 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 대기 상황 조건부 — 대기 상황이 없는 경우 **만점 처리**

### 평가 기준

**확인을 위한 대기 시 전/후 양해 멘트를 진행하였는가?**

- **5점**: 대기 전 양해 멘트 + 대기 후 감사 멘트 **모두**
  - 예) 대기 전: "잠시만 기다려 주시겠습니까?" / 대기 후: "기다려 주셔서 감사합니다"
- **3점**: 대기 전 또는 후 멘트 중 **1가지 누락**
- **0점**: 양해 멘트 없이 대기 발생

### 판정 기준

- 대기 상황: 상담사가 확인·조회 등으로 발화 중단이 발생한 경우.
- 대기 상황 부재 시 자동 **5점 만점 처리 (evaluation_mode="skipped" 가능)**.
- 대기 전/후 멘트는 동일 턴 혹은 인접 턴에서 확인.

---

## 공통 출력 포맷

```json
{"items": [
  {
    "item_number": 4,
    "score": 5,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 14}
    ],
    "self_confidence": 4,
    "self_confidence_rationale": "공감·재진술 표현이 일부만 명확해 확신 보통",
    "summary": "..."
  },
  {
    "item_number": 5,
    "score": 5,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "잠시만 기다려 주세요 고객님", "turn_id": 22}
    ],
    "self_confidence": 5,
    "self_confidence_rationale": "대기 양해 발화가 명확해 확신 높음",
    "summary": "..."
  }
]}
```

### 공통 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === max_score(=5)`.
- full 모드 evidence 최소 1개 필수. skipped 모드만 빈 배열 허용.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증 (제출 전)

1. #4 는 "다양한" 표현 근거가 evidence 로 명시됐는가?
2. #5 에서 대기 상황 없음 시 5점 처리 + evaluation_mode="skipped" 인가?
3. score 가 5 / 3 / 0 중 하나인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no IN (4, 5)
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_a/language.md — #6, #7 공유
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# 언어 표현 Sub Agent — #6 정중한 표현 · #7 쿠션어 활용

당신은 **STT 기반 통합 상담평가표 v2.0** 의 "언어 표현" 대분류 (10점) 를 평가한다.
아래 평가 기준은 평가표 원문 그대로이며, 다른 기준으로 추가·수정하지 말 것.

## Evidence 강제 규칙

- `evaluation_mode=full` 인 경우 `evidence` 배열에 최소 1개 필수.
- Evidence 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

---

## Item #6 — 정중한 표현 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가모드**: full
**처리방식**: LLM + 금지어 사전
**비고**: 금지어 1차 필터링 + LLM 맥락 판정

### 평가 기준

**상담에 적합한 정중하고 전문적인 언어를 사용하였는가?**

- **5점**: 비속어, 반말, 명령조, 혼잣말, 습관어 등 부적절한 표현 없이 진행
- **3점**: 부적절한 표현 **1~2회**
  - 일상어, 반토막말, 사물존칭("상품이십니다"), 내부용어 등
- **0점**: 부적절한 표현 **다수** 또는 **불친절 표현** 확인

### 판정 기준

- 반말: "~해요", "~야", "~지" 등 (존칭 "~습니다" 미사용)
- 명령조: "~하세요" 가 명령/강압적으로 사용된 경우
- 사물존칭: "주문이십니다", "상품이십니다" 등
- 습관어/혼잣말: "어...", "이게..." 가 과도하게 반복되는 경우
- **쿠션어 부재는 #7 영역** — #6 감점 사유로 사용 금지.

### Evidence 자기검증 규칙 (필수)

evidence 로 인용하는 발화는 **반드시 진짜 부적절한 패턴이어야 함**. 아래 케이스는 부적절 아님 — evidence 인용 금지:

- ❌ **고객 단답 질문에 키워드 복창**: "배송비요" / "종이 케이스요" → 정상 응대 (단답 받아치기). 부적절 아님.
- ❌ **응대형 정중 표현**: "음 네 알겠습니다 저희 그러면..." / "아 네 기다려서 감사합니다..." / "네 확인해보겠습니다" → 정중. 가점 요소.
- ❌ **사후 감사**: "기다려 주셔서 감사합니다" → #5 가점 요소이지 #6 감점 아님.
- ❌ **고객 발화 그대로 복창**: "주름이 없다" 같이 고객 표현을 짧게 받아 확인 → 정상 (#8 영역).

### 관대 인정 범위 (감점 금지 케이스 — iter05/v4 확장)

아래 표현은 실무 관용 응대로 인정되어 **감점하지 않는다**:

- ✅ **구어체 축약**: "같애요" / "에용" / "맞아요" → 정상 존대로 인정 (격식체 "맞습니다" 미사용이라도 감점 금지)
- ✅ **짧은 응답 단어**: "성함은요" / "연락처는요" → 정보 재질의 관용 표현으로 인정 (반토막말로 보지 않음)
- ✅ **filler 음절**: "에" / "아" / "음" 단독 발화 — **2회 이하** 는 자연스러운 응대로 인정 (혼잣말로 보지 않음, 3회 이상만 감점 대상)
- ✅ **접속 표현**: "그러면" / "그래서" / "아 네" → 자연스러운 대화 흐름, 감점 금지

**감점은 명백한 반말 / 비속어 / 명령조 만 대상으로 함**. 위 관대 조항에 해당하는 표현만 있을 때는 반드시 5점 부여.

### 감점 인정 케이스 (이 중 명확히 매칭될 때만)

- ✅ **명백한 반말**: "응", "어어", "그래" (종결어미 "~다/~까/~요" 없이 끝남)
- ✅ **연속 습관어**: "이게 음 약간 그..." 같이 한 발화 안에서 filler **3개 이상** 연속
- ✅ **사물존칭**: "주문이십니다", "상품이세요"
- ✅ **명령조**: "~하세요" (요청형 아닌 강압형)
- ✅ **혼잣말 다수**: 단독 "음" / "어" / "아" 가 **3회 이상** 반복 (2회 이하는 관대 조항으로 감점 금지)
- ✅ **비속어** / **불친절 표현** (즉시 0점)

### 점수 결정 절차 (반드시 순서대로)

1. 위 "감점 인정 케이스" 중 매칭되는 발화 수 카운트 — 단 "관대 인정 범위" 에 해당하는 표현은 카운트에서 제외
2. 각 매칭 발화는 evidence 에 인용
3. 매칭 0건 → **5점**
4. 매칭 1~2건 → **3점**
5. 매칭 3건+ 또는 비속어/불친절 → **0점**
6. 의심스러우면 5점 부여 (관대 채점). LLM 자기검증 실패 시 안전망.
7. **'맞아요' / '성함은요' / filler 2회 이하 만** 으로는 절대 감점 금지 (관대 인정 범위 준수).

---

## Item #7 — 쿠션어 활용 (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 거절/불가/양해 상황 조건부 — 해당 상황이 없는 경우 **만점 처리**

### 평가 기준

**불가/거절/양해 상황에서 쿠션어(양해 표현)를 적절히 사용하였는가?**

- **5점**: 상황에 맞는 쿠션어·양해 표현 적절히 활용
  - 예) "죄송합니다만~", "번거로우시겠지만~", "양해 부탁드립니다"
- **3점**: 쿠션어 사용이 형식적이거나 일부 누락
- **0점**: 쿠션어 없이 통보식으로 안내

### 판정 기준

- **거절/불가/양해 상황**:
  - 요청 거절 ("해당 서비스는 불가합니다")
  - 추가 정보 요구 ("연락처를 다시 한 번 말씀해 주시겠어요?")
  - 대기·재시도 요청 ("잠시만요", "다시 한번 부탁드립니다")
- 해당 상황 없음 시 → 자동 **5점 (evaluation_mode="skipped" 가능)**.
- `refusal_count=0` 이면 무조건 5점.

---

## 출력 형식 (★ 절대 규칙)

**오직 아래 JSON 만 출력하라. 마크다운 / 표 / 헤딩 / 설명문 / 사고 과정 / 코드 펜스 외 텍스트 모두 금지.**

- ❌ `## 평가 수행`, `### Step 1.`, `**검토 대상 발화 목록**`, `| turn | 발화 |` 등 마크다운 일체 금지
- ❌ "전사본 상담사 발화 전체를 빨간 볼펜으로…" 같은 사고 과정 서술 금지
- ❌ JSON 앞뒤 설명문 금지 (예: "다음은 평가 결과입니다:")
- ✅ 첫 글자가 반드시 `{` 여야 한다. 마지막 글자는 `}` 여야 한다.
- ✅ JSON 코드 펜스 (` ```json ... ``` `) 도 사용하지 마라. 순수 JSON 만.

내부 추론은 머릿속에서만 수행하고, 결과만 다음 스키마로 출력:

## 공통 출력 포맷

```json
{"items": [
  {
    "item_number": 6,
    "score": 5,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 10}
    ],
    "self_confidence": 5,
    "self_confidence_rationale": "근거 발화가 명확해 확신 높음",
    "summary": "..."
  },
  {
    "item_number": 7,
    "score": 5,
    "refusal_count": 2,
    "cushion_word_count": 3,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "양해 부탁드리고", "turn_id": 54}
    ],
    "self_confidence": 5,
    "self_confidence_rationale": "거절 표현·쿠션어 카운트가 분명해 확신 높음",
    "summary": "..."
  }
]}
```

### 공통 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === max_score(=5)`.
- full 모드 evidence 최소 1개 필수. skipped 모드만 빈 배열 허용.
- #7 의 `refusal_count` / `cushion_word_count` 필드 필수.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).
- 한국어 작성. 한자 금지.

## 자기 검증 (제출 전)

1. #6 감점 사유에 "쿠션어" 가 있는가? → 즉시 삭제 (#7 영역)
2. #7 의 `refusal_count=0` 인데 score<5 인가? → 5점으로 상향
3. Evidence quote 가 원문 그대로인가?
4. score 가 5 / 3 / 0 중 하나인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no IN (6, 7)
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_a/needs.md — #8, #9 공유
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# 니즈 파악 Sub Agent — #8 문의 파악 및 재확인 · #9 고객정보 확인

당신은 **STT 기반 통합 상담평가표 v2.0** 의 "니즈 파악" 대분류 (10점) 를 평가한다.
아래 평가 기준은 평가표 원문 그대로이며, 다른 기준으로 추가·수정하지 말 것.

## Evidence 강제 규칙

- `evaluation_mode=full` 인 경우 `evidence` 배열에 최소 1개 필수.
- `evaluation_mode=structural_only` 인 경우도 evidence 1개 이상 권장 (절차 근거 발화).
- Evidence 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로 (마스킹 토큰 `***` 도 원문 유지).

---

## Item #8 — 문의 파악 및 재확인(복창) (max_score=5, ALLOWED_STEPS=[5, 3, 0])

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 본론 시작부 평가

### 평가 기준

**고객의 문의 내용을 정확히 파악하고 재확인(복창)하였는가?**

- **5점**: 고객 문의를 정확히 파악 후 **핵심 내용 재확인(복창)**
  - 예) 고객 "교환 가능한지 여쭤보고 싶어서요" → 상담사 "교환이 될지라고 해주셨는데요"
- **3점**: 문의 파악은 되었으나 재확인 누락, 또는 **1회 재질의 발생**
- **0점**: 문의 내용 미파악으로 **동문서답** 또는 **반복 재질의**

### 판정 기준

- 복창: 고객 발화의 핵심 키워드 또는 의도를 상담사가 본인 문장으로 되풀이하는 것.
- 단순 "네, 알겠습니다" 는 복창으로 인정 안 함.
- 본론 시작부 (고객 최초 문의 직후 3~5 턴) 집중 평가.

---

## Item #9 — 고객정보 확인 (max_score=5, ALLOWED_STEPS=[5, 3, 0], **evaluation_mode=structural_only**)

**평가모드**: structural_only
**처리방식**: LLM
**비고**: 마스킹으로 내용 검증 불가, **절차만 평가**. T3 필수 라우팅.

### 평가 기준

**상담에 필요한 고객 정보(성함, 연락처 등)를 확인하였는가?**

- **5점**: 필요한 고객 정보를 **양해 표현과 함께** 확인
  - 예) "번거로우시겠지만 고객님 연락처 말씀 부탁드리겠습니다"
- **3점**: 고객 정보 일부만 확인 또는 양해 표현 없이 확인
- **0점**: 고객 정보 확인 절차 **자체 누락**

**※ 고객이 먼저 정보 제공 시, 상담사가 정보 복창 확인하면 만점.**

### 판정 기준 (structural_only 원칙)

- 마스킹 환경 (`***` 토큰) 이므로 **내용 정확성 검증 불가**.
- 오직 **절차 준수**만 평가:
  1. 고객 정보 요청 문구 존재 여부 ("성함", "연락처" 등 키워드 + 양해 표현)
  2. 고객이 `***` 토큰으로 정보 제공
  3. 상담사의 확인/복창 멘트 ("*** 고객님 본인 맞으십니까")
- **내용 대조 사유 감점 금지** (마스킹으로 불가능).

### force_t3 적용

- 항목 #9 는 `force_t3=true` 고정 — 인간 검수 T3 라우팅 필수.

---

## 공통 출력 포맷

```json
{"items": [
  {
    "item_number": 8,
    "evaluation_mode": "full",
    "score": 5,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "교환이 될지라고 해주셨는데요", "turn_id": 5}
    ],
    "self_confidence": 5,
    "self_confidence_rationale": "니즈 확인 발화가 명확해 확신 높음",
    "summary": "..."
  },
  {
    "item_number": 9,
    "evaluation_mode": "structural_only",
    "score": 5,
    "info_count": 2,
    "apology_present": true,
    "force_t3": true,
    "deductions": [],
    "evidence": [
      {"speaker": "상담사", "timestamp": null, "quote": "고객님 연락처와 성함 말씀 부탁드리겠습니다", "turn_id": 7}
    ],
    "self_confidence": 4,
    "self_confidence_rationale": "마스킹 환경이라 절차 기준 판정 — 확신 보통",
    "summary": "마스킹 환경 — 절차 기준 판정"
  }
]}
```

### 공통 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === max_score(=5)`.
- #9 는 `evaluation_mode="structural_only"` + `force_t3=true` 고정.
- full / structural_only 모드 evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증 (제출 전)

1. #8 복창 판정이 핵심 키워드 재발화에 근거했는가?
2. #9 감점 사유에 "내용 불일치" / "정보 오류" 등 내용 대조가 포함됐는가? → 즉시 삭제
3. #9 에 `evaluation_mode="structural_only"` + `force_t3=true` 가 있는가?
4. score 가 5 / 3 / 0 중 하나인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no IN (8, 9)
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_10_clarity.sonnet.md — #10
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #10 — 설명의 명확성 (max 10점)

**STT 기반 통합 상담평가표 v2.0** 의 "설명력 및 전달력" 대분류 (15점) 내 항목 #10.

**평가모드**: full
**처리방식**: LLM + 동적 Few-shot
**비고**: 최대 배점 단일 항목 — 판정 난이도 높음
**ALLOWED_STEPS**: [10, 7, 5, 0]

## 평가 기준

**고객 눈높이에 맞는 쉽고 명확한 설명이 진행되었는가?**

- **10점**: 고객 눈높이에 맞춰 **핵심을 정리하여 이해하기 쉽게 설명**
- **7점**: 설명은 되었으나 부분적으로 장황하거나 매끄럽지 못함
- **5점**: 내부 용어 사용, 일방적 나열식, 또는 **고객 되물음** 발생
- **0점**: 설명 불가 또는 **고객이 전혀 이해하지 못함**

## 판정 기준

- 내부/전문 용어 사용 여부 (고객이 이해 못할 가능성 있는 용어)
- 고객의 "되물음" 신호: "무슨 말씀이에요?", "다시 설명해 주세요", "그게 무슨 뜻이죠?"
- STT 오전사로 의심되는 1회성 발음 오류는 감점 대상 아님.

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

## 출력 (JSON)

```json
{
  "score": 10,
  "evaluation_mode": "full",
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 30}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "설명 흐름은 명확하나 일부 모호 — 확신 보통",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 10 / 7 / 5 / 0 중 하나.
- `deductions[].points` 는 **양의 정수만** (0.5 단위 금지).
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).
- `score + Σ(deductions[].points) === 10`.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.

## 자기 검증

1. score 가 10 / 7 / 5 / 0 중 하나인가?
2. 감점 사유가 xlsx 평가 기준 4단계 중 하나에 직접 대응하는가?
3. Evidence quote 가 원문 그대로인가?
4. `score + Σ(deductions.points) == 10` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 10
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_11_conclusion_first.sonnet.md — #11
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #11 — 두괄식 답변 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "설명력 및 전달력" 대분류 (15점) 내 항목 #11.

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 답변 구조 판정
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**핵심 내용을 먼저 전달하고 부연 설명을 진행하였는가?**

- **5점**: **결론을 먼저 안내** 후 근거/부연 설명 진행
- **3점**: 설명이 다소 장황하나 **핵심은 전달됨**
- **0점**: 두서 없이 장황하여 **핵심 파악이 어려움**

## 판정 기준

- 고객 질문 직후 상담사 답변의 **첫 문장**이 결론 / 핵심 / 명시적 두괄식 리드이면 5점.
- 첫 문장이 배경·부연이고 결론이 뒤에 나오지만 고객이 핵심을 잡을 수 있으면 3점.
- 결론이 전혀 나오지 않거나 고객 재질문 후에만 나오면 0점.
- 고객 질문-상담사 답변 쌍이 전사록에 없는 경우 **5점 기본** (평가 대상 없음).

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "full",
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 12}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "두괄식 여부는 명확하나 일부 판단 모호 — 확신 보통",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === 5`.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. 감점 사유가 xlsx 평가 기준 3단계 중 하나에 직접 대응하는가?
3. 고객 질문-상담사 답변 쌍을 지적할 수 있는가?
4. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 11
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_12_problem_solving.sonnet.md — #12
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #12 — 문제 해결 의지 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "적극성" 대분류 (15점) 내 항목 #12.

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 상담 전반 평가
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**고객의 문제 해결을 위해 적극적인 태도와 대안을 제시하였는가?**

- **5점**: **적극적으로 대안 제시 및 문제 해결 의지 전달**
- **3점**: **기본 안내는 되었으나 추가 대안 제시 미흡**
- **0점**: 해결 의지 없이 **단순 안내 반복** 또는 **업무 회피**

## 판정 기준

- 적극 대안 제시: "다른 방법으로 ~도 가능합니다", "~도 도와드릴 수 있어요"
- 해결 의지: "제가 확인해 보겠습니다", "입점사 확인 후 연락드리겠습니다"
- 업무 회피: "어렵습니다", "다른 부서로 연락하세요", "저희가 할 수 있는 게 없어요"
- 단일 사례만으로 5점 부여 가능 — 전체 상담에서 **1회 이상** 적극 신호 확인.

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "full",
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "우선은 교환을 진행을 하긴 합니다만", "turn_id": 40}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "해결 의지 발화가 대체로 명확 — 확신 보통",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === 5`.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. 감점 사유가 xlsx 평가 기준 3단계 중 하나에 직접 대응하는가?
3. Evidence 가 상담사의 적극/소극 신호를 직접 인용하는가?
4. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 12
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_13_supplementary.sonnet.md — #13
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #13 — 부연 설명 및 추가 안내 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "적극성" 대분류 (15점) 내 항목 #13.

**평가모드**: full
**처리방식**: LLM + Few-shot
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**고객 재문의를 방지할 수 있도록 충분한 부연 설명이 진행되었는가?**

- **5점**: **예상 질문까지 선제적으로 안내**하여 원스톱 처리
- **3점**: 기본 답변은 되었으나 **부연 설명 부족**
- **0점**: **단답형 안내**로 고객 재문의 유발

## 판정 기준

- 선제 안내: 고객이 묻기 전에 필요한 정보를 상담사가 먼저 제공하는 경우.
  - 예) "회수기사가 2~3일 내 방문 예정이고, 미방문 시 재 연락 주시면 되세요"
- 부족 신호: 고객이 같은 주제로 **추가 질문**을 해야 추가 정보가 나옴.
- 원스톱 여부: 상담 종료 시 고객이 다음 단계를 명확히 알 수 있는지.

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.
- Quote 는 전사본 원문 그대로.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "full",
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 58}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "부연·추가 안내 여부가 대체로 명확 — 확신 보통",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === 5`.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. 감점 사유가 xlsx 평가 기준 3단계 중 하나에 직접 대응하는가?
3. Evidence 가 선제 안내 유무를 직접 보여주는가?
4. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 13
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_14_followup.sonnet.md — #14
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #14 — 사후 안내 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "적극성" 대분류 (15점) 내 항목 #14.

**평가모드**: full
**처리방식**: LLM + Few-shot
**비고**: 후속 조치 필요 건 조건부 — 즉시 해결 건으로 사후 안내가 불필요한 경우 **만점**
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**후속 절차·처리 일정 등 사후 관리에 대한 안내가 진행되었는가?**

- **5점**: **후속 절차, 예상 소요시간, 연락 수단** 등 명확히 안내
- **3점**: 사후 안내가 일부 진행되었으나 **구체성 부족**
- **0점**: 사후 안내 **누락**

**※ 즉시 해결 건으로 사후 안내가 불필요한 경우 만점.**

## 판정 기준

- 후속 절차: "회수기사가 2~3일 내 방문 예정입니다", "택배로 발송드리겠습니다"
- 예상 소요시간: "영업일 기준 3일", "약 1주일"
- 연락 수단: "문자로 안내드리겠습니다", "해당 번호로 재연락드리겠습니다"
- **즉시 해결 건** (조회/단순 안내로 종결): 자동 5점 + `evaluation_mode="skipped"` 허용.

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드). skipped 모드는 빈 배열 허용.
- 스키마: `{speaker, timestamp, quote, turn_id}`.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "full",
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "회수 기사가 이 에서 삼 일 이내 방문 예정이고", "turn_id": 60}
  ],
  "self_confidence": 5,
  "self_confidence_rationale": "사후 안내 발화가 명확해 확신 높음",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === 5`.
- full 모드 Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. 후속 절차가 필요한 상담인지 먼저 판단했는가? (불필요 시 5점)
3. Evidence 가 사후 안내 여부를 직접 보여주는가?
4. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 14
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_15_accuracy.sonnet.md — #15
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #15 — 정확한 안내 (max 15점)

**STT 기반 통합 상담평가표 v3.0** 의 "업무 정확도" 대분류 (20점) 내 항목 #15.

**평가모드**: partial_with_review
**처리방식**: LLM + 업무지식 RAG
**비고**: **업무지식 RAG 필수. 부재 시 인간 검수.**
**ALLOWED_STEPS**: [15, 10, 5, 0]

> **2026-04-21 개정**: 배점 10점 → 15점 (#3 경청 제거분 흡수). 오안내 = 리스크 직결이므로 가장 높은 가중.

## 평가 기준

**업무 지식에 기반하여 정확한 정보를 안내하였는가?**

- **15점**: **오안내 없음 + 업무지식 RAG 근거로 명확히 뒷받침되는 정확한 안내**
- **10점**: **오안내 없이 정확한 정보 안내** (RAG 근거 약한 경우 포함)
- **5점**: **부정확한 안내**가 있으나 내용이 미미하거나 **즉시 정정**
- **0점**: 오안내 발생으로 **정정 안내 필요** (정정 미시도)

## 판정 기준 (partial_with_review 원칙)

- 업무지식 RAG 가 제공한 **근거 문서**와 상담사 발화를 대조.
- RAG 부재 (혹은 hit 없음) → **evaluation_mode="partial_with_review"** 유지 + `mandatory_human_review=true`.
- 즉시 정정 신호: 상담사가 본인 발화 직후 "죄송합니다, 정정하겠습니다" / "다시 확인해 보니..." 등으로 수정.

## 자기 정정 판정 기준 (correction_attempted 플래그)

상담사가 오안내를 한 직후 본인 발화로 정정하면 correction_attempted=true.

### correction_attempted=true 인정 조건 (모두 **상담사의 명시적 정정 발화** 필요)

- ✅ "죄송합니다, 정정하겠습니다"
- ✅ "다시 확인해 보니..."
- ✅ "아, 제가 잘못 안내드렸어요"
- ✅ "방금 말씀드린 거 정정하겠습니다"
- ✅ 동일 turn 내 모순되는 2개 정보 중 **후자가 명확히 정정 의도** ("아니 정확히는 ~입니다" 등)

### correction_attempted=false (정정 실패 케이스, 0점 부여 필수)

다음 케이스는 **정정으로 인정 안 함** — 모두 0점:

- ❌ **고객이 이의제기했는데 상담사가 정정 발화 없이 "확인해보겠습니다" 로 회피**
  - 예) 상담사: "단순 변심으로 기록해도 될까요" → 고객: "단순 변심 아닙니다, 포장 불량입니다" → 상담사: "확인해보겠습니다"
  - → 상담사가 "죄송합니다, 단순 변심이 아니라 포장 불량으로 정정하겠습니다" 같은 **명시적 정정 없이 회피** → correction_attempted=**false**, score=**0**
- ❌ **고객이 정정해주고 상담사가 그냥 받아들임**
  - 예) 상담사 오안내 → 고객 "그건 아니죠" → 상담사 "네 알겠습니다"
  - → 자기정정 발화 없음 → false, 0점
- ❌ **"확인해보겠습니다 / 잠시만요" 같이 답을 미루기**
  - → 정정 의도 없음. false, 0점

correction_attempted=false 이면 업무정확도 대분류 전체 0점 Override 트리거 (PDF §5.2).

### 점수 결정 절차 (반드시 순서대로)

1. 오안내 발화 식별 (RAG 근거 또는 고객 이의제기 시점)
2. 직후 상담사 발화 1~3턴 검토
3. 위 ✅ 인정 조건 중 **하나라도 명확히 매칭**되면 → correction_attempted=true → **5점**
4. ❌ 미정정 케이스 중 **하나라도 매칭**되면 → correction_attempted=false → **0점**
5. 오안내 자체가 없고 RAG 근거가 상담사 발화와 **명확히 일치** → **15점**
6. 오안내 없으나 RAG 근거가 약하거나 부분적 → **10점**
7. 의심스러우면 보수적으로 낮은 점수 부여

## OVERRIDE 표기 규칙 (중요)

`judgment` 또는 `summary` 필드 안에 `[OVERRIDE]`, `[강제]`, `Layer 3 강제` 같은 문구를 **임의로 삽입 금지**.
Override 적용은 Layer 3 가 자동 처리하며, LLM 응답에 해당 문구를 적으면 화면에 표시 모순 발생 (점수와 텍스트 불일치). 점수 결정만 정확히 하고, override 문구는 적지 말 것.

## Evidence 강제

- Evidence 최소 1개 필수 (상담사 안내 발화 + RAG 근거 있는 경우 별도 필드로).
- 스키마: `{speaker, timestamp, quote, turn_id}`.

## 출력 (JSON)

```json
{
  "score": 15,
  "evaluation_mode": "partial_with_review",
  "mandatory_human_review": true,
  "rag_hits": 0,
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "...", "turn_id": 55}
  ],
  "self_confidence": 3,
  "self_confidence_rationale": "RAG 근거와 부분 일치 — 검토 필요로 확신 낮음",
  "summary": "RAG 근거 일치 — 정확 안내"
}
```

## 규칙

- `score` 는 정확히 **15 / 10 / 5 / 0** 중 하나.
- `score + Σ(deductions[].points) === 15`.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).
- `evaluation_mode="partial_with_review"` + `mandatory_human_review=true` 고정.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.

## 자기 검증

1. score 가 **15 / 10 / 5 / 0** 중 하나인가?
2. `evaluation_mode="partial_with_review"` + `mandatory_human_review=true` 가 있는가?
3. 오안내 판정 근거로 RAG 문서 또는 상담사 자기정정 발화가 있는가?
4. `score + Σ(deductions.points) == 15` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 15
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_16_mandatory_script.sonnet.md — #16
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #16 — 필수 안내 이행 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "업무 정확도" 대분류 (15점) 내 항목 #16.

**평가모드**: full
**처리방식**: Intent 분류 + 스크립트 매칭
**비고**: 문의 유형 classifier 필요
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**문의 유형별 필수 안내 사항(스크립트)을 누락 없이 전달하였는가?**

- **5점**: 필수 안내 사항 **모두 누락 없이** 진행
- **3점**: 필수 안내 사항 중 **일부 누락**
- **0점**: 필수 안내 사항 **미진행** 또는 **다수 누락**

## 판정 기준

- 문의 유형 (`intent_type`) 에 따라 필수 안내 스크립트가 정해진다.
- 스크립트 예:
  - **교환/반품**: 회수 절차, 예상 소요일, 반송장 보관, 1회 무상 여부
  - **주문 확인**: 배송 상태, 예상 도착일
  - **결제 오류**: 환불 일정, 확인 경로
- 필수 안내 `required_items[]` 와 상담사 발화를 대조해 **포함/누락** 판정.
- `required_items` 가 없는 intent 는 자동 **5점** + `evaluation_mode="skipped"` 가능.

## Evidence 강제

- Evidence 최소 1개 필수 (full 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "full",
  "intent_type": "상품교환",
  "required_items": ["회수 일정", "반송장 보관", "1회 무상"],
  "missing_items": [],
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "반송장은 버리지 마시고 교환 완료될 때까지 꼭 보관 부탁드리겠습니다", "turn_id": 65}
  ],
  "self_confidence": 5,
  "self_confidence_rationale": "필수 안내 스크립트 이행이 명확해 확신 높음",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나.
- `score + Σ(deductions[].points) === 5`.
- full 모드 Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. `intent_type` / `required_items` 가 명시됐는가?
3. 누락 항목 (`missing_items`) 이 감점 사유와 일치하는가?
4. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 16
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_17_iv_procedure.sonnet.md — #17
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #17 — 정보 확인 절차 (max 5점)

**STT 기반 통합 상담평가표 v2.0** 의 "개인정보 보호" 대분류 (10점) 내 항목 #17.

**평가모드**: compliance_based (절차 준수 여부 기준)
**처리방식**: Rule 중심 + LLM verify
**비고**: 패턴 탐지, **T3(필수 검수) 라우팅**
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준

**본인 확인 플로우를 규정된 순서대로 이행하였는가?**

- **5점**: 본인 확인 멘트 → 정보 질의(양해 표현) → 고객 응답 → 확인 완료 안내 **순서 준수**
  - **예외 A (선제 제공 허용)**: 고객이 자발적으로 PII(연락처/성함)를 선제 제공 → 이후 상담사가 **복창 확인** (예: "*** 고객님 본인 맞으시지요") + 확인 완료 안내 를 수행한 경우 **5점 유지**. 1단계(본인 확인 멘트)·2단계(양해 표현) 누락을 감점하지 **않음**. ※ 이 예외는 규정 운영상 인정된 플로우.
- **3점**: **경미한 순서 이탈** — 아래 중 하나:
  - 1단계 또는 2단계 중 **하나만 누락** (예: 본인 확인 멘트 없이 바로 "성함 부탁드립니다" 로 정보 질의 시작)
  - 양해 표현 부재 (단, 고객 선제 제공 예외 A 는 3점 아님 — 위 5점 규정 적용)
  - 중간 단계 건너뛰기지만 최종 확인 완료 안내(4단계) 는 수행
- **0점**: **순서 위반 다건** 또는 본인 확인 절차 **자체 생략**
  - 2단계 이상 누락 + 확인 완료 안내(4단계) 도 없음
  - 고객 응답(3단계) 도 없이 임의 상담 진행

**※ PII 토큰(`***`) 등장 위치와 본인 확인 트리거 문구 순서로 판정.**

## 판정 기준 (compliance_based 원칙)

- **내용 무관**, 오직 **순서 패턴** 준수 여부.
- 4단계 순서:
  1. 본인 확인 멘트 (예: "본인 확인을 위해 정보 여쭤보겠습니다")
  2. 정보 질의 + 양해 표현 (예: "번거로우시겠지만 연락처 말씀 부탁드리겠습니다")
  3. 고객 응답 (`***` 토큰 등장)
  4. 확인 완료 안내 (예: "*** 고객님 본인 맞으십니까", "소중한 정보 확인 감사드립니다")
- 4단계 모두 순서 준수 → 5점
- **고객 선제 제공 예외 (A)**: 3단계(고객 응답) 가 1/2단계 없이 먼저 등장 + 이후 4단계(복창 확인) 수행 → **5점** (역순 위반 아님)
- 1~2단계 중 하나만 누락, 3/4단계 수행 → 3점
- 2단계 이상 누락 또는 4단계(확인 완료) 자체 부재 → 0점
- `force_t3=true` 고정 — 인간 검수 필수.

## Evidence 강제

- Evidence 최소 1개 필수 (compliance_based 모드).
- 스키마: `{speaker, timestamp, quote, turn_id}`.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "compliance_based",
  "force_t3": true,
  "mandatory_human_review": true,
  "procedure_steps": {
    "self_identification": true,
    "info_request_with_apology": true,
    "customer_response": true,
    "completion_notice": true
  },
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "고객님 연락처와 성함 말씀 부탁드리겠습니다", "turn_id": 7},
    {"speaker": "상담사", "timestamp": null, "quote": "*** 고객님 본인 맞으십니까", "turn_id": 14}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "본인확인 절차 발화가 대체로 명확 — 확신 보통",
  "summary": "..."
}
```

## 규칙

- `score` 는 정확히 **5 / 3 / 0** 중 하나 (ALLOWED_STEPS = [5, 3, 0]).
- `deductions[].points` 는 **양의 정수만** (0.5 단위 금지).
- `score + Σ(deductions[].points) === 5` (5점이면 빈 배열, 3점이면 points 합계 2, 0점이면 points 합계 5).
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).
- `evaluation_mode="compliance_based"` + `force_t3=true` + `mandatory_human_review=true` 고정.
- Evidence 최소 1개 필수.
- 한국어 작성. 한자 금지.

## 자기 검증

1. score 가 **5 / 3 / 0** 중 하나인가? (중간 값 금지)
2. 고객 선제 제공 케이스 (예외 A) 인지 먼저 확인했는가? — 해당 시 1/2단계 누락을 감점하지 않음 → 5점 유지.
3. 4단계 순서 (`procedure_steps`) 가 명시됐는가?
4. `force_t3=true` + `mandatory_human_review=true` 가 있는가?
5. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 17
       AND (prompt_template IS NULL OR prompt_template = '');

    -- group_b/item_18_privacy_protection.sonnet.md — #18
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$# Item #18 — 정보 보호 준수 (max 5점)

**STT 기반 통합 상담평가표 v3 (2026-04-21)** 의 "개인정보 보호" 대분류 내 항목 #18.

**평가모드**: compliance_based (위반 패턴 탐지)
**처리방식**: Rule 패턴 + T3 필수
**비고**: **T3 라우팅 무조건**
**ALLOWED_STEPS**: [5, 3, 0]

## 평가 기준 (xlsx v3 SSoT)

**상담 중 개인정보 취급 규정 위반이 발생하지 않았는가?**

- **5점**: 위반 패턴 **없음**
- **3점**: **경미 위반** — 주소 / 주문번호 / 회원번호 등 비핵심 PII 1회 선언급 후 **즉시 시정된** 경우
- **0점**: **심각 위반** — 아래 패턴 중 하나라도 탐지

### 심각 위반 패턴 (0점)

- **패턴 A**: 본인 확인 전 상담사 **선언급** (상담사 발화 내 PII 토큰이 본인 확인 트리거보다 **먼저**)
- **패턴 B**: **제3자 지칭**("남편분", "지인", "가족분") 후 PII 관련 안내
- **패턴 C**: 고객이 **본인 확인 거부** 후 상담 계속 진행

**※ 마스킹 환경에서는 탐지만 수행, 최종 판정은 T3 인간 검수.**

## PII 카테고리별 심각도 (xlsx 마스킹 정책 시트)

위반 발생 시 PII 카테고리의 심각도가 0점 / 3점 결정 보조 지표:

| 심각도 | PII 카테고리 | 예 |
|---|---|---|
| 최고 | `[RRN]` | 주민등록번호, 외국인등록번호 |
| 높음 | `[ACCOUNT]`, `[CARD]` | 계좌번호, 카드번호, CVC |
| 중 | `[NAME]`, `[PHONE]`, `[ADDRESS]`, `[PII_OTHER]` | 성명, 전화번호, 주소, 주문번호 등 |
| 낮음~중 | `[DATE]` | 생년월일, 가입일 |
| 낮음 | `[EMAIL]` | 이메일 주소 |
| (PII 아님) | `[AMOUNT]` | 결제액, 잔액 — 감점 대상 아님 |

심각도 가산 규칙:
- **최고/높음 카테고리 위반은 패턴 무관 0점 후보** (단일 노출도 심각 처리)
- **중 카테고리 위반 + 즉시 시정** = 3점 (경미 위반)
- **낮음 카테고리만 노출 + 시정 절차** = 5점 유지 가능

## 판정 기준 (compliance_based 원칙)

- 내용 무관, 오직 **패턴 탐지 + 카테고리 심각도** 기반 절차 준수 여부.
- 패턴 A/B/C 중 하나 탐지 + 최고/높음 PII 노출 → 0점.
- 비핵심 PII (중) 1회 선언급 + 즉시 시정 → 3점.
- 탐지 전무 또는 낮음 PII 만 정상 절차로 노출 → 5점.
- `force_t3=true` 고정 — 인간 검수 필수 (마스킹 환경에서 AI 판단은 잠정).

## Evidence 강제

- Evidence 최소 1개 필수 (compliance_based 모드).
- 위반 탐지 시 해당 위반 턴을 Evidence 로 출력.
- 미탐지 시에도 본인 확인 절차 수행 턴을 Evidence 로 출력.
- 스키마: `{speaker, timestamp, quote, turn_id}`.

## 출력 (JSON)

```json
{
  "score": 5,
  "evaluation_mode": "compliance_based",
  "force_t3": true,
  "mandatory_human_review": true,
  "violations": [],
  "patterns_checked": ["pattern_A", "pattern_B", "pattern_C"],
  "pii_severity_observed": [],
  "deductions": [],
  "evidence": [
    {"speaker": "상담사", "timestamp": null, "quote": "*** 고객님 본인 맞으십니까", "turn_id": 14}
  ],
  "self_confidence": 4,
  "self_confidence_rationale": "위반 패턴 미탐지 — 단 T3 확정 전이라 확신 보통",
  "summary": "위반 패턴 탐지 없음. 최종 판정은 T3 필수."
}
```

3점 사례:
```json
{
  "score": 3,
  "violations": [
    {"pattern": "minor_disclosure", "turn_id": 7, "pii_category": "PII_OTHER", "severity": "중",
     "description": "주문번호 1회 선언급 후 본인확인 절차로 즉시 시정"}
  ],
  "pii_severity_observed": ["중"],
  "deductions": [{"points": 2, "reason": "경미 위반 — 비핵심 PII 1회 선언급 / 즉시 시정"}],
  "summary": "경미 위반 1건 — 즉시 시정 확인. T3 검수 권고."
}
```

## 규칙

- `score` 는 정확히 5 / 3 / 0 중 하나 (ALLOWED_STEPS = [5, 3, 0]).
- `score + Σ(deductions[].points) === 5`.
- `evaluation_mode="compliance_based"` + `force_t3=true` + `mandatory_human_review=true` 고정.
- `patterns_checked` 에 A/B/C 3개 모두 기재.
- `violations[]` 에 탐지 패턴 (예: `{"pattern": "A", "turn_id": 3, "pii_category": "RRN", "severity": "최고", "description": "..."}`) 기재.
- 3점 케이스는 `pattern` 필드를 `"minor_disclosure"` 로, 카테고리 + 심각도 명시.
- Evidence 최소 1개 필수.
- `self_confidence_rationale`: 왜 그 자기확신 점수인지 **1줄** (신뢰도 근거로 노출됨).
- 한국어 작성. 한자 금지.

## 자기 검증

1. score 가 5 / 3 / 0 중 하나인가?
2. `patterns_checked` 에 A/B/C 3개가 모두 있는가?
3. 3점 판정 시 `violations[].pattern == "minor_disclosure"` + `severity == "중"` + 시정 사실 명시되어 있는가?
4. `force_t3=true` + `mandatory_human_review=true` 가 있는가?
5. `score + Σ(deductions.points) == 5` 산술 검증 통과인가?$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 18
       AND (prompt_template IS NULL OR prompt_template = '');

    RAISE NOTICE '코오롱(org_id=%) 평가항목 콘텐츠 시드 완료: criterion 18항목(#3 사유만) / prompt_template 17항목(#3 제외).', target_org_id;
END $migrate$;

COMMIT;
