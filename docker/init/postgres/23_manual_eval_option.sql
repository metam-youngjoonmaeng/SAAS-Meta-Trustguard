-- 수기평가 판단(낮음/동일/높음)의 진실의 출처(SSOT)를 텍스트 컬럼으로 분리.
--
-- 배경: manual_eval(double) 한 칸에 판단을 인코딩(동일→ai, 높음→ai+0.5, 낮음→ai-0.5)했더니
--   '동일'(=ai 그대로) 과 '미평가'(적재 기본값도 ai) 가 숫자로 동일 → 구분 불가.
--   → (1) 한 행만 평가해도 나머지 행이 '동일'로 보이고 (2) 전부 '동일'이면 완료 신호가 안 잡힘.
-- manual_eval_option: NULL=미평가, '낮음'/'동일'/'높음'=명시적 판단. 점수표시는 manual_eval 유지.
ALTER TABLE qa_call_item_score ADD COLUMN IF NOT EXISTS manual_eval_option text;
COMMENT ON COLUMN qa_call_item_score.manual_eval_option IS
    '수기평가 판단 라벨(낮음/동일/높음). NULL=미평가. 판단의 SSOT — manual_eval(double)은 점수/일치율 표시용.';

-- 기존 저장분 백필(컬럼 도입 전 데이터 보존). 옵션이 비어 있는 행만 채운다(멱등).
-- 1) 골드셋에 등록된 행 = 명시적 '동일'(동일 판단일 때만 골드셋 등록 가능했음).
UPDATE qa_call_item_score er
   SET manual_eval_option = '동일'
  FROM qa_golden_set g
 WHERE g.qa_id = er."ID" AND g.order_no = er.order_no
   AND er.manual_eval_option IS NULL;

-- 2) ai_eval 과 다른 manual_eval = 실제 수기 override → 부호로 높음/낮음 복원.
UPDATE qa_call_item_score
   SET manual_eval_option = CASE
           WHEN manual_eval - ai_eval > 1e-9 THEN '높음'
           WHEN ai_eval - manual_eval > 1e-9 THEN '낮음'
       END
 WHERE manual_eval_option IS NULL
   AND ai_eval IS NOT NULL AND manual_eval IS NOT NULL
   AND ABS(manual_eval - ai_eval) > 1e-9;
