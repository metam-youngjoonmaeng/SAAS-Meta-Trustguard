/**
 * QA Dashboard 평가 체계 상수 (v2, 고객사 PoC)
 *   - 부서: 컬렉션관리부 / 소비자보호부
 *   - 컬렉션관리부: 9개 항목 + 직무별 만점 매트릭스 (PDS1/PDS2/PDS3/수동대인/인바운드)
 *   - 소비자보호부: 20개 항목 Y/N + 12 AI 카테고리 적합도
 *
 * SSOT: docs/DB_SCHEMA.md 와 동일.
 */

// ─── 부서 / 직무 ─────────────────────────────────────────────────

// 고객지원실(코오롱 등 기본 브랜드) 점수 루브릭 만점.
// DEFAULT_CHECKLIST_TEMPLATE 정의 직후 활성 항목 배점 합으로 동적 산출(파일 하단).
// total_score(0~100 %)를 원점수 환산할 때 분모로 사용.

export const DEPARTMENT_OPTIONS = ['컬렉션관리부', '소비자보호부'];

export const ROLE_OPTIONS_BY_DEPT = {
    컬렉션관리부: ['PDS1', 'PDS2', 'PDS3', '수동대인', '인바운드'],
    소비자보호부: ['전체'],
};

// ─── 컬렉션관리부: 9개 평가항목 + 직무별 만점 매트릭스 ──────────

export const COLLECTION_CHECKLIST_KEYS = [
    '친절도',
    '맞춤 응대 스킬',
    '업무 정확도',
    '사후 처리',
];

export const COLLECTION_CHECKLIST = [
    { order_no: 1, category: '친절도',     item: '첫인사' },
    { order_no: 2, category: '친절도',     item: '본인 확인' },
    { order_no: 3, category: '친절도',     item: '종료 인사' },
    { order_no: 4, category: '친절도',     item: '음성' },
    { order_no: 5, category: '친절도',     item: '언어 표현' },
    { order_no: 6, category: '맞춤 응대 스킬', item: '기반 형성' },
    { order_no: 7, category: '맞춤 응대 스킬', item: '회수 스킬' },
    { order_no: 8, category: '업무 정확도', item: '업무 정확도' },
    { order_no: 9, category: '사후 처리',   item: '이력 등록' },
];

/** order_no(1~9) × role → 만점. README/DB_SCHEMA.md 매트릭스와 동일. */
export const COLLECTION_POINTS_BY_ROLE = {
    1: { PDS1: 3,  PDS2: 3,  PDS3: 3,  수동대인: 3,  인바운드: 5  },
    2: { PDS1: 4,  PDS2: 4,  PDS3: 4,  수동대인: 4,  인바운드: 5  },
    3: { PDS1: 3,  PDS2: 3,  PDS3: 3,  수동대인: 3,  인바운드: 5  },
    4: { PDS1: 5,  PDS2: 4,  PDS3: 4,  수동대인: 4,  인바운드: 5  },
    5: { PDS1: 5,  PDS2: 3,  PDS3: 10, 수동대인: 10, 인바운드: 10 },
    6: { PDS1: 16, PDS2: 20, PDS3: 10, 수동대인: 10, 인바운드: 20 },
    7: { PDS1: 20, PDS2: 20, PDS3: 20, 수동대인: 20, 인바운드: 15 },
    8: { PDS1: 20, PDS2: 20, PDS3: 20, 수동대인: 20, 인바운드: 15 },
    9: { PDS1: 10, PDS2: 10, PDS3: 10, 수동대인: 10, 인바운드: 10 },
};

/** 직무별 만점 합계 (컬렉션관리부 — 100점 만점 아님). */
export const COLLECTION_TOTAL_BY_ROLE = {
    PDS1: 86,
    PDS2: 87,
    PDS3: 84,
    수동대인: 84,
    인바운드: 90,
};

export function collectionMaxPointsForRole(orderNo, role) {
    const row = COLLECTION_POINTS_BY_ROLE[Number(orderNo)];
    if (!row) return 0;
    return Number(row[role] ?? 0);
}

// ─── Pentagon 5축 (컬렉션관리부 전용) ─────────────────────────────
// 컬렉션관리부 9개 평가항목 → 5축 매핑. 자세한 정의는 docs/EVALUATION_ITEMS.md (Pentagon 5축 설계 절) 참조.
//   ① 인사·본인확인       ← order_no 1,2,3 (친절도)
//   ② 응대 화법·음성       ← order_no 4,5 (친절도)
//   ③ 경청·공감 응대       ← order_no 6,7 (맞춤 응대 스킬)
//   ④ 업무 정확도          ← order_no 8 (업무 정확도)
//   ⑤ 사후 처리            ← order_no 9 (사후 처리)

export const RADAR_KEYS = [
    'greeting_verify',
    'tone_language',
    'empathy_listening',
    'work_accuracy',
    'aftercare',
];

/** Pentagon 축 표시명 — 백엔드 qa_analysis_report.item_type 와 동일해야 호버 리포트가 매칭됨 */
export const RADAR_LABELS = [
    '인사·본인확인',
    '응대 화법·음성',
    '경청·공감 응대',
    '업무 정확도',
    '사후 처리',
];

/** Pentagon 축 → 컬렉션관리부 9 항목(order_no) 매핑. SSOT: docs/EVALUATION_ITEMS.md (Pentagon 5축 설계 절) */
export const RADAR_AXIS_TO_ORDER_NOS = {
    greeting_verify:   [1, 2, 3],
    tone_language:     [4, 5],
    empathy_listening: [6, 7],
    work_accuracy:     [8],
    aftercare:         [9],
};

// ─── 소비자보호부: 20개 평가항목 (Y/N) ────────────────────────────

export const CONSUMER_MAJOR_CATEGORIES = [
    '1. 금소법준수여부',
    '2. 방문판매모범규준',
    '3. 금융취약계층대상',
    '4. 불완전판매개연성',
];

export const CONSUMER_CHECKLIST = [
    { item_no: 1,  major_category: '1. 금소법준수여부',    sub_no: 1, criterion: '고지의 의무',           item_text: '상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가' },
    { item_no: 2,  major_category: '1. 금소법준수여부',    sub_no: 2, criterion: '적합성원칙안내',         item_text: '연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가' },
    { item_no: 3,  major_category: '1. 금소법준수여부',    sub_no: 3, criterion: '불공정 영업행위 금지',    item_text: '고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가' },
    { item_no: 4,  major_category: '1. 금소법준수여부',    sub_no: 4, criterion: '부당권유 행위 금지',     item_text: '고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가' },
    { item_no: 5,  major_category: '1. 금소법준수여부',    sub_no: 5, criterion: '계약서류 제공 의무',     item_text: '상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가' },
    { item_no: 6,  major_category: '1. 금소법준수여부',    sub_no: 6, criterion: '상품설명 이해여부 확인',  item_text: '설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)' },
    { item_no: 7,  major_category: '1. 금소법준수여부',    sub_no: 7, criterion: '불공정 영업행위 금지',    item_text: '금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가' },
    { item_no: 8,  major_category: '2. 방문판매모범규준',  sub_no: 1, criterion: '판매절차 적정성',         item_text: '전화 연락 거절을 위한 방법을 안내 받았는가' },
    { item_no: 9,  major_category: '2. 방문판매모범규준',  sub_no: 2, criterion: '판매절차 적정성',         item_text: '카드 판매 인력의 소속과 성명을 안내 받았는가' },
    { item_no: 10, major_category: '2. 방문판매모범규준',  sub_no: 3, criterion: '판매절차 적정성',         item_text: '카드 판매 인력의 신원 확인이 가능함을 안내 받았는가' },
    { item_no: 11, major_category: '3. 금융취약계층대상',  sub_no: 1, criterion: '설명의 의무',            item_text: '금융상품 판매 시 적정한 안내 속도로 판매되었는가' },
    { item_no: 12, major_category: '3. 금융취약계층대상',  sub_no: 2, criterion: '설명의 의무',            item_text: '금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가' },
    { item_no: 13, major_category: '3. 금융취약계층대상',  sub_no: 3, criterion: '상품설명 이해여부 확인',  item_text: '금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가' },
    { item_no: 14, major_category: '3. 금융취약계층대상',  sub_no: 4, criterion: '상품설명 이해여부 확인',  item_text: '판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가' },
    { item_no: 15, major_category: '4. 불완전판매개연성',  sub_no: 1, criterion: '상품설명 정확성&전달력',  item_text: '상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가' },
    { item_no: 16, major_category: '4. 불완전판매개연성',  sub_no: 2, criterion: '상품설명 정확성&전달력',  item_text: '정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가' },
    { item_no: 17, major_category: '4. 불완전판매개연성',  sub_no: 3, criterion: '상품설명 정확성&전달력',  item_text: '고객의 질의에 답변을 회피하거나 동문서답을 하였는가' },
    { item_no: 18, major_category: '4. 불완전판매개연성',  sub_no: 4, criterion: '상품설명 정확성&전달력',  item_text: '상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가' },
    { item_no: 19, major_category: '4. 불완전판매개연성',  sub_no: 5, criterion: '상품설명 정확성&전달력',  item_text: '서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가' },
    { item_no: 20, major_category: '4. 불완전판매개연성',  sub_no: 6, criterion: '상품설명 정확성&전달력',  item_text: '상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가' },
];

/** 소비자보호부 만점 = 20 (대분류별 항목 수 합) */
export const CONSUMER_TOTAL_MAX = 20;

/** 대분류별 항목 수 (만점) */
export const CONSUMER_MAJOR_MAX = {
    '1. 금소법준수여부':    7,
    '2. 방문판매모범규준':  3,
    '3. 금융취약계층대상':  4,
    '4. 불완전판매개연성':  6,
};

// ─── 소비자보호부: AI 유형분류 12 카테고리 ────────────────────────

export const CONSUMER_AI_CATEGORIES = [
    { category_no: 1,  major_category: '1. 리스크 관리',     sub_category: 'A. 법적 리스크 감지',  description: '금칙어, 위협, 강압 포함' },
    { category_no: 2,  major_category: '1. 리스크 관리',     sub_category: 'B. 민원 전환 가능성',  description: '불만 표출, 감정 악화' },
    { category_no: 3,  major_category: '1. 리스크 관리',     sub_category: 'C. 컴플라이언스 위반', description: '불완전 판매, 설명 생략' },
    { category_no: 4,  major_category: '2. 품질 관리',       sub_category: 'A. 응대 품질 저하',   description: '불친절, 반말, 무시' },
    { category_no: 5,  major_category: '2. 품질 관리',       sub_category: 'B. 설명 부족',        description: '불성실 답변, 회피' },
    { category_no: 6,  major_category: '2. 품질 관리',       sub_category: 'C. 우수 응대',        description: '친절, 명확한 설명' },
    { category_no: 7,  major_category: '3. 프로세스 개선',   sub_category: 'A. 고객 제안',        description: '개선 아이디어, VOC' },
    { category_no: 8,  major_category: '3. 프로세스 개선',   sub_category: 'B. 반복 문의',        description: '동일 이슈 재발' },
    { category_no: 9,  major_category: '3. 프로세스 개선',   sub_category: 'C. 시스템 오류',       description: '기술적 문제 언급' },
    { category_no: 10, major_category: '4. 비즈니스 인사이트', sub_category: 'A. 상품 관심',        description: '신규 상품 문의' },
    { category_no: 11, major_category: '4. 비즈니스 인사이트', sub_category: 'B. 경쟁사 언급',      description: '타사 비교' },
    { category_no: 12, major_category: '4. 비즈니스 인사이트', sub_category: 'C. 해지 사유',        description: '이탈 원인 분석' },
];

/**
 * 적합도 점수 구간 (정량 시각화용).
 * 카테고리 자체에 긍정/부정 의미는 부여하지 않음 — 점수에 따른 농도만 차별화.
 */
export const CONSUMER_FIT_BANDS = [
    { min: 80, max: 100, label: '높음', density: 'strong' },
    { min: 60, max: 79,  label: '중간', density: 'medium' },
    { min: 30, max: 59,  label: '낮음', density: 'soft'   },
    { min: 0,  max: 29,  label: '없음', density: 'mute'   },
];

/** "해당됨" 임계값 — 60+ 카드 노출, 미만은 막대그래프에만 */
export const CONSUMER_FIT_THRESHOLD = 60;

export function fitBandFor(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return CONSUMER_FIT_BANDS[CONSUMER_FIT_BANDS.length - 1];
    return CONSUMER_FIT_BANDS.find((b) => n >= b.min && n <= b.max) || CONSUMER_FIT_BANDS[CONSUMER_FIT_BANDS.length - 1];
}

// ─── 레거시 alias (점진적 제거 예정) ───────────────────────────────
// Dashboard.jsx / Detail.jsx 가 부서별로 전환되기 전까지 임시 alias 유지.
// PDS1 만점 매트릭스를 기본값으로 박아 화면이 깨지지 않게 함 — 직무가 다른 콜은 Detail 컴포넌트가 콜의 role 을 보고 다시 계산.

export const CHECKLIST_KEYS = COLLECTION_CHECKLIST_KEYS;

// order_no 는 골든셋 사례 조회 매칭 키. qa_evaluation_rows.item 의 긴 문구와 무관하게
// (org_id, order_no) 로 매칭하기 위해 UI 모델에 보존.
export const CHECKLIST_TEMPLATE = COLLECTION_CHECKLIST.map((row) => ({
    order_no: row.order_no,
    category: row.category,
    item: row.item,
    validation_time: `배점 ${COLLECTION_POINTS_BY_ROLE[row.order_no].PDS1}`,
}));

// ─── 한화손해보험 브랜드(=organizations.id=2) 평가 체계 ─────────────
// 원본: 02-hanwha-QA_Dashboard/src/constants.js (8항목, 단일 부서/직무).
// 한화 체크리스트는 category == item 1:1 매핑. Dashboard 컬럼 8개를 그대로 사용.
export const HANWHA_CHECKLIST_KEYS = [
    '전화수신/종료태도', '첫인사', '끝인사', '문의내용 파악/경청',
    '사과/대기/감사표현', '정확한 업무처리', '정보보호', '상담태도',
];

// order_no 는 한화 시드 qa_evaluation_rows.order_no (1..8) 와 동일 순서로 정렬되어 있으므로
// 골든셋 사례 매칭이 신한과 동일 경로(order_no 기준)로 동작.
export const HANWHA_CHECKLIST_TEMPLATE = [
    { order_no: 1, category: '전화수신/종료태도',   item: '전화수신/종료태도',   validation_time: '배점 10' },
    { order_no: 2, category: '첫인사',              item: '첫인사',              validation_time: '배점 10' },
    { order_no: 3, category: '끝인사',              item: '끝인사',              validation_time: '배점 10' },
    { order_no: 4, category: '문의내용 파악/경청',  item: '문의내용 파악/경청',  validation_time: '배점 10' },
    { order_no: 5, category: '사과/대기/감사표현',  item: '사과/대기/감사표현',  validation_time: '배점 10' },
    { order_no: 6, category: '정확한 업무처리',     item: '정확한 업무처리',     validation_time: '배점 20' },
    { order_no: 7, category: '정보보호',            item: '정보보호',            validation_time: '배점 10' },
    { order_no: 8, category: '상담태도',            item: '상담태도',            validation_time: '배점 20' },
];

export const HANWHA_RADAR_KEYS = [
    'intro_quality', 'product_clarity', 'compliance', 'communication', 'speech_stability',
];
export const HANWHA_RADAR_LABELS = [
    '오프닝 및 목적 안내', '설명 명확성', '준수·고지 품질', '대화·경청 품질', '발화 안정성',
];

// ─── 기본 평가 체계 (BRAND_CONFIG 미등록 브랜드 fallback) ──────────
// 원본: 01-QA_Dashboard/src/constants.js 의 CHECKLIST_TEMPLATE (18 항목, 100 점).
// 신규 브랜드 생성 시 server/defaultEvalItems.mjs 가 eval_item_defs 에 시드하는
// 항목과 정확히 동일 — DB 와 UI 가 같은 18 항목을 본다.
// 부서/직무는 단일 컨텍스트(고객센터/전체)로 안전한 최소 구성.
// 백엔드 비활성/제외(rubricSync RUBRIC_EXCLUDED_ORDER_NOS={3,15,16}) 항목은 대시보드에도 미표시 —
// #3(경청 말겹침/말자름, 파이프라인 미산출)·#15/#16(업무 정확도→KMS 충족률 대체)을 KEYS·TEMPLATE 양쪽에서 제외.
export const DEFAULT_CHECKLIST_KEYS = [
    '인사 예절',
    '경청 및 소통',
    '언어 표현',
    '니즈 파악',
    '설명력 및 전달력',
    '적극성',
    '개인정보 보호',
];

export const DEFAULT_CHECKLIST_TEMPLATE = [
    { order_no: 1,  category: '인사 예절',        item: '첫인사',                    validation_time: '배점 5'  },
    { order_no: 2,  category: '인사 예절',        item: '끝인사',                    validation_time: '배점 5'  },
    { order_no: 4,  category: '경청 및 소통',     item: '호응 및 공감',              validation_time: '배점 5'  },
    { order_no: 5,  category: '경청 및 소통',     item: '대기 멘트',                 validation_time: '배점 5'  },
    { order_no: 6,  category: '언어 표현',        item: '정중한 표현',               validation_time: '배점 5'  },
    { order_no: 7,  category: '언어 표현',        item: '쿠션어 활용',               validation_time: '배점 5'  },
    { order_no: 8,  category: '니즈 파악',        item: '문의 파악 및 재확인(복창)', validation_time: '배점 5'  },
    { order_no: 9,  category: '니즈 파악',        item: '고객정보 확인',             validation_time: '배점 5'  },
    { order_no: 10, category: '설명력 및 전달력', item: '설명의 명확성',             validation_time: '배점 10' },
    { order_no: 11, category: '설명력 및 전달력', item: '두괄식 답변',               validation_time: '배점 5'  },
    { order_no: 12, category: '적극성',           item: '문제 해결 의지',            validation_time: '배점 5'  },
    { order_no: 13, category: '적극성',           item: '부연 설명 및 추가 안내',    validation_time: '배점 5'  },
    { order_no: 14, category: '적극성',           item: '사후 안내',                 validation_time: '배점 5'  },
    { order_no: 17, category: '개인정보 보호',    item: '정보 확인 절차',            validation_time: '배점 5'  },
    { order_no: 18, category: '개인정보 보호',    item: '정보 보호 준수',            validation_time: '배점 5'  },
];

// validation_time '배점 N' 1건 파싱 → 만점(없으면 5점 기본).
export function parseTemplateMaxPoints(validationTime) {
    const n = parseFloat(String(validationTime || '').replace(/배점\s*/u, '').trim());
    return Number.isFinite(n) && n > 0 ? n : 5;
}

// 정적 checklistTemplate 의 '배점 N' 합 — 루브릭 총 만점 폴백.
export function sumTemplateMaxPoints(template) {
    return (template || []).reduce((sum, row) => sum + parseTemplateMaxPoints(row.validation_time), 0);
}

// checklistTemplate 으로부터 대분류별 만점 합 — 카테고리 배지 분모 폴백.
export function buildCategoryMaxPoints(template) {
    const m = {};
    (template || []).forEach(({ category, validation_time }) => {
        m[category] = (m[category] || 0) + parseTemplateMaxPoints(validation_time);
    });
    return m;
}

// 고객지원실 점수 루브릭 만점 = 활성 체크리스트 배점 합 (validation_time '배점 N' 파싱).
// #3/#15/#16 을 TEMPLATE 에서 제거했으므로 합은 자동으로 그 배점을 제외 — 항목 추가/제거 시 자동 반영(하드코딩 금지).
export const DEFAULT_TOTAL_MAX = sumTemplateMaxPoints(DEFAULT_CHECKLIST_TEMPLATE);

// 표준 Pentagon 5축 (QA 미팅 2026-06 결정 — 업종 무관 통일). 동적 브랜드(org_id>=4) 공통.
// 라벨은 backend CANONICAL_PENTAGON_AXES 와 동일해야 점수 매칭됨(동적 브랜드는 한글 라벨로 키잉).
export const DEFAULT_RADAR_KEYS = [
    'manner_expression', 'needs_listening', 'explanation_delivery', 'accuracy_resolution', 'compliance',
];

export const DEFAULT_RADAR_LABELS = [
    '응대·표현', '니즈파악·경청', '설명·전달력', '정확성·해결력', '컴플라이언스',
];

export const DEFAULT_BRAND_CONFIG = {
    key: 'default',
    // 평가(qa-pipeline + rubricSync)가 항상 department='기본' 항목만 채점하므로 신규 브랜드도 '기본'으로 통일.
    // (과거 '고객지원실' → UI/추가 부서가 평가 부서와 불일치 → 추가 항목이 채점 안 되고, 기본부서 시드만 평가되던 문제)
    departments: ['기본'],
    roleOptionsByDept: { 기본: ['전체'] },
    checklistKeys: DEFAULT_CHECKLIST_KEYS,
    checklistTemplate: DEFAULT_CHECKLIST_TEMPLATE,
    radarKeys: DEFAULT_RADAR_KEYS,
    radarLabels: DEFAULT_RADAR_LABELS,
};

// ─── 브랜드별 평가 체계 lookup ─────────────────────────────────────
// Dashboard.jsx / Detail.jsx 가 selectedBrandId 를 받아 본 함수를 통해 적절한 키·라벨 선택.
// 신규 브랜드 추가 시 BRAND_CONFIG 에 항목 추가 — 등록 전까지는 DEFAULT_BRAND_CONFIG 사용.
export const BRAND_CONFIG = {
    1: {
        key: 'shinhan',
        departments: DEPARTMENT_OPTIONS,
        roleOptionsByDept: ROLE_OPTIONS_BY_DEPT,
        checklistKeys: CHECKLIST_KEYS,
        checklistTemplate: CHECKLIST_TEMPLATE,
        radarKeys: RADAR_KEYS,
        radarLabels: RADAR_LABELS,
    },
    2: {
        key: 'hanwha',
        departments: ['고객센터'],
        roleOptionsByDept: { 고객센터: ['전체'] },
        checklistKeys: HANWHA_CHECKLIST_KEYS,
        checklistTemplate: HANWHA_CHECKLIST_TEMPLATE,
        radarKeys: HANWHA_RADAR_KEYS,
        radarLabels: HANWHA_RADAR_LABELS,
    },
};

export function getBrandConfig(brandId) {
    return BRAND_CONFIG[Number(brandId)] || DEFAULT_BRAND_CONFIG;
}

// ── 신규 브랜드 동적 체크리스트 ─────────────────────────────────────
// 레거시 브랜드(신한1 / 한화2 / 코오롱3)는 정적 체크리스트(BRAND_CONFIG / DEFAULT)를 그대로 보존.
// 그 외 신규 브랜드(id≥4)는 평가항목 리스트를 DB(eval_item_defs '기본')에서 동적 구성 →
// 코오롱 18항목 폴백 차단(신규는 server 시드 '첫인사' 1항목만).
export const LEGACY_STATIC_BRAND_IDS = new Set([1, 2, 3]);

export function isDynamicChecklistBrand(brandId) {
    const n = Number(brandId);
    return Number.isFinite(n) && n > 0 && !LEGACY_STATIC_BRAND_IDS.has(n);
}

// DB eval_item_defs 행 배열 → 정적 checklistTemplate 과 동일 shape 로 매핑.
// (order_no 오름차순, validation_time='배점 N' 으로 만점 표현 — yes_no=1)
export function buildChecklistTemplateFromDefs(defs) {
    const rows = Array.isArray(defs) ? defs : Object.values(defs || {});
    return rows
        .filter((d) => d && d.order_no !== undefined && d.order_no !== null && d.order_no !== '')
        .slice()
        .sort((a, b) => Number(a.order_no) - Number(b.order_no))
        .map((d) => ({
            order_no: Number(d.order_no),
            category: d.category || '',
            item: d.item || '',
            validation_time: `배점 ${d.scoring_type === 'yes_no' ? 1 : (d.max_score ?? 5)}`,
            is_active: d.is_active ?? true,
        }));
}
