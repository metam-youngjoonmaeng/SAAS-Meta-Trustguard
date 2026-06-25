-- 도메인 기본 평가항목(domain_default_eval_items)의 표준 5축 매핑(pentagon_axis) 채우기.
-- 51 시드는 category 만 채우고 pentagon_axis 는 비워둠 → 도메인 기준 펜타곤(02 딥평가 등)이 0 으로 나옴.
-- 표준 5축: 응대·표현 / 니즈파악·경청 / 설명·전달력 / 정확성·해결력 / 컴플라이언스 (domain_default_pentagon_axes).
-- 멱등·안전: 비어있는 행만 채움(수동 편집/이후 변경 보존). 51 보다 뒤 번호라 fresh DB 에서도 51 다음에 적용됨.
-- 매핑 근거 = 항목명/category 기반 판단(이커머스·금융 각 13항목). 다른 도메인은 항목 없음(미적용).

-- ── 도메인 3: 유통/이커머스 (13항목) ──
UPDATE public.domain_default_eval_items SET pentagon_axis = '응대·표현'
 WHERE domain_id = 3 AND order_no IN (1,2,3,4,5) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '니즈파악·경청'
 WHERE domain_id = 3 AND order_no IN (6) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '설명·전달력'
 WHERE domain_id = 3 AND order_no IN (7,10) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '정확성·해결력'
 WHERE domain_id = 3 AND order_no IN (8,9) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '컴플라이언스'
 WHERE domain_id = 3 AND order_no IN (11,12,13) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');

-- ── 도메인 1: 금융 (13항목) ──
UPDATE public.domain_default_eval_items SET pentagon_axis = '응대·표현'
 WHERE domain_id = 1 AND order_no IN (1,2,3,4) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '니즈파악·경청'
 WHERE domain_id = 1 AND order_no IN (5) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '설명·전달력'
 WHERE domain_id = 1 AND order_no IN (6) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '정확성·해결력'
 WHERE domain_id = 1 AND order_no IN (7,8) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
UPDATE public.domain_default_eval_items SET pentagon_axis = '컴플라이언스'
 WHERE domain_id = 1 AND order_no IN (9,10,11,12,13) AND (pentagon_axis IS NULL OR btrim(pentagon_axis) = '');
