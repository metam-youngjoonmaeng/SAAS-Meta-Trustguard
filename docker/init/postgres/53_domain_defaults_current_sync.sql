-- ============================================================
-- 53_domain_defaults_current_sync.sql
-- 도메인 기본값(평가항목 + 펜타곤 축 + 프롬프트) 현재 라이브 상태 스냅샷.
-- 라이브 DB 에서 생성한 UPSERT. fresh 볼륨 init 시 50/51/52 이후 재동기(동일값 → no-op),
-- 기존 DB 에 수동 적용 시 도메인 기본값을 현재 상태로 정렬. 브랜드 사본(eval_item_defs/
-- pentagon_axes)은 런타임 데이터라 미포함.
-- 자동 생성 (docker exec psql format(%L)). 수동 편집보다 재덤프 권장.
-- ============================================================

-- ----- domain_default_pentagon_axes -----
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (1, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (1, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (1, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (1, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (1, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (2, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (2, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (2, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (2, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (2, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (3, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (3, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (3, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (3, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (3, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (4, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (4, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (4, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (4, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (4, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (5, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (5, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (5, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (5, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (5, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (6, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (6, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (6, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (6, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (6, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (7, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (7, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (7, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (7, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (7, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (8, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (8, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (8, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (8, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (8, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (9, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (9, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (9, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (9, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (9, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (10, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (10, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (10, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (10, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (10, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (11, 1, '응대·표현', '상담 매너·언어 품질 — 첫인사(도입), 끝인사·추가문의 확인, 화답인사, 공감·호응·쿠션어, 정중한 언어표현', '[평가 축] 응대·표현 — 상담 매너와 언어 품질

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 응대 매너·언어 품질을 종합 평가하세요.

[평가 관점]
- 첫인사·도입: 표준 인사와 소속·성명 안내로 상담을 자연스럽게 시작했는가
- 끝인사·추가문의 확인: 마무리 인사와 "더 도와드릴 점" 확인을 했는가
- 화답인사: 고객의 인사·감사 표현에 적절히 화답했는가
- 공감·호응·쿠션어: 경청 호응과 쿠션어로 부드럽고 공감적으로 응대했는가
- 정중한 언어표현: 존댓말·정중한 어휘를 일관되게 사용했는가

[등급 기준]
- 우수: 위 관점이 대체로 자연스럽고 일관됨
- 보통: 핵심은 지켰으나 일부 형식적이거나 누락
- 주의: 다수 항목이 미흡하거나 부자연스러운 응대
- 실패: 기본 매너·정중함이 결여됨

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (11, 2, '니즈파악·경청', '무엇을 묻는지 정확히 파악 — 문의 의도·니즈 파악, 상품/업무 특정, 재복창(확인 복창)', '[평가 축] 니즈파악·경청 — 고객이 무엇을 원하는지 정확히 파악했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 니즈 파악·경청 역량을 종합 평가하세요.

[평가 관점]
- 문의 의도·니즈 파악: 고객의 진짜 요구를 정확히 짚었는가(겉문의 뒤 실제 니즈 포함)
- 상품/업무 특정: 어떤 상품·업무에 대한 문의인지 구체적으로 특정했는가
- 재복창(확인 복창): 핵심 요청을 복창해 상호 확인했는가
- 경청: 말을 끊거나 겹치지 않고 끝까지 들었는가

[등급 기준]
- 우수: 니즈를 정확히 파악하고 복창으로 확인까지 완료
- 보통: 대체로 파악했으나 복창 누락 또는 일부 재확인 필요
- 주의: 핵심 니즈를 놓치거나 반복 질문 유발
- 실패: 문의 의도를 오인하여 잘못된 방향으로 진행

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (11, 3, '설명·전달력', '얼마나 명확히 전달했나 — 설명력·전달력, 두괄식 전달, 내부용어·전문용어 지양', '[평가 축] 설명·전달력 — 안내를 얼마나 명확하게 전달했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 설명·전달력을 종합 평가하세요.

[평가 관점]
- 설명력·전달력: 고객이 이해하기 쉽게 논리적으로 설명했는가
- 두괄식 전달: 결론·핵심을 먼저 말하고 부연을 덧붙였는가
- 내부용어·전문용어 지양: 사내 약어·전문용어를 풀어서 쉬운 말로 안내했는가

[등급 기준]
- 우수: 핵심을 먼저, 쉬운 말로 명확히 전달
- 보통: 전달은 됐으나 장황하거나 일부 용어가 어려움
- 주의: 설명이 모호해 고객이 재질문하거나 혼동
- 실패: 핵심이 전달되지 않거나 잘못 이해하게 함

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (11, 4, '정확성·해결력', '맞게 안내했고 실제로 해결했나 — 정확한 안내·오안내 방지, 금지멘트 준수, 복합문의 답변, 적극성·해결의지, 대안 제시·셀프서비스 안내, 절차 필수안내(반품·환불 소요일 등)', '[평가 축] 정확성·해결력 — 정확히 안내하고 실제로 문제를 해결했는가

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 정확성·해결력을 종합 평가하세요.

[평가 관점]
- 정확한 안내·오안내 방지: 사실과 규정에 맞게 안내했는가(틀린 정보 없음)
- 금지멘트 준수: 사용 금지된 표현·확정성 멘트를 피했는가
- 복합문의 답변: 둘 이상의 문의를 빠짐없이 모두 처리했는가
- 적극성·해결의지: 고객 문제를 끝까지 해결하려는 의지를 보였는가
- 대안 제시·셀프서비스 안내: 즉시 해결이 어려울 때 대안·셀프 경로를 안내했는가
- 절차 필수안내: 반품·환불 소요일 등 절차상 필수 정보를 안내했는가

[등급 기준]
- 우수: 정확한 안내 + 문제를 실질적으로 해결(또는 명확한 대안 제시)
- 보통: 대체로 정확하나 일부 안내 누락 또는 해결 미완
- 주의: 부정확한 안내 또는 소극적 처리로 미해결
- 실패: 오안내/금지멘트 위반 또는 문제 방치

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_pentagon_axes (domain_id, axis_no, label, description, prompt_template, is_active) VALUES (11, 5, '컴플라이언스', '규정준수·정보보호(규정·고객보호) — 본인확인 절차·순서·항목, 개인정보·정보보호·선언급 금지, 안내 범위 준수, 업무별 필수고지·상품 적합성, 보안사고 대응(분실·피싱·부정거래)', '[평가 축] 컴플라이언스 — 규정 준수와 고객정보 보호

이 축에 매핑된 평가항목 채점 결과와 상담 전사를 바탕으로 상담사의 규정준수·정보보호 수준을 종합 평가하세요.

[평가 관점]
- 본인확인: 절차·순서·필수 항목대로 본인확인을 수행했는가
- 개인정보·정보보호: 불필요한 개인정보 선언급을 피하고 보호 원칙을 지켰는가
- 안내 범위 준수: 권한·정책상 허용된 범위 내에서만 안내했는가
- 업무별 필수고지·상품 적합성: 업무에 요구되는 고지와 적합성 확인을 이행했는가
- 보안사고 대응: 분실·피싱·부정거래 등 상황에 규정대로 대응했는가

[등급 기준]
- 우수: 본인확인·필수고지·정보보호를 빠짐없이 준수
- 보통: 대체로 준수했으나 일부 절차·고지 누락
- 주의: 본인확인 부실 또는 고지 누락 등 위험 소지
- 실패: 정보보호 위반·필수확인 미이행 등 중대한 규정 위반

[출력] {"rating":"우수|보통|주의|실패","analysis":"핵심만 간결하게 2-3문장"}', 't') ON CONFLICT (domain_id, axis_no) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, prompt_template=EXCLUDED.prompt_template, is_active=EXCLUDED.is_active;

-- ----- domain_default_eval_items -----
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 1, '응대·표현', '첫인사 · 본인확인 도입', '[평가 항목] 첫인사 · 본인확인 도입

[평가 대상] 1) 인사 3요소(인사말+소속+상담사 실명) 제시 여부, 2) 고객 본인 여부 확인 질의(‘○○○ 고객님 본인 맞으시죠?’) 수행 여부, 3) 본인확인 질의 직후 고객 긍정/답변 발화 수령 여부.

[평가 기준] 인사 3요소와 본인확인 질의 및 고객 답변 수령까지 도입부에서 모두 수행하였는가?

[판정 주의] 고객 ‘네’ 단답은 STT 누락 방지를 위해 보존 필수. 실명 오인식은 끝맺음 패턴으로 추출하여 판정.

## 텍스트 판정 신호
- 인사 구성요소 + 본인확인 의문형 + 직후 고객 긍정/답변 발화.

## STT 주의·보정
고객 ‘네’ 단답 보존 필수(STT 누락 방지). 실명 오인식은 끝맺음 패턴으로 추출.

## 참조 데이터
### 본인확인 정멘트 골격
- [BK-S01 본인확인 도입] 계좌/거래 안내 전 성함·생년월일 등 본인확인 요청 / 필수 요소·순서: 본인확인 선행·항목 / 허용 변형: 표현 변형 허용

### 고객 답변 인정·불인정 기준
- 인정(동의/적합성 확인): 네 / 예 / 해주세요 / 알겠어요 / 그렇게 해주세요 / 동의합니다 /
신청할게요 / 그렇게 해주세요 (할게요) → 동의·확인 성립으로 인정
- 불인정·불분명: 글쎄요 / 생각해볼게요 / 잘 모르겠어요 / (무응답) → 미수득 → 0점·신뢰도 강등
- 거절: 아니요 / 안 할래요 / 필요 없어요 / 됐습니다 / 그만 하세요 / 안듣고 싶어요 → 가입/진행 불가 — 중단 여부 확인', '점수 단계: 6 / 3 / 0
- 6점: 인사 3요소 + 본인확인 질의 + 고객 답변 모두 충족함
- 3점: 인사 1요소 누락 또는 본인확인 질의 후 고객 답변 누락
- 0점: 소속/실명/본인확인 질의 중 2개 이상 누락, 또는 본인확인 없이 본론 진입', '응대·표현', 'numeric', 6, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 2, '응대·표현', '끝인사', '[평가 항목] 끝인사

[평가 대상] 1) 상담 종료 구간의 종료 인사 진행 여부 2) 소속(부서/회사) 안내 여부 3) 상담사 실명 전달 여부

[평가 기준] 상담 종료 시 종료 인사와 함께 소속·상담사 실명을 전달하였는가?

[판정 주의] 멘트 변형은 의미 매칭으로 허용. 종료 구간 인사어 및 소속/실명 토큰 기준으로 판정.

## 텍스트 판정 신호
- 종료 구간 인사어 + 소속/실명 토큰.

## STT 주의·보정
멘트 변형 허용(의미 매칭).', '점수 단계: 3 / 1 / 0
- 3점: 종료 인사 진행 + 소속·상담사 실명 모두 전달함
- 1점: 종료 인사는 진행했으나 실명/소속 누락
- 0점: 종료 인사 미진행', '응대·표현', 'numeric', 3, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 3, '응대·표현', '공감/호응 · 쿠션어', '[평가 항목] 공감/호응 · 쿠션어

[평가 대상] 1) 고객 불편·부정 상황에 대한 즉각적 사과 표현 유무. 2) 거절·양해 상황에서의 쿠션어 사용 유무. 3) 상황에 맞는 호응 1회 이상 유무. 단순 감정 위로가 아닌 상황 자체에 대한 공감 여부.

[평가 기준] 불편·부정 상황에 즉각 사과하고, 거절·양해 시 쿠션어를 사용하며, 상황에 맞는 호응을 1회 이상 하였는가?

[판정 주의] 표현의 존재·적절성까지만 평가하며 음성 톤은 제외. 대기·묵음 등 텍스트로 판정 불가한 구간은 평가 대상에서 제외.

## 텍스트 판정 신호
- 사과/쿠션/호응 표현 사전 + 고객 감정극성 대비 적절성.

## STT 주의·보정
표현 존재·적절성까지만 평가(음성 톤 제외). 대기/묵음은 텍스트 불가로 제외.', '점수 단계: 8 / 4 / 0
- 8점: 사과·쿠션어·호응 모두 적절히 사용함
- 4점: 기계적·형식적이거나 1요소 누락, 또는 상황과 다소 불일치함
- 0점: 불편·거절 상황에 사과·쿠션어·호응 전무, ''네네'' 단순 반복함', '응대·표현', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 4, '응대·표현', '정중한 언어표현', '[평가 항목] 정중한 언어표현

[평가 대상] 상담원의 화법이 정중하고 전문적인지 확인. 1) 반말·명령형·훈계·혼잣말·습관어/사족어 등 부적절 표현 사용 여부 2) 응대 전 구간에 걸친 정중한 어휘·화법 유지 여부.

[평가 기준] 응대 전 구간에서 반말·명령·훈계·혼잣말·습관어 없이 정중하고 전문적인 화법을 사용하였는가?

[판정 주의] 음성 톤·속도·발음은 평가에서 제외하고 어휘·화법만 평가함. 반말·욕설성 어휘는 즉시 0점 처리함.

## 텍스트 판정 신호
- 반말 종결·명령형·훈계·혼잣말·사족어 키워드 사전.

## STT 주의·보정
음성 톤·속도·발음은 제외. 어휘·화법만 평가.

## 참조 데이터
### 부적절 언어 사전
- [반말·비정중 종결] ~했어 / ~하셈 / ~인데요(끝흐림) / 근데~ / 아니라니까~ / 아니 그게 아니고~ → 정중한 언어표현 → 반말 즉시 0점
- [명령·지시형] 말씀해보세요 / 들어보세요 / 그렇게 하세요 / 보시라니까요 / 기다리세요 → 정중한 언어표현 → 감점
- [훈계·다그침] 제가 말씀드렸잖아요 / 방금 말씀드렸잖아요 / 어떻게 해달란 말씀이세요?
뭘 해드릴까요? / 원하시는게 뭐에요? → 정중한 언어표현 → 0점
- [혼잣말·사족어] 음.. 그게.. / 아 진짜 / (잦은) 어~ → 정중한 언어표현 → 빈도 감점
- [불확신] 글쎄요 / 아마 그럴걸요 / 잘 모르겠는데 → 설명력·정중 → 감점(불안 유발)
- [욕설·비하] (욕설·비속어·인격 비하 표현) → 불친절 패널티(-20/콜 0점)', '점수 단계: 5 / 3 / 0
- 5점: 전 구간 정중·전문 화법 유지, 부적절 표현 없음
- 3점: 부적절 표현 1~2회 사용으로 부분 미흡
- 0점: 반말·명령·짜증·다그침·비아냥 사용, 반말·욕설성 어휘 시 즉시 해당', '응대·표현', 'numeric', 5, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 5, '정확성·설명', '니즈파악 · 재복창', '[평가 항목] 니즈파악 · 재복창

[평가 대상] 1) 고객 용건 확인 및 핵심 요지의 요약·재복창 여부 2) 거래·계좌·상품 등 식별 대상의 정확한 특정 여부 3) 이미 언급·조회 가능한 내용에 대한 불필요한 재질문 발생 여부

[평가 기준] 고객 용건을 정확히 파악하고 핵심 요지를 요약·재복창하며 불필요한 재질문 없이 응대하였는가?

[판정 주의] 계좌·상품·증권 식별자는 STT 오인식 가능성에 주의하며, 재질의 턴 카운트는 화자 라벨에 의존하므로 라벨 정확도 확인 필요.

## 텍스트 판정 신호
- 고객 발화 요약 vs 재복창 일치도, 재질의 턴 카운트.

## STT 주의·보정
계좌·상품·증권 식별자 STT 오인식 주의. 재질의 카운트는 화자 라벨 의존.', '점수 단계: 6 / 3 / 0
- 6점: 용건 정확히 파악 + 핵심 요지 요약·재복창 수행함
- 3점: 용건 파악했으나 재복창 누락, 또는 이미 언급·조회 가능 내용 재질문함
- 0점: 동문서답·반복 재질문, 또는 고객 2회 이상 재설명 유발함', '니즈파악·경청', 'numeric', 6, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 6, '정확성·설명', '설명력 · 전달력', '[평가 항목] 설명력 · 전달력

[평가 대상] 1) 고객 눈높이에 맞춘 쉬운 설명과 전문용어 지양 2) 핵심을 먼저 제시하는 두괄식 전달 3) 이해 여부를 확인하며 진행하는지

[평가 기준] 고객 눈높이의 쉬운 설명과 두괄식 핵심 전달로 이해를 확인하며 안내하였는가?

[판정 주의] 전문용어 사전 현행화 필요. 되물음 화자 귀속(고객 발화 여부) 확인 후 카운트.

## 텍스트 판정 신호
- 전문용어 사전, 두괄식 구조, 되물음 카운트.

## STT 주의·보정
전문용어 사전 현행화. 되물음 화자 귀속 필요.

## 참조 데이터
### 내부용어·약어 사전 (은행)
- "청철" → 고객용 표현: "청약철회" (약어 금지, 풀어 안내)
- "여신/수신" → 고객용 표현: "대출/예금" (고객 눈높이 표현)
- "방카" → 고객용 표현: "은행 판매 보험(방카슈랑스)"
- "지급정지" → 고객용 표현: "계좌 거래 정지(풀어 설명)" (전문어 풀어 안내)
- "거치식" → 고객용 표현: "이자만 받다가 만기에 원금(풀어 설명)" (풀어 안내)', '점수 단계: 6 / 3 / 0
- 6점: 전문용어 지양한 쉬운 설명·두괄식 핵심 전달로 이해 확인하며 진행함
- 3점: 일부 장황하거나 전문용어 사용으로 고객 되물음 1회 발생함
- 0점: 이해 불가 수준의 설명으로 상담 포기를 유발함', '설명·전달력', 'numeric', 6, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 7, '정확성·설명', '오안내 · 정확한 안내 · 금지멘트', '[평가 항목] 오안내 · 정확한 안내 · 금지멘트

[평가 대상] 1) 계좌·이체·대출·카드·상품 전반에 대한 정확한 안내 여부 2) 추측성 단정 회피 여부 3) 금지멘트(펀드 원금보장·대출 최저금리·피싱 전액환급 단정 등) 미사용 여부

[평가 기준] 계좌·이체·대출·카드·상품 전반을 정확히 안내하고, 추측성 단정을 회피하며, 금지멘트를 사용하지 않았는가?

[판정 주의] 금액·요율·한도는 STT 오인식 주의(수치 패턴 검증), 금지멘트는 의미 매칭으로 판정. 정책/약관 RAG 대조 및 금지멘트 사전 매칭(변형 포함) 후 2차 검증 권장.

## 텍스트 판정 신호
- 정책/약관 RAG 대조 + 금지멘트 사전 매칭(변형 포함).

## STT 주의·보정
금액·요율·한도 STT 오인식 주의(수치 패턴 검증). 금지멘트는 의미 매칭. 2차 검증 권장.

## 참조 데이터
### 정책·약관 기준 (오안내 판정)
- [BK-P01 이체 한도/수수료] 정답 기준: 1회/1일 이체 한도·수수료·처리(반영) 시점 정확 안내 / 대표 오안내: 한도·수수료·반영시점 오안내 (근거: [자금이체 약관·사내])
- [BK-P02 착오송금 반환] 정답 기준: 수취인 동의/착오송금 반환지원 제도로 진행됨 안내 / 대표 오안내: ‘바로 돌려받는다’ 단정 (근거: [예금거래기본약관])
- [BK-P03 대출 금리·연체] 정답 기준: 금리 유형(고정/변동)·연체 시 불이익(연체이자·신용) 정확 안내 / 대표 오안내: 우대·최저금리 단정, 연체 불이익 누락 (근거: [여신 기준])
- [BK-P04 예적금 만기·중도해지] 정답 기준: 만기·중도해지 시 이자 손실 정확 안내 / 대표 오안내: 이율 단정·중도해지 불이익 누락 (근거: [수신 약관])
- [BK-P05 펀드 원금비보장] 정답 기준: 원금 손실 가능·위험등급·수수료 고지 / 대표 오안내: ‘원금 보장/무조건 수익’ 단정 → 금지멘트 (근거: [투자상품 약관])
- [BK-P06 보이스피싱 지급정지] 정답 기준: 지급정지·피해구제 신청 절차 안내 / 대표 오안내: ‘무조건 전액 환급’ 단정 (근거: [전기통신금융사기법·사내])
- [BK-P07 카드 분실 정지/책임] 정답 기준: 분실 즉시 정지·부정사용 신고 절차 안내 / 대표 오안내: 보상·책임 범위 오안내 (근거: [카드 약관])
- [BK-P08 예금자보호] 정답 기준: 예금자보호 적용 여부·한도는 현행 기준으로 정확 안내 / 대표 오안내: 대상·한도 오안내 (근거: [예금자보호법(현행 확인)])

### 금지멘트 사전
- [투자/펀드 안내] 금지: "원금 보장된다" (변형 예: 무조건 수익/손실 없다 / 이자 높다) / 사유: 원금비보장 상품 오인 / 권장 대체: 원금 손실 가능·위험등급 안내
- [대출 안내] 금지: "무조건 승인된다" (변형 예: 최저금리로 된다 확정 / 한도 무조건 나온다) / 사유: 심사 전 단정 / 권장 대체: 심사 결과에 따라 안내
- [보이스피싱 안내] 금지: "무조건 전액 환급된다" (변형 예: 피해구제 단정) / 사유: 제도·절차 오인 / 권장 대체: 지급정지·피해구제 절차 안내
- [방카(보험) 안내] 금지: "보험료 거의 안 오른다" (변형 예: 소폭/무조건 인하) / 사유: 불완전판매 오인 / 권장 대체: 조건에 따라 변동 가능 안내
- [규정 통보] 금지: "원래 그래요" (변형 예: 규정이 그래요 / 원칙상 안돼요) / 사유: 근거 없는 통보·설득 실패 / 권장 대체: 규정 근거를 들어 설명', '점수 단계: 13 / 7 / 0
- 13점: 오안내 없이 정확하게 안내함
- 7점: 경미한 부정확 존재하나 정정 불필요한 수준
- 0점: 오안내(정정 필요)·규정 위반 안내·금지멘트 사용 중 하나 이상 발생. ※ 금지멘트 또는 사실과 다른 요율/한도/조건 안내 시 즉시 0점', '정확성·해결력', 'numeric', 13, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 8, '정확성·설명', '적극성 · 해결의지', '[평가 항목] 적극성 · 해결의지

[평가 대상] 1) 책임 있는 자세로 문의를 끝까지 처리하려는 적극성. 2) 즉시 해결 불가 시 대안·후속조치 제시 여부. 3) 처리 종료 전 추가 불편·문의 확인 여부 및 성급한 종결 유도 회피.

[평가 기준] 책임 있게 적극적으로 처리하고, 불가 시 대안·후속조치를 제시하며 추가 불편을 확인하였는가?

[판정 주의] 능동 제안 발화와 회피 패턴 사전을 기준으로 판정하며, STT 오인식 가능성을 고려해 능동/회피 표현을 보정 후 적용.

## 텍스트 판정 신호
- 능동 제안 발화 + 회피 패턴 사전.

## STT 주의·보정
회피/능동 표현 사전 구축.

## 참조 데이터
### 표현 사전 (회피·능동)
- [회피·소극] 저희 부서가 아니라 모른다 / 원래 그래요 / 어쩔 수 없어요 / 해드릴수 없어요.
처리 안되세요. → 적극성 → 감점/0점
- [떠넘김] 앱에서 직접 하시면 돼요(처리 안 함) / 홈페이지 보세요 / 앱,홈페이지에 나와요 → 적극성 → 부분 이하
- [능동·해결] 제가 처리해 드리겠습니다 / 바로 도와드리겠습니다 / 확인해서 연락드리겠습니다
도움드리지 못해 죄송합니다. → 적극성 → 가점 신호', '점수 단계: 5 / 3 / 0
- 5점: 적극적으로 책임 처리 + 추가 불편·문의 확인까지 수행함
- 3점: 해결은 하였으나 대안·후속조치 제시가 미흡함
- 0점: 회피·떠넘김 등 해결 의지 없음', '정확성·해결력', 'numeric', 5, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 9, '컴플라이언스(금융규정)', '본인확인 절차 · 순서 · 항목', '[평가 항목] 본인확인 절차 · 순서 · 항목

[평가 대상] 계좌/거래/정보 안내·처리 이전 본인확인 선행 여부. 1) 2가지 정보(성함+생년월일 등) 확인 또는 본인인증 완료. 2) 제3자 통화 시 통화자명·명의자·관계 확인. 3) 본인확인 → 안내/처리 순서 준수.

[평가 기준] 계좌/거래/정보 안내·처리 전 2가지 이상 정보 확인 또는 본인인증을 선행하고 올바른 순서로 진행하였는가?

[판정 주의] 생년월일·번호는 STT 오인식 위험이 크므로 자리수·패턴 검증 후 저신뢰 시 강등하고, 순서는 전사 턴 순서로 판정. 미확인 상태 정보 제공은 개인정보 패널티와 중복 적용.

## 텍스트 판정 신호
- 본인확인 발화 → 안내/처리 발화 순서, 항목 키워드(성함·생년월일·계좌/카드번호 등).

## STT 주의·보정
생년월일·번호 STT 오인식 위험 큼 → 자리수·패턴 검증, 저신뢰 시 강등. 순서는 전사 턴 순서로 판정.

## 참조 데이터
### 본인확인 스키마 (확인 항목)
- 가입자명/통화자명: 성함 일치 + 통화자-명의자 관계 확인 (STT 주의: 동음이의·받아쓰기 오류)
- 생년월일: 본인확인 2요소 중 하나로 대조 (STT 주의: 숫자 오인식 → 자리수 검증)
- 휴대폰번호: 등록 번호 일치 (STT 주의: 숫자열 오인식 주의)
- 계좌번호: 계좌·거래 본인확인 (STT 주의: 숫자열 길이·패턴 검증)
- 카드번호 뒷자리: 카드 본인확인 (STT 주의: 숫자 오인식)
- 증권번호: 방카(보험) 본인확인 (STT 주의: 영숫자 혼동)

### 본인확인 정멘트 골격
- [BK-S01 본인확인 도입] 계좌/거래 안내 전 성함·생년월일 등 본인확인 요청 / 필수 요소·순서: 본인확인 선행·항목 / 허용 변형: 표현 변형 허용

### 고객 답변 인정·불인정 기준
- 인정(동의/적합성 확인): 네 / 예 / 해주세요 / 알겠어요 / 그렇게 해주세요 / 동의합니다 /
신청할게요 / 그렇게 해주세요 (할게요) → 동의·확인 성립으로 인정
- 불인정·불분명: 글쎄요 / 생각해볼게요 / 잘 모르겠어요 / (무응답) → 미수득 → 0점·신뢰도 강등
- 거절: 아니요 / 안 할래요 / 필요 없어요 / 됐습니다 / 그만 하세요 / 안듣고 싶어요 → 가입/진행 불가 — 중단 여부 확인', '점수 단계: 12 / 6 / 0
- 12점: 2요소 이상 정보 확인 또는 본인인증 완료 + 본인확인 선행 순서 준수
- 6점: 확인 항목 1개 누락 또는 본인확인·안내 순서 혼선
- 0점: 본인확인 미이행 후 계좌/거래 정보 안내, 확인 항목 2개 이상 누락, 또는 생년월일 미확인·전산 불일치', '컴플라이언스', 'numeric', 12, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 10, '컴플라이언스(금융규정)', '개인정보 · 정보보호', '[평가 항목] 개인정보 · 정보보호

[평가 대상] 1) 고객 정보 선언급 여부(고객 확인 발화보다 정보 발화가 선행하는지) 2) 동의 없는 정보 활용 여부 3) 제3자 정보 미제공 준수 여부 4) 정보 취급 가이드 준수 여부

[평가 기준] 고객 정보 선언급·동의 없는 활용·제3자 유출 없이 정보 취급 가이드를 준수하였는가?

[판정 주의] 선언급 판정은 정보 발화와 고객 확인 발화의 순서에 의존(텍스트로 판정 가능). 정보 토큰 STT 오인식 주의. 0점 시 개인정보 보호 위반 패널티(-10/-20) 별도 적용.

## 텍스트 판정 신호
- 정보 발화가 고객 확인 발화보다 선행하는지 순서 검사.

## STT 주의·보정
선언급 판정은 발화 순서에 의존(텍스트로 가능). 정보 토큰 STT 오인식 주의.', '점수 단계: 8 / 4 / 0
- 8점: 정보 취급 가이드 준수, 선언급·동의 없는 활용·제3자 제공 없음
- 4점: 경미한 절차 미흡(확인 순서 혼선 등) 존재하나 위반 없음
- 0점: 정보 선언급·동의 없는 활용·제3자 유출 중 하나 이상 발생', '컴플라이언스', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 11, '컴플라이언스(금융규정)', '업무별 필수안내 (이체·대출·계좌·카드 등)', '[평가 항목] 업무별 필수안내 (이체·대출·계좌·카드 등)

[평가 대상] 문의 업무유형별 필수안내 이행 여부. 1) 이체(한도·수수료·반영시점) 2) 대출(금리유형·상환·중도상환수수료·연체 불이익) 3) 계좌(서류·해지 영향) 4) 카드(연회비·실적·분실 정지·재발급) 5) 외환(서류·한도·소요). TA 상담유형별 필수안내 체크리스트(RAG)와 발화 의미 매칭으로 판정.

[평가 기준] 문의 업무유형에 따른 필수안내(금리·연체 불이익·수수료·지급정지 절차 등)를 빠짐없이 이행하였는가?

[판정 주의] 금리·한도·수수료 등 수치는 STT 검증을 거쳐 TA 상담유형과 연계하여 판정. 잘못된 안내는 ''오안내''와 중복 0점 처리.

## 텍스트 판정 신호
- 업무유형(TA 상담유형)별 필수안내 체크리스트(RAG) → 발화 의미 매칭.

## STT 주의·보정
수치(금리·한도·수수료) STT 검증. TA 상담유형(이체/대출/카드 등)과 연계.

## 참조 데이터
### 업무별 필수안내 체크리스트 (은행 전체)
- [1.1 계좌/수신>계좌 개설/해지][필수] 개설에 필요한 신분증·구비서류와 자격(연령·실명확인 등) 요건을 구체적으로 안내. 어떤 서류가 필요한지 명시해야 충족.
  · 충족 예: "비대면 개설은 본인 명의 휴대폰과 신분증, 본인 명의 타행 계좌만 있으면 가능하세요."
  · 미충족 예: "개설은 그냥 신청하시면 돼요. (필요 서류·자격 언급 없음)"
- [1.1 계좌/수신>계좌 개설/해지][필수] 신규 계좌가 금융거래한도계좌로 개설될 수 있음과, 한도 해제에 필요한 증빙(급여이체·공과금 등)·방법을 안내.
  · 충족 예: "처음엔 거래한도계좌로 열려 하루 이체가 제한되는데, 급여이체나 공과금 실적 등록하시면 한도를 풀어드려요."
  · 미충족 예: "계좌 바로 열어드릴게요. (한도계좌·해제 방법 미안내)"
- [1.1 계좌/수신>계좌 개설/해지][필수] 개설 계좌의 1회/1일 입출금·이체 한도와 증액 방법을 안내.
  · 충족 예: "이 계좌는 1회 100만 원, 하루 300만 원까지 이체되고 한도는 영업점에서 증액 가능하세요."
  · 미충족 예: "한도는 알아서 잡혀요. (구체 한도·증액 방법 누락)"
- [1.1 계좌/수신>계좌 개설/해지][필수] 해지 전 연결된 자동이체·연계상품·잔액/미납을 확인하고 해지 후 영향을 안내.
  · 충족 예: "해지하시면 이 계좌로 등록된 자동이체가 모두 끊기니, 먼저 옮기실 곳을 정해두시는 게 좋아요."
  · 미충족 예: "네 해지 처리해 드렸습니다. (자동이체·잔액 영향 미확인)"
- [1.1 계좌/수신>계좌 개설/해지][권장] 비대면 개설 절차 또는 영업점 방문 필요 여부를 안내.
  · 충족 예: "이 상품은 비대면 가입되지만, 외국인 등록증은 영업점 방문이 필요하세요."
  · 미충족 예: "(비대면/영업점 방문 여부 안내 없음)"
- [1.2 계좌/수신>입출금][필수] 본인확인 완료 후 거래내역을 안내(미확인 상태 안내 금지).
  · 충족 예: "본인 확인 도와주시면 최근 거래내역 확인해서 안내드릴게요."
  · 미충족 예: "최근 거래는 OO상점 5만 원이요. (본인확인 전 내역 노출)"
- [1.2 계좌/수신>입출금][필수] 한도 변경 시 변경 가능한 1회/1일 한도와 증액 조건·필요 서류를 안내.
  · 충족 예: "이체 한도는 하루 최대 1억까지 올릴 수 있는데, 1천만 원 초과는 증빙서류와 영업점 확인이 필요하세요."
  · 미충족 예: "한도는 그냥 올려드릴게요. (변경 한도·증빙 조건 누락)"
- [1.2 계좌/수신>입출금][필수] 한도 상향·고액 이체 시 OTP 등 보안매체가 필요함을 안내.
  · 충족 예: "한도를 올리시려면 OTP나 보안카드 등록이 먼저 필요하세요."
  · 미충족 예: "바로 올려드렸어요. (OTP 등 보안매체 필요 미안내)"
- [1.3 계좌/수신>예금/적금][필수] 적용 금리(기본+우대조건)와 만기를 구체적으로 안내.
  · 충족 예: "기본 3.0%에 급여이체 우대 0.5% 더해 연 3.5%, 12개월 만기 상품이에요."
  · 미충족 예: "이자 잘 나오는 상품이에요. (금리·만기 수치 없음)"
- [1.3 계좌/수신>예금/적금][필수] 중도해지 시 중도해지이율 적용으로 이자가 크게 줄고 세금이 부과됨을 안내.
  · 충족 예: "만기 전에 해지하시면 중도해지이율이 적용돼 약정 이자보다 많이 줄어드세요."
  · 미충족 예: "중간에 해지해도 이자 다 받으세요. (중도해지이율 손실 오안내)"
- [1.3 계좌/수신>예금/적금][필수] 예금자보호 적용 여부와 한도(현행 기준)를 안내.
  · 충족 예: "이 예금은 예금자보호 대상이라 1인당 원리금 합산 보호한도까지 보호되세요."
  · 미충족 예: "(예금자보호 여부·한도 안내 없음)"
- [1.3 계좌/수신>예금/적금][권장] 가입/해지 절차와 만기 자동연장 여부를 안내.
  · 충족 예: "만기 후 따로 신청 안 하시면 같은 조건으로 자동 연장돼요."
  · 미충족 예: "(자동연장 여부 안내 없음)"
- [2.1 이체/송금>이체 처리][필수] 이체 1회/1일 한도와 수수료(타행·영업시간 외 등)를 안내.
  · 충족 예: "타행 이체는 건당 500원 수수료가 있고, 우대 조건이면 면제되세요."
  · 미충족 예: "그냥 보내시면 돼요. (한도·수수료 미안내)"
- [2.1 이체/송금>이체 처리][필수] 즉시/지연/지정시간 이체의 반영 시점을 안내.
  · 충족 예: "지금 보내시면 바로 입금되지만, 지연이체 설정 시 3시간 뒤에 처리되세요."
  · 미충족 예: "바로 가요. (지연/지정시간 이체 반영 시점 누락)"
- [2.1 이체/송금>이체 처리][필수] 이체 실패 사유와 재처리·반환 절차를 안내.
  · 충족 예: "수취 계좌가 막혀 있어 반송됐고, 보내신 금액은 1~2영업일 내 다시 입금되세요."
  · 미충족 예: "실패했네요. 다시 해보세요. (사유·반환 절차 미안내)"
- [2.2 이체/송금>이체 한도/설정][필수] 1회/1일 한도와 증액 조건·필요한 보안매체를 안내.
  · 충족 예: "지금 한도가 하루 1천만 원인데, 더 올리시려면 OTP 등록 후 신청하시면 돼요."
  · 미충족 예: "한도 올려드렸어요. (증액 조건·보안매체 누락)"
- [2.2 이체/송금>이체 한도/설정][필수] 자동이체 출금일과 등록/변경/해지 절차를 안내.
  · 충족 예: "자동이체는 매월 25일 출금으로 등록되고, 해지는 앱에서 바로 가능하세요."
  · 미충족 예: "자동이체 등록됐어요. (출금일·변경/해지 절차 누락)"
- [2.2 이체/송금>이체 한도/설정][권장] 출금일 잔액 부족 시 처리(미납·재출금)를 안내.
  · 충족 예: "출금일에 잔액이 부족하면 그날은 출금이 안 되고 다음 영업일에 재출금돼요."
  · 미충족 예: "(잔액 부족 시 처리 안내 없음)"
- [2.3 이체/송금>이체 문제][필수] 착오송금은 즉시 반환되지 않고 수취인 동의 또는 예금보험공사 반환지원 제도로 진행되며 소요기간·수수료가 있음을 안내.
  · 충족 예: "잘못 보내신 돈은 받으신 분 동의가 있어야 돌려받을 수 있고, 어려우면 예금보험공사 반환지원 제도로 신청하실 수 있어요."
  · 미충족 예: "제가 바로 취소해서 돈 돌려드릴게요. (즉시 반환 가능으로 오안내)"
- [2.3 이체/송금>이체 문제][필수] 즉시이체는 원칙적으로 취소 불가하며 가능한 조건을 안내.
  · 충족 예: "이미 상대 계좌로 입금돼서 임의 취소는 어렵고, 받으신 분께 반환 요청을 하셔야 해요."
  · 미충족 예: "취소되니까 걱정 마세요. (취소 불가 원칙 오안내)"
- [2.3 이체/송금>이체 문제][필수] 착오송금 신고·접수 절차를 안내.
  · 충족 예: "착오송금 반환 신청 접수 도와드릴게요."
  · 미충족 예: "(신고/접수 절차 안내 없음)"
- [3.1 카드>카드 발급/재발급][필수] 연회비·실적 조건·발급/배송 소요를 안내.
  · 충족 예: "이 카드는 연회비 1만 원, 전월 30만 원 이상 쓰시면 혜택이 적용되고 발급은 3~5일 걸리세요."
  · 미충족 예: "좋은 카드예요. 신청해 드릴게요. (연회비·실적·소요 누락)"
- [3.1 카드>카드 발급/재발급][필수] 재발급 사유별 수수료와 배송 방식을 안내.
  · 충족 예: "분실 재발급은 수수료 2천 원이고 등기로 3~4일 내 받으세요."
  · 미충족 예: "재발급해 드릴게요. (수수료·배송 안내 누락)"
- [3.1 카드>카드 발급/재발급][필수] 발급은 심사 결과에 따른다는 점을 안내(무조건 승인 단정 금지).
  · 충족 예: "신청은 도와드리는데 발급 여부는 심사 후 결정되세요."
  · 미충족 예: "무조건 발급되니까 걱정 마세요. (승인 단정 — 금지)"
- [3.2 카드>카드 이용][필수] 이용한도·변경 조건·임시한도를 안내.
  · 충족 예: "지금 한도가 300만 원인데, 다음 달까지 임시로 100만 원 더 올려드릴 수 있어요."
  · 미충족 예: "한도 그 정도 되실 거예요. (임시한도·변경 조건 누락)"
- [3.2 카드>카드 이용][필수] 승인 거절 사유 확인 방법을 안내.
  · 충족 예: "한도 초과로 거절된 거라, 한도 상향하시거나 일부 결제 후 다시 시도하시면 돼요."
  · 미충족 예: "글쎄요 왜 안 되는지 모르겠네요. (거절 사유 확인 방법 미안내)"
- [3.2 카드>카드 이용][필수] 본인확인 후 이용내역을 안내.
  · 충족 예: "본인 확인되시면 이용내역 안내드릴게요."
  · 미충족 예: "이번 달 200만 원 쓰셨네요. (본인확인 전 내역 노출)"
- [3.3 카드>카드 해지/분실][필수] 분실/도난 즉시 카드 정지와 부정사용 신고 절차를 안내.
  · 충족 예: "지금 바로 분실 등록해 카드 정지해 드릴게요. 모르는 결제가 있으면 부정사용 신고도 함께 도와드려요."
  · 미충족 예: "일단 기다려 보시고 내일 다시 전화 주세요. (즉시 정지 미조치 — 중대)"
- [3.3 카드>카드 해지/분실][필수] 부정사용 보상 신청과 책임 범위(신고 시점 기준 등)를 안내.
  · 충족 예: "신고 접수일 기준으로 보상 신청이 가능하고 조사 후 결과 안내드려요."
  · 미충족 예: "어쩔 수 없어요. (보상 신청·책임 범위 미안내)"
- [3.3 카드>카드 해지/분실][필수] 해지 시 연회비 환급·자동납부 영향·포인트 소멸을 안내.
  · 충족 예: "해지하시면 이 카드로 등록된 자동납부가 끊기고 남은 포인트는 소멸되세요."
  · 미충족 예: "네 해지됐어요. (자동납부·포인트 소멸 영향 미안내)"
- [3.4 카드>카드 혜택/결제][필수] 결제일·결제방법과 연체 시 불이익(연체이자·신용영향)을 안내.
  · 충족 예: "결제일은 매월 14일이고, 연체되면 연체이자와 신용에 영향이 있을 수 있으세요."
  · 미충족 예: "결제일에 빠져나가요. (연체 시 불이익 누락)"
- [3.4 카드>카드 혜택/결제][권장] 포인트 적립/소멸/사용 조건을 안내.
  · 충족 예: "포인트는 결제일에 자동 적립되고 적립 후 5년 지나면 소멸돼요."
  · 미충족 예: "(포인트 조건 안내 없음)"
- [4.1 대출/여신>대출 상담][필수] 고정/변동 금리 유형과 산정 기준(기준금리+가산금리 등)을 안내.
  · 충족 예: "이 대출은 변동금리라 6개월마다 기준금리에 따라 바뀌고 지금 기준 연 5%대예요."
  · 미충족 예: "금리 싸요. (고정/변동·산정 기준 누락)"
- [4.1 대출/여신>대출 상담][필수] 한도·금리는 심사 후 확정됨을 안내(최저금리·무조건 단정 금지).
  · 충족 예: "정확한 한도와 금리는 심사해봐야 나와서 지금은 예상 범위로만 안내드려요."
  · 미충족 예: "최저금리로 무조건 되세요. (단정 — 금지)"
- [4.1 대출/여신>대출 상담][필수] 대출 자격과 필요 서류를 안내.
  · 충족 예: "재직증명서와 소득금액증명원이 필요하세요."
  · 미충족 예: "(자격·서류 안내 없음)"
- [4.2 대출/여신>대출 신청/실행][필수] 신청 서류·심사 절차·소요기간을 안내.
  · 충족 예: "서류 제출하시면 심사에 보통 2~3영업일 걸리세요."
  · 미충족 예: "신청만 하시면 돼요. (서류·심사 소요 누락)"
- [4.2 대출/여신>대출 신청/실행][필수] 실행 조건과 인지세 등 부대비용을 안내.
  · 충족 예: "실행 시 인지세는 대출금액에 따라 고객님과 은행이 반반 부담하세요."
  · 미충족 예: "바로 나가요. (부대비용 안내 누락)"
- [4.2 대출/여신>대출 신청/실행][필수] 대출 철회권(일정 기간 내 비용 없이 철회)을 안내.
  · 충족 예: "실행 후 14일 이내에는 비용 부담 없이 대출을 철회하실 수 있으세요."
  · 미충족 예: "(대출 철회권 안내 없음)"
- [4.3 대출/여신>대출 상환][필수] 상환 방법(원리금균등 등)·상환일을 안내.
  · 충족 예: "원리금균등 방식으로 매월 17일에 상환되세요."
  · 미충족 예: "매달 갚으시면 돼요. (방식·상환일 누락)"
- [4.3 대출/여신>대출 상환][필수] 중도상환수수료율과 면제 조건을 안내.
  · 충족 예: "3년 이내 중도상환하시면 잔액의 일정률 수수료가 있고 3년 지나면 면제되세요."
  · 미충족 예: "미리 갚으셔도 돼요. (중도상환수수료 미안내)"
- [4.3 대출/여신>대출 상환][필수] 연체 시 연체이자·기한이익상실·신용 불이익을 안내.
  · 충족 예: "연체가 길어지면 기한이익이 상실돼 전액 상환 요청이 들어올 수 있고 신용에도 영향이 있으세요."
  · 미충족 예: "조금 늦어도 괜찮아요. (연체 불이익 축소·오안내)"
- [5.1 인증/보안>인증수단][필수] 인증서 발급/갱신 절차와 유효기간을 안내.
  · 충족 예: "금융인증서는 1년마다 갱신하셔야 하고 앱에서 바로 가능하세요."
  · 미충족 예: "인증서 받으시면 돼요. (유효기간·갱신 안내 누락)"
- [5.1 인증/보안>인증수단][필수] OTP/보안카드 발급·재발급·분실 처리를 안내.
  · 충족 예: "OTP 분실하시면 기존 건 정지하고 영업점에서 재발급 받으셔야 해요."
  · 미충족 예: "(OTP 분실 처리 안내 없음)"
- [5.1 인증/보안>인증수단][권장] 간편/생체인증 등록 시 보안 유의를 안내.
  · 충족 예: "간편인증 등록은 본인 기기에서만 하시고 공용 기기는 피하세요."
  · 미충족 예: "(보안 유의 안내 없음)"
- [5.2 인증/보안>보안 사고][필수] 비밀번호 오류/초기화 시 본인확인 절차를 안내.
  · 충족 예: "비밀번호 5회 틀려 잠기셨는데 본인 확인 후 초기화 도와드릴게요."
  · 미충족 예: "(본인확인 절차 없이 초기화 진행)"
- [5.2 인증/보안>보안 사고][필수] 계정 잠김/정지 해제 절차를 안내.
  · 충족 예: "보안 잠금은 본인 확인되시면 바로 풀어드려요."
  · 미충족 예: "원래 잠기면 풀기 어려워요. (해제 절차 미안내)"
- [5.2 인증/보안>보안 사고][필수] 보이스피싱/사기 의심 시 즉시 지급정지, 경찰(112)·금감원(1332) 신고, 피해구제 신청 절차를 안내.
  · 충족 예: "지금 바로 계좌 지급정지부터 해드릴게요. 그리고 112에 신고하시고 피해금 환급을 위한 피해구제 신청도 도와드려요."
  · 미충족 예: "음 일단 은행 영업시간에 다시 오세요. (즉시 지급정지·신고 미안내 — 중대)"
- [5.2 인증/보안>보안 사고][필수] 비밀번호 변경·악성앱 점검 등 추가 피해 방지를 안내.
  · 충족 예: "혹시 모르니 비밀번호 바꾸시고, 악성앱이 깔렸을 수 있어 휴대폰 점검도 권해드려요."
  · 미충족 예: "(추가 피해 방지 안내 없음)"
- [6.1 외환/해외>환전][필수] 적용 환율(고시/우대)과 환전 수수료를 안내.
  · 충족 예: "지금 고시 환율 기준에 환율우대 50% 적용해서 안내드릴게요."
  · 미충족 예: "환전되세요. (환율·수수료 안내 누락)"
- [6.1 외환/해외>환전][필수] 환전 신청·수령 방법·한도·신분증 지참을 안내.
  · 충족 예: "환전 신청하시면 내일 영업점에서 수령 가능하고 신분증 지참하셔야 해요."
  · 미충족 예: "(수령 방법·신분증 안내 없음)"
- [6.2 외환/해외>해외송금][필수] 필요 서류와 연간 한도/증빙을 안내.
  · 충족 예: "건당 5천 달러를 넘으면 증빙서류가 필요하고 연간 한도 내에서 송금되세요."
  · 미충족 예: "그냥 보내드릴게요. (서류·한도 누락)"
- [6.2 외환/해외>해외송금][필수] 송금·중계·수취 수수료와 소요시간을 안내.
  · 충족 예: "송금수수료 외에 중계은행 수수료가 더 붙을 수 있고 보통 2~3일 걸리세요."
  · 미충족 예: "수수료 얼마 안 해요. (중계 수수료·소요 누락)"
- [6.2 외환/해외>해외송금][권장] 송금 진행상태 확인 방법을 안내.
  · 충족 예: "송금 추적번호로 진행상태 확인하실 수 있어요."
  · 미충족 예: "(진행상태 확인 방법 안내 없음)"
- [7.1 금융상품/투자>투자상품][필수] 투자성향(적합성) 확인 후 성향에 맞는 상품을 권유함을 안내.
  · 충족 예: "먼저 투자성향 확인부터 도와드릴게요. 성향에 맞는 상품만 권해드려요."
  · 미충족 예: "이거 그냥 가입하시면 돼요. (적합성 확인 생략 — 금지)"
- [7.1 금융상품/투자>투자상품][필수] 원금 손실 가능·예금자보호 비대상·위험등급을 명확히 고지.
  · 충족 예: "이 펀드는 예금과 달리 원금이 보장되지 않고 손실이 날 수 있는 위험등급 3등급 상품이에요."
  · 미충족 예: "예금처럼 안전하고 원금 보장돼요. (원금비보장 미고지·오안내 — 금지)"
- [7.1 금융상품/투자>투자상품][필수] 보수/수수료와 환매 조건·기간을 안내.
  · 충족 예: "운용보수가 연 1.2%이고 환매하시면 영업일 기준 3~4일 뒤에 대금이 들어오세요."
  · 미충족 예: "(보수·환매 조건 안내 없음)"
- [7.1 금융상품/투자>투자상품][필수] 투자설명서·약관 제공을 안내.
  · 충족 예: "투자설명서와 약관 보내드릴 테니 확인 부탁드려요."
  · 미충족 예: "(설명서·약관 제공 안내 없음)"
- [7.2 금융상품/투자>보험/방카][필수] 보험료·납입기간·주요 보장내용을 안내.
  · 충족 예: "월 보험료 5만 원에 20년 납입이고 주요 보장은 입원·수술비예요."
  · 미충족 예: "좋은 보험이에요. (보험료·보장 누락)"
- [7.2 금융상품/투자>보험/방카][필수] 갱신 시 보험료가 변동될 수 있음을 안내(거의 안 오른다 등 단정 금지).
  · 충족 예: "갱신형이라 갱신 시점 나이·요율에 따라 보험료가 오를 수 있으세요."
  · 미충족 예: "갱신해도 보험료 거의 안 올라요. (단정 — 금지)"
- [7.2 금융상품/투자>보험/방카][필수] 청약철회·품질보증 해지 가능 기간을 안내.
  · 충족 예: "가입 후 청약철회 기간 안에는 보험료 전액 돌려받고 해지하실 수 있어요."
  · 미충족 예: "(청약철회 기간 안내 없음)"
- [7.3 금융상품/투자>자산관리][필수] 본인확인 후 보유 자산·수익률을 조회 안내.
  · 충족 예: "본인 확인되시면 보유 자산과 수익률 안내드릴게요."
  · 미충족 예: "수익률 마이너스 3%네요. (본인확인 전 자산 노출)"
- [7.3 금융상품/투자>자산관리][필수] 수익률은 과거 실적이며 미래 수익을 보장하지 않음을 고지.
  · 충족 예: "안내드린 수익률은 과거 기준이라 앞으로의 수익을 보장하는 건 아니세요."
  · 미충족 예: "앞으로도 이 수익 계속 나와요. (미래 보장 오안내)"
- [8.1 회원/계정>가입/이용][필수] 뱅킹 가입 절차·본인인증을 안내.
  · 충족 예: "모바일뱅킹 가입은 본인 명의 휴대폰 인증 후 바로 가능하세요."
  · 미충족 예: "(가입 절차·본인인증 안내 없음)"
- [8.1 회원/계정>가입/이용][권장] 이용 방법·보안 유의(비밀번호 관리)를 안내.
  · 충족 예: "비밀번호는 주기적으로 바꿔주시고 공용 와이파이는 피하세요."
  · 미충족 예: "(보안 유의 안내 없음)"
- [8.2 회원/계정>정보 관리][필수] 본인확인 후 개인정보를 변경.
  · 충족 예: "본인 확인되시면 연락처 변경 도와드릴게요."
  · 미충족 예: "주소 OO로 바꿔드렸어요. (본인확인 없이 변경)"
- [8.2 회원/계정>정보 관리][필수] 마케팅 수신 동의/철회는 본인 의사 확인 후 처리하고 철회 방법을 안내.
  · 충족 예: "마케팅 수신은 원하실 때 앱 설정이나 전화로 언제든 철회하실 수 있어요."
  · 미충족 예: "마케팅은 그냥 다 받으셔야 해요. (철회 방법 미안내·오안내)"
- [9.1 시스템/기술>앱/웹 오류][필수] 오류 재현/해결 방법을 안내.
  · 충족 예: "앱을 최신 버전으로 업데이트하시고 재실행해 보시겠어요?"
  · 미충족 예: "원래 가끔 그래요. (해결 방법 미안내)"
- [9.1 시스템/기술>앱/웹 오류][필수] 거래 오류 시 중복처리 여부를 확인하고 정정 절차를 안내.
  · 충족 예: "이체가 두 번 빠졌는지 확인해서 중복이면 바로 정정해 드릴게요."
  · 미충족 예: "중복인지는 모르겠네요. (중복 확인·정정 미안내)"
- [9.2 시스템/기술>점검/장애][필수] 점검 시간·영향 범위·대체 채널을 안내.
  · 충족 예: "오늘 새벽 2~4시 시스템 점검이라 그 시간엔 이체가 제한되세요."
  · 미충족 예: "(점검 시간·대체 채널 안내 없음)"
- [10.1 기타/일반>일반 문의][필수] 영업점/ATM/영업시간을 정확히 안내.
  · 충족 예: "가까운 영업점은 OO지점이고 영업시간은 평일 9시부터 4시까지예요."
  · 미충족 예: "찾아보시면 나와요. (정확한 안내 회피)"
- [10.2 기타/일반>기타][권장] 문의에 맞는 적절 부서/채널을 안내.
  · 충족 예: "그 업무는 영업점 방문이 필요해서 가까운 지점 안내드릴게요."
  · 미충족 예: "그건 저희가 안 해요. (적절 채널 안내 없이 회피)"', '점수 단계: 12 / 6 / 0
- 12점: 해당 업무 필수안내 모두 이행
- 6점: 부가 항목 누락(핵심 이행) 또는 부정확한 발음으로 필수안내 전달 미흡
- 0점: 핵심 필수안내(금리·연체 불이익·수수료·지급정지 절차 등) 미이행, 잘못된 안내 시 오안내와 중복 0점', '컴플라이언스', 'numeric', 12, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 12, '컴플라이언스(금융규정)', '금융상품 가입 적합성 · 필수고지', '[평가 항목] 금융상품 가입 적합성 · 필수고지

[평가 대상] 예적금·펀드 등 금융상품 가입 상담에서 1) 고객 투자성향(적합성) 확인 여부, 2) 예적금 만기·중도해지 손실 및 펀드 원금비보장·위험등급·수수료 등 필수 고지 이행 여부. 가입성 상담에 한함.

[평가 기준] 적합성을 확인하고 원금비보장·손실 등 핵심 사항을 필수 고지하였는가?

[판정 주의] 가입성 상담이 아니면 N/A 처리(점수 산정 제외·재정규화). 펀드 원금비보장 단정 누락은 금지멘트와 연계 판단.

## 텍스트 판정 신호
- 적합성 질의 + 원금비보장/위험등급/만기·중도해지 고지 발화.

## STT 주의·보정
가입성 상담이 아니면 N/A 처리. 펀드 원금비보장 단정 누락은 금지멘트와 연계.

## 참조 데이터
### 필수안내 체크리스트 (금융상품/투자)
- [7.1 금융상품/투자>투자상품][필수] 투자성향(적합성) 확인 후 성향에 맞는 상품을 권유함을 안내.
  · 충족 예: "먼저 투자성향 확인부터 도와드릴게요. 성향에 맞는 상품만 권해드려요."
  · 미충족 예: "이거 그냥 가입하시면 돼요. (적합성 확인 생략 — 금지)"
- [7.1 금융상품/투자>투자상품][필수] 원금 손실 가능·예금자보호 비대상·위험등급을 명확히 고지.
  · 충족 예: "이 펀드는 예금과 달리 원금이 보장되지 않고 손실이 날 수 있는 위험등급 3등급 상품이에요."
  · 미충족 예: "예금처럼 안전하고 원금 보장돼요. (원금비보장 미고지·오안내 — 금지)"
- [7.1 금융상품/투자>투자상품][필수] 보수/수수료와 환매 조건·기간을 안내.
  · 충족 예: "운용보수가 연 1.2%이고 환매하시면 영업일 기준 3~4일 뒤에 대금이 들어오세요."
  · 미충족 예: "(보수·환매 조건 안내 없음)"
- [7.1 금융상품/투자>투자상품][필수] 투자설명서·약관 제공을 안내.
  · 충족 예: "투자설명서와 약관 보내드릴 테니 확인 부탁드려요."
  · 미충족 예: "(설명서·약관 제공 안내 없음)"
- [7.2 금융상품/투자>보험/방카][필수] 보험료·납입기간·주요 보장내용을 안내.
  · 충족 예: "월 보험료 5만 원에 20년 납입이고 주요 보장은 입원·수술비예요."
  · 미충족 예: "좋은 보험이에요. (보험료·보장 누락)"
- [7.2 금융상품/투자>보험/방카][필수] 갱신 시 보험료가 변동될 수 있음을 안내(거의 안 오른다 등 단정 금지).
  · 충족 예: "갱신형이라 갱신 시점 나이·요율에 따라 보험료가 오를 수 있으세요."
  · 미충족 예: "갱신해도 보험료 거의 안 올라요. (단정 — 금지)"
- [7.2 금융상품/투자>보험/방카][필수] 청약철회·품질보증 해지 가능 기간을 안내.
  · 충족 예: "가입 후 청약철회 기간 안에는 보험료 전액 돌려받고 해지하실 수 있어요."
  · 미충족 예: "(청약철회 기간 안내 없음)"
- [7.3 금융상품/투자>자산관리][필수] 본인확인 후 보유 자산·수익률을 조회 안내.
  · 충족 예: "본인 확인되시면 보유 자산과 수익률 안내드릴게요."
  · 미충족 예: "수익률 마이너스 3%네요. (본인확인 전 자산 노출)"
- [7.3 금융상품/투자>자산관리][필수] 수익률은 과거 실적이며 미래 수익을 보장하지 않음을 고지.
  · 충족 예: "안내드린 수익률은 과거 기준이라 앞으로의 수익을 보장하는 건 아니세요."
  · 미충족 예: "앞으로도 이 수익 계속 나와요. (미래 보장 오안내)"

### 정멘트 골격 (동의·적합성·원금비보장)
- [BK-S02 정보제공 동의(상품 가입)] 제공 항목·목적·거부권 고지 후 동의 확인 / 필수 요소·순서: 항목·목적·거부권·동의 / 허용 변형: 항목 나열 변형 허용
- [BK-S03 펀드 적합성·원금비보장 고지] 투자성향 확인 + 원금 손실 가능·위험등급 고지 / 필수 요소·순서: 적합성 + 원금비보장 / 허용 변형: 멘트 변형 허용, 원금비보장 필수

### 동의/적합성 답변 인정·불인정 기준
- 인정(동의/적합성 확인): 네 / 예 / 해주세요 / 알겠어요 / 그렇게 해주세요 / 동의합니다 /
신청할게요 / 그렇게 해주세요 (할게요) → 동의·확인 성립으로 인정
- 불인정·불분명: 글쎄요 / 생각해볼게요 / 잘 모르겠어요 / (무응답) → 미수득 → 0점·신뢰도 강등
- 거절: 아니요 / 안 할래요 / 필요 없어요 / 됐습니다 / 그만 하세요 / 안듣고 싶어요 → 가입/진행 불가 — 중단 여부 확인', '점수 단계: 8 / 4 / 0
- 8점: 적합성(투자성향) 확인 + 원금비보장·손실 등 필수 고지 이행함
- 4점: 고지는 하였으나 일부 항목(수수료·위험등급 등) 누락함
- 0점: 적합성 미확인 후 권유 또는 원금비보장·중도해지 손실 등 핵심 고지 누락함', '컴플라이언스', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (1, 13, '컴플라이언스(금융규정)', '보안사고 대응 (분실·피싱·부정거래)', '[평가 항목] 보안사고 대응 (분실·피싱·부정거래)

[평가 대상] 분실·도난·보이스피싱·부정거래 등 보안사고 인지 시 대응의 적절성. 1) 즉시 정지/지급정지 안내 여부 2) 신고·피해구제 절차 안내 여부 3) 재발급 등 후속 절차 안내 여부. 사고 키워드(분실/피싱/모르는 출금) 포착 후 정지·지급정지·신고 안내 발화 확인.

[평가 기준] 보안사고 인지 시 즉시 정지/지급정지 안내와 함께 신고·피해구제 절차를 적절히 안내하였는가?

[판정 주의] 사고성 상담이 아니면 N/A. 사고 누락이 최대 리스크이므로 사고 정황을 우선 포착. ''무조건 환급'' 등 단정은 금지멘트와 중복 적용.

## 텍스트 판정 신호
- 사고 키워드(분실/피싱/모르는 출금) → 정지·지급정지·신고 안내 발화.

## STT 주의·보정
사고성 상담이 아니면 N/A. 사고 누락이 최대 리스크 → 우선 포착.

## 참조 데이터
### 정책 기준 (지급정지·분실 절차)
- [BK-P06 보이스피싱 지급정지] 정답 기준: 지급정지·피해구제 신청 절차 안내 / 대표 오안내: ‘무조건 전액 환급’ 단정 (근거: [전기통신금융사기법·사내])
- [BK-P07 카드 분실 정지/책임] 정답 기준: 분실 즉시 정지·부정사용 신고 절차 안내 / 대표 오안내: 보상·책임 범위 오안내 (근거: [카드 약관])

### 정멘트 골격 (피싱 지급정지)
- [BK-S04 보이스피싱 지급정지 안내] 지급정지 신청·피해구제 절차 안내 / 필수 요소·순서: 지급정지 + 피해구제 / 허용 변형: 멘트 변형 허용', '점수 단계: 8 / 4 / 0
- 8점: 사고 인지 후 즉시 정지/지급정지 안내 + 신고·피해구제 절차 안내 모두 수행함
- 4점: 정지/지급정지는 안내했으나 피해구제·재발급 등 후속 절차 안내 미흡함
- 0점: 사고 정황을 놓치거나 지급정지/정지 등 즉시 조치 미안내함', '컴플라이언스', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 1, '응대·표현', '첫인사', '[평가 항목] 첫인사

[평가 대상] 첫 상담사 턴에서 1) 인사말, 2) 소속(센터/부서) 명사, 3) 상담사 실명(''○○○입니다'') 3요소의 발화 여부. 본 문의 진입 전 인사 완료 여부. 호전환 건은 ''연결받았습니다''+실명 인정(소속 생략 허용).

[평가 기준] 첫 상담사 턴에서 인사말·소속·실명 3요소를 본 문의 진입 전 모두 발화하였는가?

[판정 주의] 실명은 STT 오인식이 잦으므로 끝맺음 패턴(''~입니다'')으로 추출하고 단순 미일치로 0점 처리 금지. 화자 라벨이 상담사 첫 턴을 올바르게 가리키는지 확인.

## 텍스트 판정 신호
- 첫 상담사 턴의 인사말 + 소속 명사 + 실명 토큰(‘○○○입니다’).

## STT 주의·보정
실명 STT 오인식 잦음 → 끝맺음 패턴으로 추출, 단순 미일치로 0점 금지. 화자 라벨이 상담사 첫 턴을 맞게 가리키는지 확인.', '점수 단계: 5 / 3 / 0
- 5점: 첫 상담사 턴에서 인사말+소속+실명 3요소를 본 문의 진입 전 모두 발화함(호전환 시 ''연결받았습니다''+실명 인정, 소속 생략 허용)
- 3점: 인사말과 실명은 발화하였으나 소속 명사가 누락되는 등 일부 요소 미흡
- 0점: 인사말·소속·실명 중 다수 요소 누락 또는 첫 인사 자체 부재', '응대·표현', 'numeric', 5, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 2, '응대·표현', '끝인사 · 추가문의 확인', '[평가 항목] 끝인사 · 추가문의 확인

[평가 대상] 통화 종료 구간 상담사 발화에서 1) 추가 문의 확인 의문형(''더 도와드릴 점 없으십니까'' 등) 2) 종료 인사어 3) 상담사 실명 제시 여부. 고객의 추가 문의가 있으면 응대 후 끝인사 재이행 여부도 함께 봄.

[평가 기준] 종료 전 추가 문의 확인, 종료 인사, 상담사 실명을 모두 이행하고, 추가 문의 발생 시 응대 후 끝인사를 재이행하였는가?

[판정 주의] ''선종료(상담사 먼저 끊음)''는 통화 로그 영역이라 평가하지 않고, 발화 순서로 판정 가능한 추가문의 확인·끝인사 누락만 본다.

## 텍스트 판정 신호
- 종료 구간 상담사 턴의 추가문의 의문형 + 종료 인사어 + 실명.

## STT 주의·보정
‘선종료(상담사 먼저 끊음)’는 통화 로그 영역이라 평가 안 함 — 발화 순서로 판정 가능한 ‘추가문의 확인·끝인사 누락’만 본다.', '점수 단계: 5 / 3 / 0
- 5점: 추가 문의 확인 의문형 + 종료 인사 + 상담사 실명 모두 이행함. 추가 문의 발생 시 응대 후 끝인사 재이행까지 충족함
- 3점: 추가 문의 확인·종료 인사·실명 중 일부만 이행하거나, 추가 문의 후 끝인사 재이행이 미흡함
- 0점: 추가 문의 확인·종료 인사·실명 모두 누락함', '응대·표현', 'numeric', 5, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 3, '응대·표현', '화답인사', '[평가 항목] 화답인사

[평가 대상] 1) 고객이 먼저 인사 또는 감사 표현을 한 턴이 선행하였는지 여부. 2) 그 직후 상담사 턴에서 ''네, 안녕하세요'', ''감사합니다'' 등으로 적절히 화답하였는지 매칭. 3) 고객의 선행 인사가 없는 경우 화답 의무 미발생.

[평가 기준] 고객이 먼저 인사 또는 감사를 표현했을 때 상담사가 적절히 화답하였는가?

[판정 주의] 고객의 ''네/안녕하세요'' 단답이 STT에서 누락되지 않도록 보존하여 판정하며, 화자 라벨 뒤바뀜 시 오판에 유의함.

## 텍스트 판정 신호
- 고객 턴의 인사 발화 선행 여부 → 직후 상담사 턴 화답 매칭.

## STT 주의·보정
고객 ‘네/안녕하세요’ 단답이 STT에서 누락되지 않도록 보존. 화자 라벨 뒤바뀜 시 오판 주의.', '점수 단계: 3 / 1 / 0
- 3점: 고객의 선행 인사·감사에 상담사가 적절히 화답함, 또는 고객 인사가 없어 화답 의무 미발생(자동 충족)
- 1점: 고객의 선행 인사·감사에 화답하였으나 표현이 형식적이거나 일부 미흡함
- 0점: 고객의 선행 인사·감사가 있었음에도 화답이 누락됨', '응대·표현', 'numeric', 3, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 4, '응대·표현', '공감/호응 · 쿠션어', '[평가 항목] 공감/호응 · 쿠션어

[평가 대상] 1) 불편·부정 상황 발생 시 즉각적·구체적 사과 여부, 2) 거절·양해 요청 시 쿠션어(''번거로우시겠지만~'' 등) 사용 여부, 3) 상황 맥락에 맞는 호응 1회 이상 여부. 단순 감정 반응이 아닌 상황 맥락 기반 공감 표현 확인.

[평가 기준] 불편·부정 상황에 즉각·구체적으로 사과하고, 거절·양해 시 쿠션어를 사용하며, 상황에 맞는 호응을 1회 이상 표현하였는가?

[판정 주의] 사과·쿠션·호응 표현의 존재와 적절성까지만 텍스트로 확정. 음성 톤(따뜻함/사무적)은 평가 제외하며 표현이 있으면 인정. 고객 발화 감정극성(불만/긴급) 대비 적절성 및 ''네'' 반복 카운트 참고.

## 텍스트 판정 신호
- 사과/쿠션/호응 표현 사전 + 고객 발화 감정극성(불만/긴급) 대비 적절성. ‘네’ 반복 카운트.

## STT 주의·보정
‘표현의 존재·적절성’까지만 텍스트로 확정. 음성 톤(따뜻함/사무적)은 평가 제외 — 표현이 있으면 인정.

## 참조 데이터
### 표현 사전 (회피·능동·부적절 언어)
- 회피·소극: 저희 부서가 아니라 모른다 / 원래 그래요 / 어쩔 수 없어요 → 적극성 → 감점/0점
- 떠넘김: 앱에서 직접 하시면 돼요(처리 안 함) / 홈페이지 보세요 → 적극성 → 부분 이하
- 능동·해결: 제가 처리해 드리겠습니다 / 바로 도와드리겠습니다 / 확인해서 연락드리겠습니다 → 적극성 → 가점 신호
- 반말·비정중 종결: ~했어 / ~하셈 / ~인데요(끝흐림) → 정중한 언어표현 → 반말 즉시 0점
- 명령·지시형: 말씀해보세요 / 들어보세요 / 그렇게 하세요 → 정중한 언어표현 → 감점
- 훈계·다그침: 제가 말씀드렸잖아요 / 방금 말씀드렸잖아요 / 어떻게 해달란 말씀이세요? → 정중한 언어표현 → 0점
- 혼잣말·사족어: 음.. 그게.. / 아 진짜 / (잦은) 어~ → 정중한 언어표현 → 빈도 감점
- 불확신: 글쎄요 / 아마 그럴걸요 / 잘 모르겠는데 → 설명력·정중 → 감점(불안 유발)
- 욕설·비하: (욕설·비속어·인격 비하 표현) → 불친절 패널티(-20/콜 0점)

### 정멘트 (규정 멘트 · 필수 요소·순서)
- 고객 불만 상황: “불편을 드려 죄송합니다.” — 필수 요소: 사과 + 공감', '점수 단계: 8 / 4 / 0
- 8점: 불편·부정 상황 즉각·구체적 사과, 거절·양해 시 쿠션어 사용, 상황 맥락에 맞는 호응 1회 이상 모두 충족
- 4점: 사과·쿠션어·호응 중 일부만 충족하거나 상황 맥락 공감이 부분적으로 미흡함
- 0점: 사과·쿠션어·호응 표현 전반 부재 또는 단순 감정 반복으로 상황 맥락 공감 미충족', '응대·표현', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 5, '응대·표현', '정중한 언어표현', '[평가 항목] 정중한 언어표현

[평가 대상] 텍스트의 어휘·화법만 평가. 1) 정중·전문 화법 유지 여부 2) 반말 종결어미·명령형·지시형·훈계조·혼잣말·과도한 사족어 사용 여부 3) 확신 없는 표현으로 고객 불안 유발 여부.

[평가 기준] 반말·명령형·훈계조·혼잣말·사족어·불확신 표현 없이 정중하고 전문적인 화법을 일관되게 유지하였는가?

[판정 주의] 음성 톤·속도·발음 등 청취 영역과 사투리·억양은 본 항목 제외, 텍스트 어휘·화법만 평가.

## 텍스트 판정 신호
- 반말 종결어미·명령형·훈계·혼잣말·사족어·불확신 표현 키워드 사전(빈도 카운트).

## STT 주의·보정
음성 톤·속도·발음(청취 영역)은 본 항목 제외. 텍스트의 어휘·화법만 평가. 사투리·억양 미평가.

## 참조 데이터
### 부적절 언어 사전 (반말·명령·훈계·혼잣말·사족어 — 표현 사전 발췌)
- 반말·비정중 종결: ~했어 / ~하셈 / ~인데요(끝흐림) → 정중한 언어표현 → 반말 즉시 0점
- 명령·지시형: 말씀해보세요 / 들어보세요 / 그렇게 하세요 → 정중한 언어표현 → 감점
- 훈계·다그침: 제가 말씀드렸잖아요 / 방금 말씀드렸잖아요 / 어떻게 해달란 말씀이세요? → 정중한 언어표현 → 0점
- 혼잣말·사족어: 음.. 그게.. / 아 진짜 / (잦은) 어~ → 정중한 언어표현 → 빈도 감점
- 불확신: 글쎄요 / 아마 그럴걸요 / 잘 모르겠는데 → 설명력·정중 → 감점(불안 유발)
- 욕설·비하: (욕설·비속어·인격 비하 표현) → 불친절 패널티(-20/콜 0점)', '점수 단계: 7 / 4 / 0
- 7점: 전 구간 정중·전문 화법 유지. 반말 종결어미·명령형·지시형·훈계조·혼잣말·과도한 사족어 없음. 확신 없는 표현으로 불안 유발 안 함
- 4점: 대체로 정중하나 사족어·불확신 표현 등 일부 부적절 화법이 산발 노출되어 정중성 부분 미흡
- 0점: 반말·명령형·훈계조·혼잣말 등 부적절 화법 다수 사용 또는 확신 없는 표현으로 고객 불안 유발', '응대·표현', 'numeric', 7, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 6, '문제 해결', '니즈파악 · 상품 특정 · 재복창', '[평가 항목] 니즈파악 · 상품 특정 · 재복창

[평가 대상] 1) 고객 용건 확인 여부, 2) 문의 상품을 ''주문일+상품명'' 또는 ''브랜드+상품명''으로 특정했는지, 3) 핵심 요지 재복창 여부. 이미 언급되었거나 조회 가능한 내용을 재질문하지 않았는지 함께 확인.

[평가 기준] 용건을 확인하고 문의 상품을 식별자로 특정하며 핵심 요지를 재복창하고 불필요한 재질문을 하지 않았는가?

[판정 주의] 상품명·주문일 STT 오인식 시 특정 오판 가능 → 주문 데이터 대조 권장. 재질의 카운트는 화자 라벨에 의존하므로 라벨 신뢰도 확인 필요.

## 텍스트 판정 신호
- 고객 발화 요약 vs 재복창 의미 일치도(NLU), 상품 식별자 토큰 존재, 동일 질문 반복 턴 카운트.

## STT 주의·보정
상품명·주문일 STT 오인식 시 특정 오판 → 주문 데이터 대조 권장. 재질의 카운트는 화자 라벨 의존.', '점수 단계: 8 / 4 / 0
- 8점: 용건 확인 · 상품 특정(주문일+상품명 또는 브랜드+상품명) · 핵심 요지 재복창 모두 충족하고 불필요한 재질문 없음
- 4점: 용건 확인 · 상품 특정 · 재복창 중 일부만 수행하거나, 상품 식별자 일부 누락 또는 재복창 의미 일치도 미흡
- 0점: 용건 미확인, 상품 특정 누락, 재복창 부재, 또는 이미 언급/조회 가능 내용 반복 재질문', '니즈파악·경청', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 7, '문제 해결', '설명력 (내부용어 지양·두괄식)', '[평가 항목] 설명력 (내부용어 지양·두괄식)

[평가 대상] 고객 눈높이의 쉬운 설명 여부를 본다. 1) 사내 용어·약어 미사용(예: ''구확취'' 대신 ''구매확정 후 취소'') 2) 결론·핵심을 먼저 제시하는 두괄식 구조 3) 장황하지 않은 간결한 전달과 고객 되물음(''무슨 말이에요/다시'') 발생 정도.

[평가 기준] 내부 용어·약어 없이 고객 눈높이로 두괄식·간결하게 설명하였는가?

[판정 주의] 내부 용어 사전 현행화 필수. 되물음은 고객 턴에 귀속하여 카운트.

## 텍스트 판정 신호
- 내부 용어/약어 사전 매칭, 두괄식 구조, 고객 ‘무슨 말이에요/다시’ 되물음 카운트.

## STT 주의·보정
내부 용어 사전 현행화 필수. 되물음은 고객 턴 귀속 필요.

## 참조 데이터
### 내부용어·약어 사전 (사용 시 감점 대상 → 고객용 쉬운 표현)
- 구확취 → 구매확정 후 취소
- 이관 남기다 → 담당 부서 확인 후 연락
- ‘돌 들어온다’(은어) → 정산 예정 금액 (은어 금지)
- ‘벌점’ → 판매자 페널티
- 파센 → 파트너센터 (약어 풀어 안내)
- 히스(히스토리)/이력 → 상담 이력 (내부용어 고객 안내)
- 미출 → 아직 출고전 상태', '점수 단계: 8 / 4 / 0
- 8점: 사내 용어·약어 미사용 + 두괄식 핵심 우선 + 간결 설명 모두 충족, 고객 되물음 없음
- 4점: 두괄식·쉬운 설명 일부 이행하나 내부 용어·약어 잔존 또는 장황·되물음 발생 등 부분 미흡
- 0점: 내부 용어·약어 다수 사용 또는 두괄식 미적용·과도한 장황으로 고객 이해 곤란, 반복 되물음 유발', '설명·전달력', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 8, '문제 해결', '정확한 안내 · 오안내 · 복합문의 답변', '[평가 항목] 정확한 안내 · 오안내 · 복합문의 답변

[평가 대상] 1) 정책·규정·약관에 부합하는 정확한 안내 여부, 2) 추측성·단정적 표현 회피 여부, 3) 복합 문의 시 모든 질문에 누락 없이 답변했는지, 4) 금지·오인 소지 멘트 미사용 여부.

[평가 기준] 정책에 부합하는 정확한 안내와 추측성·단정 표현 회피, 복합 문의 전 항목 답변, 금지·오인 멘트 미사용을 모두 충족하였는가?

[판정 주의] 오안내 판정은 정책 DB 현행화에 의존하므로 금액·조건 등 핵심 수치는 STT 오인식 시 재확인하고 2차 검증 권장.

## 텍스트 판정 신호
- 정책/약관 RAG 조회 → 발화 사실 대조, 질문 발화 추출 → 답변 매칭으로 누락 검사, 금지/단정 표현 사전.

## STT 주의·보정
오안내 판정은 정책 DB 현행화 의존. 금액·조건 수치 STT 오인식 시 핵심 수치 재확인. 2차 검증 권장.

## 참조 데이터
### 정책·약관 기준 (오안내 판정)
※ 수치·정책은 사내 정책/약관 기준 예시 — 적용 상황별 정답 기준과 대표 오안내 패턴:
- [EC-P01] 환불 소요일 — 정답 기준: 환불 수단별 처리 소요일 정확 안내 (예: 카드 취소 영업일 3~5일 — 사내 기준) / 대표 오안내: ‘바로 환불된다/오늘 들어온다’ 확정 단정 / 근거: [사내 환불정책 vX]
- [EC-P02] 단순변심 반품 배송비 — 정답 기준: 단순변심 시 반품 배송비 고객 부담 안내(편도/왕복 사내값) / 대표 오안내: ‘무료 반품’ 일괄 안내 / 근거: [반품정책]
- [EC-P03] 청약철회 기간 — 정답 기준: 단순변심 청약철회 가능기간·예외(주문제작·개봉 등) 안내 / 대표 오안내: 기간/예외 누락·오안내 / 근거: [전자상거래법·사내]
- [EC-P04] 교환 배송비/재고없음 — 정답 기준: 교환 배송비·재고 없을 때 처리(환불 전환 등) 안내 / 대표 오안내: 재고 확인 없이 ‘무조건 교환’ 단정 / 근거: [교환정책]
- [EC-P05] 쿠폰 중복/유효기간 — 정답 기준: 쿠폰 중복 사용 가부·유효기간 정확 안내 / 대표 오안내: ‘다 적용된다’ 등 부정확 / 근거: [프로모션정책]
- [EC-P06] 적립금 소멸/탈퇴 시 처리 — 정답 기준: 적립금 소멸 조건·탈퇴 시 처리 정확 안내 / 대표 오안내: 소멸·환원 조건 오안내 / 근거: [멤버십정책]
- 제품하자(불량) / 반품 — 정답 기준: 제품하자(불량)에 대한 증빙 안내 or 판매자/업체 사전 확인 후 안내 / 대표 오안내: 증빙 or 판매자 확인없이 반품 가능 안내 / 근거: [반품정책]
- 본인인증 / 회원 — 정답 기준: 본인 확인 절차 안내 필수 / 대표 오안내: 본인확인 절차 누락 안내 / 근거: [회원정책]
- 배송·출고일 / 배송 — 정답 기준: 주문제작상품 or  예약배송상품 등 배송예정일 확인 후 안내 / 대표 오안내: 실제 출고 예정일과 다르게 임의 안내 / 근거: [배송정책]
- 판매중지·품절상품/ 배송 — 정답 기준: 판매중지·품절상품 배송 가능여부 확인 후 안내 / 대표 오안내: 재입고 확정 오안내 / 근거: [배송정책]

### 금지멘트 사전
- [처리 가부] 금지: 무조건 됩니다 (변형 예: 100% 환불/확정 단정) — 사유: 확인 전 단정 → 권장 대체: 확인 후 안내드리겠습니다
- [책임 귀속] 금지: 고객님이 잘못 누르신 거예요 (변형 예: 책임전가 표현) — 사유: 고객 불쾌·분쟁 → 권장 대체: 원인 설명 + 해결 안내로 전환
- [환불 장담] 금지: 오늘 환불됩니다. 전액 보장 (변형 예: 무조건 환불, 전액 보장 단정) — 사유: 정책 확인· 리스크 → 권장 대체: 환불, 보장 정책 확인 후 안내로 전환
- [규정 통보] 금지: 원래 그래요 (변형 예: 규정이 그래요) — 사유: 근거 없는 통보·설득 실패 → 권장 대체: 규정 근거를 들어 설명', '점수 단계: 18 / 9 / 0
- 18점: 정책·규정에 부합하는 정확한 안내, 추측성·단정 표현 없음, 복합 문의 전 질문 누락 없이 답변, 금지·오인 멘트 미사용으로 전 조건 충족함
- 9점: 핵심 안내는 정확하나 일부 질문 누락 또는 경미한 추측성·단정 표현이 섞여 부분 미흡함
- 0점: 정책 불부합 오안내, 복합 문의 다수 질문 누락, 또는 금지·오인 멘트 사용 등 미충족·위반함', '정확성·해결력', 'numeric', 18, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 9, '문제 해결', '적극성 · 대안 · 셀프서비스 안내', '[평가 항목] 적극성 · 대안 · 셀프서비스 안내

[평가 대상] 1) 처리 가능 건을 책임지고 끝까지 완료하는 능동적 태도. 2) 처리 불가 시 대안·후속조치 제시 여부. 3) 고객 자가 해결을 위한 어드민 경로·매뉴얼 안내 및 추가 불편 선제 확인. 떠넘김(''앱에서 가능합니다'')·회피(''원래 그래요'')와 능동 해결(''제가 처리해 드리겠습니다'')을 대조하여 판정.

[평가 기준] 처리 가능 건을 책임지고 완료하고, 불가 시 대안·후속조치와 셀프서비스 경로를 안내하며 추가 불편을 선제 확인하였는가?

[판정 주의] ''앱에서 가능합니다''식 떠넘김과 ''제가 처리하겠습니다''식 능동 해결을 구분. STT 상 회피/능동 발화 혼동에 유의.

## 텍스트 판정 신호
- 능동 제안 발화(‘제가 처리해 드리겠습니다’) vs 떠넘김, 회피 패턴 사전(‘원래 그래요’) 대조.

## STT 주의·보정
‘앱에서 가능합니다’(떠넘김)와 ‘제가 처리하겠습니다’(해결) 구분 룰. 회피/능동 사전 구축.

## 참조 데이터
### 표현 사전 (회피·능동 발췌)
- 회피·소극: 저희 부서가 아니라 모른다 / 원래 그래요 / 어쩔 수 없어요 → 적극성 → 감점/0점
- 떠넘김: 앱에서 직접 하시면 돼요(처리 안 함) / 홈페이지 보세요 → 적극성 → 부분 이하
- 능동·해결: 제가 처리해 드리겠습니다 / 바로 도와드리겠습니다 / 확인해서 연락드리겠습니다 → 적극성 → 가점 신호', '점수 단계: 10 / 5 / 0
- 10점: 처리 가능 건을 책임지고 완료하거나, 불가 시 대안·후속조치 제시 및 셀프서비스 경로 안내와 추가 불편 선제 확인까지 능동적으로 수행함
- 5점: 일부는 처리·안내하였으나 대안 제시, 셀프서비스 경로 안내, 추가 불편 확인 중 일부가 미흡함
- 0점: 책임 회피·떠넘김으로 일관하거나 대안·후속조치·셀프서비스 안내가 전혀 없음', '정확성·해결력', 'numeric', 10, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 10, '문제 해결', '필수안내 (반품·환불 절차/소요일)', '[평가 항목] 필수안내 (반품·환불 절차/소요일)

[평가 대상] 문의 유형(TA 결과)별 필수안내 항목의 누락 없는 전달 여부. 1) 반품/교환 절차·조건, 2) 환불 금액·소요일, 3) 회수 방법·약속 시간 등 문의 유형별 체크리스트 항목의 안내 충실도.

[평가 기준] 문의 유형별 필수안내 항목(반품/교환 절차·조건, 환불 금액·소요일, 회수 방법, 약속 시간 등)을 누락 없이 전달하였는가?

[판정 주의] STT 누락으로 안내가 미탐되지 않도록 발화 키워드를 의미 기반으로 매칭하여 판정. TA 의도·상담유형과 연계해 해당 문의 유형의 필수안내 체크리스트를 적용.

## 텍스트 판정 신호
- 문의 유형(TA 결과)별 필수안내 체크리스트(RAG) → 발화 키워드 의미 매칭.

## STT 주의·보정
STT 누락으로 안내 미탐 방지 위해 의미 매칭. TA 의도·상담유형과 연계.

## 참조 데이터
### 필수안내 체크리스트 (문의유형별)
※ ''✓''=충족 인정 발화 예시, ''✗''=누락·오안내·회피 예시. [필수]=누락 시 강감점/0점, [권장]=부가.
#### 주문/결제 > 주문 (1.1)
- [필수] 주문 방법·절차를 안내. | ✓ 장바구니에 담으신 뒤 결제하기를 누르시면 주문이 완료돼요. | ✗ (주문 방법 안내 없음)
- [필수] 본인확인/주문확인 후 주문내역을 안내. | ✓ 주문번호나 가입정보 확인되시면 주문내역 안내드릴게요. | ✗ 고객님 주문은 OO상품이요. (주문/본인확인 전 노출)
- [필수] 주문 오류/실패 사유와 재주문·중복결제 여부를 확인 안내. | ✓ 결제가 중간에 끊기셨는데 중복으로 빠진 건 없는지 확인하고 안내드릴게요. | ✗ 결제 안 됐으면 다시 하세요. (중복결제 여부 미확인)
#### 주문/결제 > 결제 (1.2)
- [필수] 사용 가능한 결제 수단을 안내. | ✓ 카드, 계좌이체, 간편결제로 결제 가능하세요. | ✗ (결제 수단 안내 없음)
- [필수] 결제 실패 사유와 중복결제 시 환불을 안내. | ✓ 승인은 한 번만 됐고 이중으로 잡힌 승인은 자동 취소되세요. | ✗ 두 번 결제됐는지는 모르겠어요. (중복결제 환불 미안내)
- [필수] 결제 취소/변경 가능 시점·방법을 안내. | ✓ 출고 전이라 결제수단 변경은 취소 후 재주문으로 도와드려요. | ✗ 결제수단은 못 바꿔요. (취소 후 재주문 등 방법 미안내)
- [권장] 영수증/현금영수증 발급 방법을 안내. | ✓ 현금영수증은 마이페이지에서 발급하실 수 있어요. | ✗ (영수증 발급 방법 안내 없음)
#### 배송/물류 > 배송 조회 (2.1)
- [필수] 본인확인/주문확인 후 배송상태·송장을 안내. | ✓ 주문번호 확인되시면 지금 배송 상태 안내드릴게요. | ✗ 지금 OO동에 있어요. (주문/본인확인 전 배송정보 노출)
- [필수] 배송 예정일(영업일 기준)을 안내. | ✓ 오늘 출고되면 영업일 기준 1~2일 내 받으세요. | ✗ 곧 도착해요. (예정일 모호·미안내)
#### 배송/물류 > 배송 변경 (2.2)
- [필수] 배송지/일정 변경 가능 시점(출고 전)과 방법을 안내. | ✓ 아직 출고 전이라 배송지 변경 가능하고 제가 바로 수정해 드릴게요. | ✗ 변경 안 돼요. (출고 전 변경 가능 여부·방법 미안내)
- [권장] 변경 불가 시 대안을 안내. | ✓ 이미 출고돼서 변경은 어렵고, 받으신 뒤 반품·재주문으로 도와드릴 수 있어요. | ✗ (대안 안내 없음)
#### 배송/물류 > 배송 문제 (2.3)
- [필수] 지연 사유·예상 도착일·보상을 안내. | ✓ 물류 지연으로 늦어지고 있고 OO일까지는 도착 예정이며 지연 보상은 적립금으로 안내드려요. | ✗ 택배사에 물어보세요. (사유·예상일·보상 미안내·떠넘김)
- [필수] 오배송/분실 회수·재배송·보상 절차를 안내. | ✓ 다른 상품이 갔네요. 바로 회수 보내고 정상 상품 재배송해 드릴게요. | ✗ 고객님이 잘못 받으신 거 아니에요? (회수·재배송 절차 미안내·책임전가)
- [필수] 파손/훼손 사진 접수 후 교환/환불 절차를 안내. | ✓ 파손 사진 보내주시면 확인 후 교환이나 환불로 처리해 드려요. | ✗ 파손은 어쩔 수 없어요. (접수·교환/환불 절차 미안내)
#### 취소/반품/교환/환불 > 주문 취소 (3.1)
- [필수] 취소 가능 시점(출고 전)과 방법을 안내. | ✓ 아직 출고 전이라 지금 바로 취소되시고 결제는 자동 취소돼요. | ✗ 취소 안 돼요. (출고 전 취소 가능 여부 오안내)
- [필수] 출고 후에는 반품 전환됨과 환불 시점을 안내. | ✓ 이미 출고돼서 취소는 어렵고 받으신 뒤 반품으로 진행하시면 돼요. | ✗ (출고 후 반품 전환·환불 시점 미안내)
#### 취소/반품/교환/환불 > 반품 (3.2)
- [필수] 반품 신청·회수 방법과 입고 후 처리를 안내. | ✓ 반품 신청하시면 택배기사가 방문 회수하고 입고 확인 후 처리돼요. | ✗ 반품하세요. (회수 방법·입고 후 처리 미안내)
- [필수] 반품 배송비 부담 주체·금액을 사유별로 명확히 안내(단순변심=고객, 하자=판매자). | ✓ 단순 변심이면 왕복 배송비 5천 원이 부과되고 상품 하자면 배송비는 저희가 부담해요. | ✗ 반품은 무료예요. (단순변심 배송비 부담 오안내)
- [필수] 반품 가능 기간과 개봉/사용 시 제한을 안내. | ✓ 수령 후 7일 이내 가능하고 택을 떼거나 사용하시면 반품이 제한될 수 있어요. | ✗ 아무 때나 반품돼요. (기간·개봉/사용 제한 미안내)
#### 취소/반품/교환/환불 > 교환 (3.3)
- [필수] 교환 절차·조건·추가 비용을 안내. | ✓ 교환은 동일 상품 다른 옵션으로 가능하고 단순 변심이면 배송비가 있어요. | ✗ 교환되세요. (조건·추가 비용 미안내)
- [필수] 재고 없을 때 환불 전환을 안내. | ✓ 원하시는 옵션이 품절이라 교환 대신 환불로 도와드릴게요. | ✗ 품절이라 그냥 기다리세요. (환불 전환 미안내)
#### 취소/반품/교환/환불 > 환불 (3.4)
- [필수] 환불 금액 산정(배송비·쿠폰·적립 차감)을 안내. | ✓ 받으신 쿠폰 할인과 적립금은 회수되고 실제 결제하신 금액 기준으로 환불돼요. | ✗ 결제하신 금액 그대로 다 돌려드려요. (쿠폰·적립 회수 미반영 오안내)
- [필수] 환불 수단별 소요 기간을 구체적으로 안내(‘곧/빠르게’ 등 모호 표현만으론 미충족). | ✓ 카드 결제는 취소 후 영업일 3~5일, 계좌 환불은 1~2일 내 처리되세요. | ✗ 곧 환불돼요. (소요일 모호 — 미충족)
- [필수] 환불 수단(원결제 취소 원칙)을 안내. | ✓ 원결제 취소가 원칙이라 결제하신 카드로 취소돼요. | ✗ 현금으로 드릴게요. (원결제 취소 원칙 오안내)
#### 상품/재고 > 상품 정보 (4.1)
- [필수] 사양/상세를 정확히 안내하고 불확실하면 확인 후 안내(추측 단정 금지). | ✓ 정확한 호환 사양은 제가 확인해서 안내드릴게요. | ✗ 아마 호환될 거예요. (불확실 추측 단정)
- [권장] 사용법/호환성을 안내. | ✓ 이 모델은 OO 시리즈와 호환되세요. | ✗ (사용법/호환성 안내 없음)
#### 상품/재고 > 재고/입고 (4.2)
- [필수] 재입고 예정은 확정된 경우만 안내하고 미정이면 단정 금지. | ✓ 재입고 일정이 아직 확정 전이라 입고 알림 신청해 두시면 들어오는 대로 알려드려요. | ✗ 다음 주에 무조건 들어와요. (미확정 단정)
- [권장] 입고 알림 신청 방법을 안내. | ✓ 상품 페이지에서 재입고 알림 신청하시면 돼요. | ✗ (알림 신청 방법 안내 없음)
#### 상품/재고 > 가격 (4.3)
- [필수] 가격·할인 적용 조건·기간을 안내. | ✓ 이 할인가는 이번 주말까지 적용되고 쿠폰 중복은 안 되세요. | ✗ 할인되세요. (조건·기간 미안내)
#### 회원/계정 > 회원 가입/탈퇴 (5.1)
- [필수] 가입 절차·혜택을 안내. | ✓ 가입하시면 첫 구매 쿠폰이 바로 지급돼요. | ✗ (가입 절차·혜택 안내 없음)
- [필수] 탈퇴 시 적립금/쿠폰 소멸·재가입 제한·개인정보 처리를 안내. | ✓ 탈퇴하시면 남은 적립금과 쿠폰이 모두 소멸되고 동일 정보 재가입은 일정 기간 제한될 수 있어요. | ✗ 탈퇴해도 적립금 그대로예요. (소멸·재가입 제한 오안내)
#### 회원/계정 > 로그인/인증 (5.2)
- [필수] 본인확인 후 로그인/비밀번호 재설정 절차를 안내. | ✓ 본인 확인되시면 비밀번호 재설정 링크 보내드릴게요. | ✗ 비번 OOOO로 바꿔드렸어요. (본인확인 없이 처리·노출)
- [권장] 본인인증 실패 시 대안을 안내. | ✓ 휴대폰 인증이 안 되시면 아이핀이나 이메일 인증으로도 가능하세요. | ✗ (대안 안내 없음)
#### 회원/계정 > 회원 정보 (5.3)
- [필수] 본인확인 후 정보를 변경. | ✓ 본인 확인되시면 연락처 변경 도와드릴게요. | ✗ 주소 바꿔드렸어요. (본인확인 없이 변경)
- [권장] 결제수단/주소 관리 보안 유의를 안내. | ✓ 결제수단 정보는 안전하게 암호화 저장되니 안심하셔도 돼요. | ✗ (보안 유의 안내 없음)
#### 혜택/프로모션 > 쿠폰/적립금 (6.1)
- [필수] 쿠폰 발급/사용 조건·중복 사용 가부·유효기간을 안내. | ✓ 이 쿠폰은 3만 원 이상 구매 시 사용 가능하고 다른 쿠폰과 중복은 안 되며 발급 후 14일 내 쓰셔야 해요. | ✗ 쿠폰 그냥 쓰시면 돼요. (조건·중복·유효기간 누락)
- [필수] 적립금 소멸 시점을 안내. | ✓ 적립금은 적립일로부터 1년 지나면 소멸돼요. | ✗ 적립금 안 없어져요. (소멸 시점 오안내)
#### 혜택/프로모션 > 멤버십/등급 (6.2)
- [필수] 등급 산정 기준·혜택·기간을 안내. | ✓ 최근 3개월 구매금액으로 등급이 정해지고 등급별 추가 적립과 무료배송 혜택이 있어요. | ✗ (등급 기준·혜택 안내 없음)
#### 혜택/프로모션 > 이벤트 (6.3)
- [필수] 이벤트 참여 조건·기간을 안내. | ✓ 이벤트는 OO일까지이고 응모는 구매 후 자동 참여돼요. | ✗ (참여 조건·기간 안내 없음)
- [권장] 경품 지급 방법·제세공과금을 안내. | ✓ 경품 당첨 시 제세공과금은 본인 부담이세요. | ✗ (제세공과금 안내 없음)
#### 시스템/기술 > 앱/웹 오류 (7.1)
- [필수] 오류 해결 방법을 안내. | ✓ 앱 캐시 삭제 후 재로그인해 보시겠어요? | ✗ 원래 그래요. (해결 방법 미안내)
- [필수] 결제·주문 오류 시 중복 여부를 확인 안내. | ✓ 결제가 두 번 잡혔는지 확인해서 중복이면 즉시 환불해 드릴게요. | ✗ 중복인지 모르겠어요. (중복 확인 미안내)
#### 시스템/기술 > 알림/메시지 (7.2)
- [필수] 알림 수신 설정/해제 방법을 안내. | ✓ 푸시 알림은 앱 설정 알림 메뉴에서 켜고 끄실 수 있어요. | ✗ (설정/해제 방법 안내 없음)
- [권장] 마케팅 수신 동의 본인 의사를 확인. | ✓ 광고성 알림 수신은 원하실 때 철회 가능하세요. | ✗ 광고 알림은 다 받으셔야 해요. (수신 의사 미확인·오안내)
#### 기타/일반 > 일반 문의 (8.1)
- [필수] 영업시간/연락처를 정확히 안내. | ✓ 고객센터는 평일 9시부터 6시까지 운영되세요. | ✗ (영업시간 안내 없음)
#### 기타/일반 > 기타 (8.2)
- [권장] 문의에 맞는 적절 채널을 안내. | ✓ 그 부분은 담당 팀으로 연결해 드릴게요. | ✗ 그건 저희 일 아니에요. (적절 채널 안내 없이 회피)', '점수 단계: 8 / 4 / 0
- 8점: 문의 유형별 필수안내 항목(반품/교환 절차·조건, 환불 금액·소요일, 회수 방법·약속 시간 등)을 누락 없이 모두 전달함
- 4점: 필수안내 항목 일부만 전달하고 일부 항목 누락 또는 안내 미흡함
- 0점: 필수안내 항목을 전달하지 않거나 대부분 누락함', '설명·전달력', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 11, '컴플라이언스', '본인확인 절차 · 순서', '[평가 항목] 본인확인 절차 · 순서

[평가 대상] 민감 정보 안내 이전 본인확인 선행 여부. 1) 안내에 필요한 식별 정보(주문번호/연락처/성함) 적정 확인. 2) 본인확인 발화 → 안내 발화의 턴 순서 준수.

[평가 기준] 민감 정보 안내 전 본인확인을 선행하고, 필요한 식별 정보를 적정 확인한 뒤 안내 순서를 준수하였는가?

[판정 주의] 주문번호·연락처 숫자는 STT 오인식 위험이 있어 자리수·패턴 검증, 저신뢰 시 강등. 순서는 전사 턴 순서로 판정.

## 텍스트 판정 신호
- 본인확인 발화와 안내 발화의 턴 순서, 식별 정보 키워드 존재.

## STT 주의·보정
주문번호·연락처 숫자 STT 오인식 위험 → 자리수·패턴 검증, 저신뢰 시 강등. 순서는 전사 턴 순서로 판정.

## 참조 데이터
### 본인확인 스키마 (전산 일치 대조용 · 선택)
- 가입자명/통화자명: 성함 일치 + 통화자-명의자 관계 확인 (STT 주의: 동음이의·받아쓰기 오류)
- 휴대폰번호: 등록 번호 일치 (STT 주의: 숫자열 오인식 주의)
- 주문번호: 이커머스 주문 대조 (STT 주의: 길이·패턴 검증)
- 환불수단: 환불계좌/은행명/예금주 확인 (STT 주의: 은행명·이름 유사발음/숫자열 오인식 주의)
※ 실제 고객정보(PII)는 미포함 — 전산 일치 검증에만 연계. 절차·순서·항목은 전사 텍스트로 평가 가능.', '점수 단계: 8 / 4 / 0
- 8점: 민감 정보 안내 이전 본인확인 선행, 식별 정보(주문번호/연락처/성함) 적정 확인, 본인확인 → 안내 순서 준수함
- 4점: 본인확인 수행하였으나 식별 정보 확인 일부 미흡 또는 순서 부분 미준수함
- 0점: 본인확인 미수행 또는 민감 정보 안내가 본인확인보다 선행되어 순서 위반함', '컴플라이언스', 'numeric', 8, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 12, '컴플라이언스', '안내 범위 준수', '[평가 항목] 안내 범위 준수

[평가 대상] 1) 요청자가 본인인지 제3자인지에 따른 안내 가능 범위 준수 여부. 2) 본인이라도 규정상 제공 불가한 정보는 미제공하고 사유를 안내했는지. 3) 안내 가능한 업무를 회피하지 않았는지.

[평가 기준] 요청자(본인/제3자) 구분에 따라 안내 가능 범위를 준수하고, 규정상 불가 정보는 사유와 함께 미제공하며, 안내 가능 업무 회피 없이 응대하였는가?

[판정 주의] 안내 범위 규정(RAG) 대조 + 상담사 안내 내용·거절 사유 발화를 함께 확인. 정보 유출 판정 시 개인정보 보호 항목과 연계하며, 제3자 여부는 본인확인 결과와 함께 해석.

## 텍스트 판정 신호
- 안내 범위 규정(RAG) 대조 + 상담사 안내 내용/거절 사유 발화.

## STT 주의·보정
정보 유출 판정 시 개인정보 패널티 연계. 제3자 여부는 본인확인 결과와 함께 해석.

## 참조 데이터
### 정책·약관 기준 (오안내 판정)
※ 수치·정책은 사내 정책/약관 기준 예시 — 적용 상황별 정답 기준과 대표 오안내 패턴:
- [EC-P01] 환불 소요일 — 정답 기준: 환불 수단별 처리 소요일 정확 안내 (예: 카드 취소 영업일 3~5일 — 사내 기준) / 대표 오안내: ‘바로 환불된다/오늘 들어온다’ 확정 단정 / 근거: [사내 환불정책 vX]
- [EC-P02] 단순변심 반품 배송비 — 정답 기준: 단순변심 시 반품 배송비 고객 부담 안내(편도/왕복 사내값) / 대표 오안내: ‘무료 반품’ 일괄 안내 / 근거: [반품정책]
- [EC-P03] 청약철회 기간 — 정답 기준: 단순변심 청약철회 가능기간·예외(주문제작·개봉 등) 안내 / 대표 오안내: 기간/예외 누락·오안내 / 근거: [전자상거래법·사내]
- [EC-P04] 교환 배송비/재고없음 — 정답 기준: 교환 배송비·재고 없을 때 처리(환불 전환 등) 안내 / 대표 오안내: 재고 확인 없이 ‘무조건 교환’ 단정 / 근거: [교환정책]
- [EC-P05] 쿠폰 중복/유효기간 — 정답 기준: 쿠폰 중복 사용 가부·유효기간 정확 안내 / 대표 오안내: ‘다 적용된다’ 등 부정확 / 근거: [프로모션정책]
- [EC-P06] 적립금 소멸/탈퇴 시 처리 — 정답 기준: 적립금 소멸 조건·탈퇴 시 처리 정확 안내 / 대표 오안내: 소멸·환원 조건 오안내 / 근거: [멤버십정책]
- 제품하자(불량) / 반품 — 정답 기준: 제품하자(불량)에 대한 증빙 안내 or 판매자/업체 사전 확인 후 안내 / 대표 오안내: 증빙 or 판매자 확인없이 반품 가능 안내 / 근거: [반품정책]
- 본인인증 / 회원 — 정답 기준: 본인 확인 절차 안내 필수 / 대표 오안내: 본인확인 절차 누락 안내 / 근거: [회원정책]
- 배송·출고일 / 배송 — 정답 기준: 주문제작상품 or  예약배송상품 등 배송예정일 확인 후 안내 / 대표 오안내: 실제 출고 예정일과 다르게 임의 안내 / 근거: [배송정책]
- 판매중지·품절상품/ 배송 — 정답 기준: 판매중지·품절상품 배송 가능여부 확인 후 안내 / 대표 오안내: 재입고 확정 오안내 / 근거: [배송정책]', '점수 단계: 6 / 3 / 0
- 6점: 요청자 본인/제3자 구분에 따른 안내 범위 완전 준수. 규정상 불가 정보는 미제공+사유 안내, 안내 가능 업무 회피 없음
- 3점: 안내 범위는 대체로 준수하나 거절 사유 안내 누락·불충분 또는 안내 가능 업무 일부 회피 등 부분 미흡
- 0점: 규정상 불가 정보를 제공(정보 유출)하거나 제3자에게 안내 범위 위반, 또는 안내 가능 업무 회피', '컴플라이언스', 'numeric', 6, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
INSERT INTO public.domain_default_eval_items (domain_id, order_no, category, item, criterion, prompt_template, pentagon_axis, scoring_type, max_score, is_active) VALUES (3, 13, '컴플라이언스', '개인정보 취급 · 선언급 금지', '[평가 항목] 개인정보 취급 · 선언급 금지

[평가 대상] 1) 전산 확인 정보(주소·번호 등)를 고객 본인 확인 발화보다 먼저 말하지 않는 선언급 금지 준수 여부, 2) 고객 동의 없는 개인정보 활용 여부, 3) 정보 취급 가이드 준수 여부.

[평가 기준] 전산 확인 내용을 고객 확인 전 선언급하지 않고, 동의 없이 정보를 활용하지 않으며, 정보 취급 가이드를 준수하였는가?

[판정 주의] 선언급 판정은 전산 정보 발화와 고객 확인 발화의 순서에 의존(텍스트로 판정 가능). 주소·번호 등 정보 토큰의 STT 오인식 주의.

## 텍스트 판정 신호
- 전산 확인 정보(주소/번호 등) 발화가 고객 확인 발화보다 선행하는지 순서 검사.

## STT 주의·보정
선언급 판정은 발화 순서에 의존(텍스트로 가능). 정보 토큰 STT 오인식 주의.', '점수 단계: 6 / 3 / 0
- 6점: 전산 확인 정보를 고객 본인 확인 후에만 발화(선언급 없음)하고, 동의 없는 정보 활용 없으며 정보 취급 가이드 준수함
- 3점: 선언급 금지·동의·가이드 준수가 부분적으로 미흡함(일부 정보 발화 순서·동의 절차 불명확)
- 0점: 전산 정보를 고객 확인 전 선언급하거나, 동의 없이 정보를 활용하거나 정보 취급 가이드를 위반함', '컴플라이언스', 'numeric', 6, 't') ON CONFLICT (domain_id, order_no) DO UPDATE SET category=EXCLUDED.category, item=EXCLUDED.item, criterion=EXCLUDED.criterion, prompt_template=EXCLUDED.prompt_template, pentagon_axis=EXCLUDED.pentagon_axis, scoring_type=EXCLUDED.scoring_type, max_score=EXCLUDED.max_score, is_active=EXCLUDED.is_active;
