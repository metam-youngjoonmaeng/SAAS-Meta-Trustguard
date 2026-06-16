-- ============================================================
-- 17_kolon_ksqi_item_defs.sql — 코오롱 KSQI 9항목 시드 + 체크리스트 #3 비활성 통일
-- ------------------------------------------------------------
-- 목적:
--   (A) eval_item_defs 에 별도 스코프 department='KSQI' 로 KSQI 평가 9항목을 시드.
--       평가항목 관리 화면(EvalItems) 의 "KSQI 평가항목" 섹션이 이 행을 읽어 표시·편집.
--   (B) 코오롱 표준 체크리스트(department='기본') order_no=3 항목(경청 말겹침/말자름)을
--       파이프라인 영구 미산출에 맞춰 비활성(is_active=false) 처리 → 화면 실효 17항목 통일.
--
-- 소스(READ-ONLY):
--   - KSQI 메타(영역/하위분류/배점/판정 포인트):
--       qa-pipeline/v2/nodes/ksqi/ksqi_rules.py 의 KSQI_RULES (item_number 1~9)
--   - KSQI LLM 프롬프트(rule 노드 항목은 프롬프트 부재 → NULL):
--       qa-pipeline/v2/nodes/ksqi/prompts_llm.py 의 SYSTEM_PROMPTS (#3 #4 #5 #8 #9)
--         · #3 ← SYSTEM_REFUSAL_FOLLOWUP
--         · #4 ← SYSTEM_EASY_EXPLAIN
--         · #5 ← SYSTEM_INQUIRY_GRASP
--         · #8 ← SYSTEM_BASIC_EMPATHY
--         · #9 ← SYSTEM_ADVANCED_EMPATHY
--       rule 노드 항목(#1 #2 #6 #7)은 LLM 프롬프트 없음 → prompt_template = NULL.
--
-- KSQI 배점/영역(ksqi_rules.py):
--   A영역(서비스품질) 50점: #1 맞이인사 10 / #2 단답형 5 / #3 거부후재안내 5 /
--                           #4 쉬운설명 10 / #5 문의파악도 10 / #6 종료인사 10
--   B영역(공감) 30점:       #7 답례표현 10 / #8 단순공감 10 / #9 고차원공감 10
--   결함(defect=true) 1건 → 해당 항목 배점 전액 차감(score=0). 부분점수 없음.
--   환산 = (영역 획득 / 영역 배점합) × 100. 우수 임계: A 92↑ / B 80↑.
--
-- 멱등/non-clobbering:
--   - 대상: org_id=(코오롱), department='KSQI', version=1, order_no=1~9.
--   - 행 골격은 ON CONFLICT (org_id, department, order_no, version) DO NOTHING (16/15 패턴).
--   - 콘텐츠(criterion/prompt_template/메타)는 컬럼이 비었을 때만 UPDATE — 운영자 UI 편집 보존.
--   - pentagon_axis/scoring_type/max_score/is_active 컬럼은 12_eval_item_meta.sql 선행 적용 의존.
--   - 코오롱 org 부재 시 전체 skip(DO 블록 + RAISE NOTICE) — 15/16 패턴.
--   - 프롬프트 md 본문은 dollar-quoting($prompt$ ... $prompt$) 으로 무수정 원문 적재.
--
-- #3 비활성 통일(B):
--   - 코오롱 department='기본' order_no=3 행을 is_active=false 로 1회성 비활성.
--   - non-clobbering 가드: criterion 에 '파이프라인 미산출' 포함 AND 아직 is_active=true 인 경우에만.
--     (운영자가 의도적으로 재활성화한 경우 재차 덮지 않음.)
--   - is_active=false 는 채점·통계·미리보기 뱃지 수준의 비활성 표시 — GET /api/admin/eval-items
--     는 is_active 로 필터하지 않으므로 행 자체는 계속 반환됨.
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
        RAISE NOTICE '코오롱 org 미존재 — 17 KSQI 시드 전체 건너뜀.';
        RETURN;
    END IF;

    -- ── (A) KSQI 9항목 행 골격 시드 (department='KSQI') ──────────────────────
    INSERT INTO public.eval_item_defs
        (org_id, order_no, category, item, criterion, prompt_template,
         pentagon_axis, scoring_type, max_score, is_active,
         department, version, effective_from, deactivated_at, updated_at)
    VALUES
        (target_org_id, 1, 'A영역(서비스품질) · 맞이인사', '맞이인사 구성요소', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 2, 'A영역(서비스품질) · 상담태도', '단답형 응대', NULL, NULL,
         NULL, 'numeric', 5, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 3, 'A영역(서비스품질) · 상담태도', '거부 후 재안내', NULL, NULL,
         NULL, 'numeric', 5, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 4, 'A영역(서비스품질) · 업무처리', '쉬운 설명', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 5, 'A영역(서비스품질) · 업무처리', '문의내용 파악도', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 6, 'A영역(서비스품질) · 종료태도', '종료인사 구성요소', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 7, 'B영역(공감) · 맞이인사', '답례표현', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 8, 'B영역(공감) · 상담태도', '단순 공감 표현', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now()),
        (target_org_id, 9, 'B영역(공감) · 상담태도', '고차원 공감 표현', NULL, NULL,
         NULL, 'numeric', 10, true, 'KSQI', 1, now(), NULL, now())
    ON CONFLICT (org_id, department, order_no, version) DO NOTHING;

    -- ── KSQI criterion (사람이 읽는 점수체계/감점규칙) — 비어있을 때만 채움 ──
    -- 결함 1건 → 배점 전액 차감(score=0), 부분점수 없음. rule/llm 판정 방식 명시.

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=rule / 만점(10): 첫인사·소속·이름·용무문의 4요소 전부 포함 / 0점: 하나라도 누락(defect). 부분점수 없음. 도입부 첫 5 상담사 턴 대상 키워드·정규식 매칭.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 1
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 5점 / eval_method=rule / 0점(defect): 중간부(앞2·뒤2턴 제외) 상담사 발화 중 단답형(네/네네/예/맞아요/맞습니다/아니요/그렇죠) 비율 30% 이상 또는 연속 3턴 이상 / 만점(5): 그 외. 상담사 발화 없으면 보류(defect 아님).',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 2
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 5점 / eval_method=llm / 0점(defect): 업셀링·크로스셀링 거절 의사 표현 후 동일·유사 안내 반복 / 만점(5): 정상 또는 제안 자체 없음(해당없음). 전사 부재·LLM 실패 시 defect=false 인프라 폴백.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 3
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=llm / 0점(defect): 두서없음·중언부언·문장 중단·맥락 이탈 두드러짐 / 만점(10): 논리 전개·문장 완결성·맥락 일관성 명확. LLM 1회 호출, 실패·전사 부재 시 defect=false 폴백.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 4
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=llm / 0점(defect): (a) 고객 동일 내용 2회 이상 재진술(리바이벌) 유발 또는 (b) 복합질의 중 일부 답변 누락 / 만점(10): 그 외. LLM 1회 호출, 실패·전사 부재 시 defect=false 폴백.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 5
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=rule / 만점(10): 마지막 5 상담사 턴(종료부)에서 종료인사 키워드 + 이름 2요소 모두 포함 / 0점: 하나라도 누락(defect). 부분점수 없음.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 6
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=rule / 0점(defect): 고객 인사·감사 직후 상담사 답례 부적절(네/예/여보세요/말씀하세요/말씀하시죠 단답 또는 적절 답례 부재) 1건 이상 / 만점(10): 트리거 전부 적절. 트리거 자체 없으면 보류(defect 아님).',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 7
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=llm(ksqi_rules 선언상 hybrid, 구현은 LLM 1회) / 0점(defect): 고객 발화에 단답형(네/네네/맞습니다/확인해드릴게요)만 반복하고 공감 표현 전무 / 만점(10): 적절 공감 호응. 실패·전사 부재 시 defect=false 폴백.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 8
       AND (criterion IS NULL OR criterion = '');

    UPDATE public.eval_item_defs SET criterion =
        '배점 10점 / eval_method=llm / 0점(defect): 고객 불만·어려움·경조사·양해 등 감정 상황에서 상황별 맞춤 공감(사과·위로·조의·축하·감사) 없이 사무적 응대 / 만점(10): 맞춤 공감 또는 감정 상황 자체 없음(해당없음). 실패·전사 부재 시 defect=false 폴백.',
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 9
       AND (criterion IS NULL OR criterion = '');

    -- ── KSQI prompt_template (LLM 프롬프트 원문) — 비어있을 때만 채움 ────────
    -- rule 노드 항목(#1 #2 #6 #7)은 LLM 프롬프트 부재 → 미채움(NULL 유지).

    -- prompts_llm.py SYSTEM_REFUSAL_FOLLOWUP — #3
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$당신은 콜센터 상담 품질 평가관이다. 평가 항목 "#3 거부 후 재안내" (배점 5점) 를 판정한다.

[판정 기준]
- 상담사가 업셀링/크로스셀링(부가서비스·요금제 상향·추가 상품 등) 을 제안하고,
  고객이 거절 의사("괜찮아요", "필요없어요", "안 할게요", "생각 없어요" 등) 를 표현했는데도
  상담사가 동일하거나 유사한 안내를 계속 진행하면 결함(defect=true).
- 업셀링/크로스셀링 제안 자체가 대화에 전혀 없으면 해당없음 → defect=false.
- 제안은 있었으나 고객이 거절하지 않았거나, 거절 후 상담사가 수용하고 더 권유하지 않으면 정상.

[판정 예시 — 정상(O) / 결함(X)] (평가표 원문)
< 정상 (O) >
[상담사] 고객님, 이번에 프리미엄 요금제 안내드려도 괜찮을까요?
[고객] 아니요, 괜찮습니다.
[상담사] 네 알겠습니다. 다른 문의사항 있으실까요?

< 결함 (X) >
[상담사] 고객님, 이번에 프리미엄 요금제 안내드려도 괜찮을까요?
[고객] 아니요, 괜찮습니다.
[상담사] 이번 달만 30% 할인이라 정말 혜택이 좋으신데요, 한번 들어보시면 생각이 달라지실 거예요.

[공통 규약]
- 대화에서 화자 마커 "상담사:" / "상담원:" 발화만 평가한다. "고객:" 발화는 맥락 파악용.
- 결함 여부가 명확하지 않으면 보수적으로 defect=false 로 판정한다 (부당 감점 방지).
- evidence 의 quote 는 판정 근거가 된 실제 발화를 원문 그대로(짧게) 인용한다.
- 반드시 아래 JSON 객체 하나만 출력한다. 설명/코드블록/주석을 덧붙이지 않는다.
  {"defect": true 또는 false, "rationale": "한국어 1~2문장 판정 사유", "evidence": [{"quote": "근거 발화"}]}$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 3
       AND (prompt_template IS NULL OR prompt_template = '');

    -- prompts_llm.py SYSTEM_EASY_EXPLAIN — #4
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$당신은 콜센터 상담 품질 평가관이다. 평가 항목 "#4 쉬운 설명" (배점 10점) 를 판정한다.

[판정 기준]
- 상담사 설명의 논리 전개 / 문장 완결성 / 맥락 일관성을 본다.
- 두서없음, 중언부언(같은 말 반복), 문장 중단(말 끊김), 맥락 이탈이 두드러지면 결함(defect=true).
- 설명이 명확하고 핵심이 정리되어 전달되면 정상(defect=false).

[판정 예시 — 정상(O) / 결함(X)] (평가표 원문)
< 정상 (O) >
[고객] 요금제 바꾸면 위약금이 있나요?
[상담사] 네 고객님, 약정 기간이 6개월 남아 있어 해지 위약금이 발생합니다. 금액은 32,000원이며, 요금제 변경 시점에 다음 달 청구서에 반영됩니다.

< 결함 (X) >
[고객] 요금제 바꾸면 위약금이 있나요?
[상담사] 아 그게 이제 바꾸면 뭐가 있냐면 아 위약금이 있긴 한데 그게 이제 약정이 있어서요 그래서 얼마가 나오냐면 한 번 계산을 아 3만 몇천원 정도 나오는데 정확하게는 아 청구서에...

[공통 규약]
- 대화에서 화자 마커 "상담사:" / "상담원:" 발화만 평가한다. "고객:" 발화는 맥락 파악용.
- 결함 여부가 명확하지 않으면 보수적으로 defect=false 로 판정한다 (부당 감점 방지).
- evidence 의 quote 는 판정 근거가 된 실제 발화를 원문 그대로(짧게) 인용한다.
- 반드시 아래 JSON 객체 하나만 출력한다. 설명/코드블록/주석을 덧붙이지 않는다.
  {"defect": true 또는 false, "rationale": "한국어 1~2문장 판정 사유", "evidence": [{"quote": "근거 발화"}]}$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 4
       AND (prompt_template IS NULL OR prompt_template = '');

    -- prompts_llm.py SYSTEM_INQUIRY_GRASP — #5
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$당신은 콜센터 상담 품질 평가관이다. 평가 항목 "#5 문의내용 파악도" (배점 10점) 를 판정한다.

[판정 기준 — (a)(b) 중 하나라도 해당되면 defect=true]
(a) 상담사가 문의를 제대로 파악하지 못해 고객이 같은 내용을 2회 이상 재진술하거나
    되묻게(리바이벌) 만들면 결함.
(b) 고객의 복합 질의(둘 이상의 문의) 중 일부 문의에 대한 답변이 누락되면 결함.

[판정 예시 — 정상(O) / 결함(X)] (평가표 원문)
< 정상 (O) >
[고객] 어제 주문한 상품 언제 도착하고, 취소하면 환불은 얼마나 걸리나요?
[상담사] 네 고객님, 두 가지 말씀 주신 내용 답변드리겠습니다. 배송은 내일 도착 예정이고, 취소 시 환불은 영업일 기준 3~5일 소요됩니다.

< 결함 (X) — 복합질의 누락 >
[고객] 어제 주문한 상품 언제 도착하고, 환불은 얼마나 걸리나요?
[상담사] 배송은 내일 예정입니다. 또 문의사항 있으실까요?
[고객] 환불도 여쭤봤는데요.

< 결함 (X) — 리바이벌 2회 >
[고객] 어제 가입한 요금제 해지하고 싶어요.
[상담사] 어떤 요금제요?
[고객] 어제 가입한 거요.
[상담사] 다시 말씀해주시겠어요?

[유의]
- 고객이 단순히 추가 정보를 보충하는 것은 재진술이 아니다. 동일 문의의 반복인지 구분한다.

[공통 규약]
- 대화에서 화자 마커 "상담사:" / "상담원:" 발화만 평가한다. "고객:" 발화는 맥락 파악용.
- 결함 여부가 명확하지 않으면 보수적으로 defect=false 로 판정한다 (부당 감점 방지).
- evidence 의 quote 는 판정 근거가 된 실제 발화를 원문 그대로(짧게) 인용한다.
- 반드시 아래 JSON 객체 하나만 출력한다. 설명/코드블록/주석을 덧붙이지 않는다.
  {"defect": true 또는 false, "rationale": "한국어 1~2문장 판정 사유", "evidence": [{"quote": "근거 발화"}]}$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 5
       AND (prompt_template IS NULL OR prompt_template = '');

    -- prompts_llm.py SYSTEM_BASIC_EMPATHY — #8
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$당신은 콜센터 상담 품질 평가관이다. 평가 항목 "#8 단순 공감 표현" (배점 10점) 를 판정한다.

[판정 기준]
- 고객 발화에 대해 기계적·사무적이지 않게 공감 표현을 섞어 호응하는지 본다.
- 상담사가 단답형("네", "네네", "맞습니다", "확인해드릴게요")만 반복하고 공감 표현이 전혀 없으면 결함(defect=true).
- 적절한 공감 표현으로 호응하면 정상(defect=false).

[판정 예시 — 정상(O) / 결함(X)] (평가표 원문)
< 정상 (O) >
[고객] 제가 한 달 전에 신청했는데 아직도 처리가 안 됐다고 해서요.
[상담사] 아~ 그러셨군요. 오래 기다리셨는데 답답하셨겠습니다. 제가 지금 바로 확인해드리겠습니다.

< 결함 (X) >
[고객] 제가 한 달 전에 신청했는데 아직도 처리가 안 됐다고 해서요.
[상담사] 네. 확인해드릴게요.

[공통 규약]
- 대화에서 화자 마커 "상담사:" / "상담원:" 발화만 평가한다. "고객:" 발화는 맥락 파악용.
- 결함 여부가 명확하지 않으면 보수적으로 defect=false 로 판정한다 (부당 감점 방지).
- evidence 의 quote 는 판정 근거가 된 실제 발화를 원문 그대로(짧게) 인용한다.
- 반드시 아래 JSON 객체 하나만 출력한다. 설명/코드블록/주석을 덧붙이지 않는다.
  {"defect": true 또는 false, "rationale": "한국어 1~2문장 판정 사유", "evidence": [{"quote": "근거 발화"}]}$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 8
       AND (prompt_template IS NULL OR prompt_template = '');

    -- prompts_llm.py SYSTEM_ADVANCED_EMPATHY — #9
    UPDATE public.eval_item_defs SET prompt_template =
$prompt$당신은 콜센터 상담 품질 평가관이다. 평가 항목 "#9 고차원 공감 표현" (배점 10점) 를 판정한다.

[판정 기준]
- 고객이 불만, 어려움 호소, 경조사(상·결혼 등), 양해 요청 등 감정 상황을 드러낼 때,
  상담사가 상황별 맞춤 공감(사과·위로·조의·축하·감사) 으로 응대하는지 본다.
- 그런 감정 상황에서 상담사가 사무적으로만 응대하면 결함(defect=true).
- 그런 감정 상황이 대화에 전혀 없으면 해당없음 → defect=false.

[판정 예시 — 정상(O) / 결함(X)] (평가표 원문)
< 정상 (O) — 불만 / 경조사 >
[고객] 벌써 다섯 번째 전화하는 거예요. 정말 너무 힘드네요.
[상담사] 아~ 정말 많이 속상하셨겠습니다. 반복적으로 불편드린 점 진심으로 사과드립니다. 이번에는 제가 끝까지 책임지고 해결해드리겠습니다.
[고객] 부모님이 갑자기 돌아가셔서 납부가 어려울 것 같아요.
[상담사] 아이고, 삼가 위로의 말씀 드립니다. 많이 힘드실 텐데요, 납부 관련해서 도움드릴 수 있는 방법 안내드리겠습니다.

< 결함 (X) — 불만 / 경조사 >
[고객] 벌써 다섯 번째 전화하는 거예요. 정말 너무 힘드네요.
[상담사] 네 확인해보겠습니다.
[고객] 부모님이 갑자기 돌아가셔서 납부가 어려울 것 같아요.
[상담사] 네, 그럼 요금 관련해서는 어떻게 하실 건가요?

[공통 규약]
- 대화에서 화자 마커 "상담사:" / "상담원:" 발화만 평가한다. "고객:" 발화는 맥락 파악용.
- 결함 여부가 명확하지 않으면 보수적으로 defect=false 로 판정한다 (부당 감점 방지).
- evidence 의 quote 는 판정 근거가 된 실제 발화를 원문 그대로(짧게) 인용한다.
- 반드시 아래 JSON 객체 하나만 출력한다. 설명/코드블록/주석을 덧붙이지 않는다.
  {"defect": true 또는 false, "rationale": "한국어 1~2문장 판정 사유", "evidence": [{"quote": "근거 발화"}]}$prompt$,
        updated_at = now()
     WHERE org_id = target_org_id AND department = 'KSQI' AND version = 1 AND order_no = 9
       AND (prompt_template IS NULL OR prompt_template = '');

    RAISE NOTICE '코오롱(org_id=%) KSQI 9항목(department=KSQI) 시드 완료.', target_org_id;

    -- ── (B) 체크리스트 #3(경청 말겹침/말자름) 비활성 통일 ────────────────────
    -- 파이프라인 영구 미산출 → 화면 실효 17항목. non-clobbering 가드:
    -- criterion 에 '파이프라인 미산출' 포함 AND 아직 is_active=true 일 때만 1회성 비활성.
    UPDATE public.eval_item_defs SET is_active = false,
                                     updated_at = now()
     WHERE org_id = target_org_id AND department = '기본' AND version = 1 AND order_no = 3
       AND is_active = true
       AND criterion LIKE '%파이프라인 미산출%';

    RAISE NOTICE '코오롱(org_id=%) 체크리스트 #3 비활성 처리(파이프라인 미산출, 활성행 한정) 완료.', target_org_id;
END $migrate$;

COMMIT;
