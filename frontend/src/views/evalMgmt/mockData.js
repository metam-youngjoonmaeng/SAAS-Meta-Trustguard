// 평가 관리 — 목 데이터 (디자인 프로토타입 etc/data.jsx + pages-eval-detail.jsx 포팅)
// 코칭/수기검토/회복률 등은 현 백엔드 스키마에 없는 개념이라 디자인 시안의 샘플 데이터를 그대로 사용한다.

// ─── 평가 항목(14개, 5그룹) — KCC QA 표준 루브릭 ───
export const DIM_GROUPS = [
    { key: 'greeting', label: '인사', color: 'cat-product', soft: 'cat-product-soft' },
    { key: 'attitude', label: '응대 태도', color: 'cat-claim', soft: 'cat-claim-soft' },
    { key: 'consult', label: '상담 진행', color: 'cat-service', soft: 'cat-service-soft' },
    { key: 'resolve', label: '문제 해결', color: 'cat-delivery', soft: 'cat-delivery-soft' },
    { key: 'compliance', label: '컴플라이언스', color: 'cat-policy', soft: 'cat-policy-soft' },
];

export const DIMENSIONS = [
    { key: 'open', group: 'greeting', label: '첫 인사', weight: 5, ico: 'hand', skillId: 'SK-001' },
    { key: 'close', group: 'greeting', label: '끝 인사', weight: 5, ico: 'hand-heart', skillId: 'SK-002' },
    { key: 'listen', group: 'attitude', label: '경청·소통', weight: 8, ico: 'ear', skillId: 'SK-003' },
    { key: 'polite', group: 'attitude', label: '정중한 표현', weight: 8, ico: 'heart-handshake', skillId: 'SK-004' },
    { key: 'needs', group: 'consult', label: '니즈 파악', weight: 8, ico: 'target', skillId: 'SK-005' },
    { key: 'explain', group: 'consult', label: '설명력', weight: 10, ico: 'book-open', skillId: 'SK-006' },
    { key: 'lead', group: 'consult', label: '두괄식 결론', weight: 5, ico: 'list-tree', skillId: 'SK-007' },
    { key: 'solve', group: 'resolve', label: '문제 해결', weight: 12, ico: 'wrench', skillId: 'SK-008' },
    { key: 'supp', group: 'resolve', label: '보충 안내', weight: 5, ico: 'plus-circle', skillId: 'SK-009' },
    { key: 'follow', group: 'resolve', label: '후속 안내', weight: 5, ico: 'send', skillId: 'SK-010' },
    { key: 'accurate', group: 'resolve', label: '정확한 안내', weight: 10, ico: 'badge-check', skillId: 'SK-011' },
    { key: 'script', group: 'compliance', label: '필수 스크립트', weight: 5, ico: 'scroll-text', skillId: 'SK-012' },
    { key: 'verify', group: 'compliance', label: '본인 확인 절차', weight: 7, ico: 'user-check', skillId: 'SK-013' },
    { key: 'privacy', group: 'compliance', label: '개인정보 보호', weight: 7, ico: 'shield-check', skillId: 'SK-014' },
];

// group → color backfill
DIMENSIONS.forEach((d) => {
    const g = DIM_GROUPS.find((x) => x.key === d.group);
    d.color = g.color;
});

// 평균 점수 주변으로 그럴듯한 항목별 점수 생성 (seed 결정적)
export const genScores = (avg, seed = 0) => {
    const out = {};
    DIMENSIONS.forEach((d, i) => {
        const r = (Math.sin((seed + 1) * (i + 1) * 12.9898) * 43758.5453) % 1;
        const offset = Math.round(Math.abs(r) * 16 - 8);
        let v = Math.max(50, Math.min(100, avg + offset));
        if (d.group === 'compliance') v = Math.min(100, v + 6);
        if (d.group === 'greeting') v = Math.min(100, v + 3);
        out[d.key] = v;
    });
    return out;
};

// ─── 상담사 ───
export const COUNSELORS = [
    { id: 'A20419', name: '김민서', team: '강남 1팀', av: 'av-1', score: 92.4, calls: 184, trend: 'up', delta: 3.2 },
    { id: 'A20203', name: '정유나', team: '강남 1팀', av: 'av-2', score: 90.1, calls: 172, trend: 'up', delta: 1.8 },
    { id: 'A20518', name: '서동현', team: '강남 1팀', av: 'av-3', score: 88.7, calls: 161, trend: 'flat', delta: 0.1 },
    { id: 'A20622', name: '한채영', team: '강남 2팀', av: 'av-4', score: 85.4, calls: 158, trend: 'up', delta: 2.4 },
    { id: 'A20311', name: '조성훈', team: '강남 2팀', av: 'av-5', score: 81.9, calls: 149, trend: 'down', delta: -1.6 },
    { id: 'A20127', name: '윤지아', team: '강남 1팀', av: 'av-6', score: 79.2, calls: 142, trend: 'down', delta: -2.9 },
];

// ─── 평가 결과 ───
export const EVAL_RESULTS = [
    { id: 'EVAL-2026-0518', sessionId: 'CALL-9842', counselor: 'A20419', name: '김민서', avId: 'av-1', date: '2026-05-26', time: '14:21', duration: '6:42', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '결제 · 환불', score: 94, scores: genScores(94, 18), status: 'pending', reviewer: null, summary: '환불 절차 안내가 매끄러웠으며, 본인 확인 단계를 정확히 수행함. 클로징 인사 부분 보완 권장.' },
    { id: 'EVAL-2026-0517', sessionId: 'OUT-3851', counselor: 'A20622', name: '한채영', avId: 'av-4', date: '2026-05-26', time: '14:08', duration: '8:14', kind: '실제 통화', channel: 'outbound', team: '강남 2팀', category: '계약 갱신', score: 86, scores: genScores(86, 17), status: 'pending', reviewer: null, summary: '아웃바운드 영업 스크립트 충실히 진행. 거절 응대 시 정중함은 유지되었으나 두괄식 결론이 약함.' },
    { id: 'EVAL-2026-0511', sessionId: 'CALL-9839', counselor: 'A20622', name: '한채영', avId: 'av-4', date: '2026-05-26', time: '14:15', duration: '4:55', kind: '실제 통화', channel: 'inbound', team: '강남 2팀', category: '결제 · 환불', score: 92, scores: genScores(92, 11), status: 'reviewed', reviewer: '박지원', summary: '환불 정책을 정확히 안내했고, 고객의 감정 변화에 잘 대응함. 마무리 인사가 다소 짧음.' },
    { id: 'EVAL-2026-0510', sessionId: 'CALL-9837', counselor: 'A20419', name: '김민서', avId: 'av-1', date: '2026-05-26', time: '14:01', duration: '3:42', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '배송 문의', score: 95, scores: genScores(95, 10), status: 'completed', reviewer: null, summary: '응대 톤이 일관되게 친절하며 매뉴얼을 정확히 따름. 환불 가능 여부 안내 시 약관 인용 정확.' },
    { id: 'EVAL-2026-0509', sessionId: 'CALL-9836', counselor: 'A20203', name: '정유나', avId: 'av-2', date: '2026-05-26', time: '13:58', duration: '5:09', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '상품 문의', score: 88, scores: genScores(88, 9), status: 'pending', reviewer: null, summary: '제품 사양 안내는 정확했으나, 비교 추천 시 정보가 다소 부족했음.' },
    { id: 'EVAL-2026-0508', sessionId: 'CALL-9835', counselor: 'A20419', name: '김민서', avId: 'av-1', date: '2026-05-26', time: '13:42', duration: '6:18', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '계정 · 인증', score: 90, scores: genScores(90, 8), status: 'reviewed', reviewer: '박지원', summary: '본인 확인 절차를 빠짐없이 수행. 일부 안내문이 길어 고객이 되묻는 장면 있음.' },
    { id: 'EVAL-2026-0507', sessionId: 'TUTR-1293', counselor: 'A20311', name: '조성훈', avId: 'av-5', date: '2026-05-26', time: '14:10', duration: '7:32', kind: 'Tutor 세션', channel: 'inbound', team: '강남 2팀', category: '클레임 응대', score: 78, scores: genScores(78, 7), status: 'pending', reviewer: null, summary: '강한 클레임 상황에서 감정 컨트롤이 흔들렸음. 매뉴얼은 충실히 따랐으나 공감 표현 부족.' },
    { id: 'EVAL-2026-0506', sessionId: 'CALL-9833', counselor: 'A20518', name: '서동현', avId: 'av-3', date: '2026-05-26', time: '12:48', duration: '4:21', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '배송 문의', score: 89, scores: genScores(89, 6), status: 'completed', reviewer: null, summary: '배송 추적 안내가 명료하고 신속함. 추가 요청 사항에 대한 확인이 미흡했음.' },
    { id: 'EVAL-2026-0505', sessionId: 'OUT-3849', counselor: 'A20311', name: '조성훈', avId: 'av-5', date: '2026-05-26', time: '12:32', duration: '5:48', kind: '실제 통화', channel: 'outbound', team: '강남 2팀', category: '해피콜', score: 91, scores: genScores(91, 5), status: 'reviewed', reviewer: '박지원', summary: '해피콜 스크립트 정확. 후속 안내까지 빠짐없이 진행했고, 고객 응답이 긍정적.' },
    { id: 'EVAL-2026-0504', sessionId: 'OUT-3848', counselor: 'A20127', name: '윤지아', avId: 'av-6', date: '2026-05-26', time: '11:54', duration: '9:12', kind: '실제 통화', channel: 'outbound', team: '강남 1팀', category: '계약 갱신', score: 74, scores: genScores(74, 4), status: 'pending', reviewer: null, summary: '아웃바운드 거절 대응 시 두괄식 결론 부족. 추가 혜택 안내가 산만하게 전달됨.' },
    { id: 'EVAL-2026-0503', sessionId: 'CALL-9831', counselor: 'A20203', name: '정유나', avId: 'av-2', date: '2026-05-25', time: '17:21', duration: '4:38', kind: '실제 통화', channel: 'inbound', team: '강남 1팀', category: '기술 지원', score: 87, scores: genScores(87, 3), status: 'completed', reviewer: null, summary: '기술 문의 핸들링 매끄러움. 해결 후 후속 안내 단계까지 잘 진행함.' },
    { id: 'EVAL-2026-0502', sessionId: 'OUT-3845', counselor: 'A20518', name: '서동현', avId: 'av-3', date: '2026-05-25', time: '16:40', duration: '6:02', kind: '실제 통화', channel: 'outbound', team: '강남 1팀', category: '캠페인', score: 82, scores: genScores(82, 2), status: 'reviewed', reviewer: '박지원', summary: '캠페인 안내가 명료하나 고객 니즈 파악 단계에서 질문이 부족했음.' },
];

// 수기 검토 = 상담사 본인 검토 기록 / 최종 승인 = 관리자 승인
export const SELF_REVIEW = {
    'EVAL-2026-0511': { by: '한채영', date: '05-26', note: '환불 약관 안내 부분 스스로 보완 메모함.' },
    'EVAL-2026-0508': { by: '김민서', date: '05-26', note: '본인 확인 안내문이 길었던 점 인지, 다음 콜에 반영 예정.' },
    'EVAL-2026-0505': { by: '조성훈', date: '05-26', note: '해피콜 후속 안내 누락 없었는지 자가 점검 완료.' },
    'EVAL-2026-0502': { by: '서동현', date: '05-25', note: '니즈 파악 질문이 부족했다고 판단, 질문 리스트 작성함.' },
};
export const APPROVED_IDS = new Set(['EVAL-2026-0511', 'EVAL-2026-0510', 'EVAL-2026-0506', 'EVAL-2026-0505', 'EVAL-2026-0503']);
EVAL_RESULTS.forEach((r) => {
    r.selfReview = SELF_REVIEW[r.id] || null;
    r.approved = APPROVED_IDS.has(r.id);
    r.approver = r.approved ? r.reviewer || '이수정' : null;
});

// 활동 히트맵 (7×8 grid, 0-5)
export const HEAT_DATA = [
    1, 2, 3, 0, 4, 5, 2, 0, 2, 3, 4, 3, 5, 1, 2, 3, 4, 5, 5, 3, 0, 0, 1, 3, 2, 4, 4, 2, 1, 2, 3, 4, 5, 5, 3, 2, 4, 5, 5, 5, 4, 1,
    1, 3, 4, 4, 3, 2, 0, 2, 3, 5, 4, 5, 4, 3,
];

// ─── 코칭 커리큘럼 ───
export const COACHING_GROUPS = [
    { key: 'emotion', title: '감정 컨트롤 · 회복 응대', priority: 'high', icon: 'heart-pulse', criteria: '부정 발화 10%↑ 또는 회복률 80%↓', reason: '강한 클레임 상황에서 감정 회복 여지가 큰 상담사 그룹입니다.', items: ['강한 클레임 상황 시뮬레이션 3회 진행', '공감·인정 표현 스크립트 10종 숙지', '감정 라벨링 후 재진술 연습'], tutor: '클레임 응대 시뮬레이션', members: ['A20127', 'A20311', 'A20419'], assigned: true, assignedBy: '이수정', assignedAt: '2026-05-24', status: '진행 중' },
    { key: 'followup', title: '후속 안내 · 클로징 강화', priority: 'mid', icon: 'phone-forwarded', criteria: '끝 인사·후속 안내 항목 80점 미만', reason: '마무리 단계에서 후속 조치 안내가 누락되는 경향이 있는 그룹입니다.', items: ['클로징 체크리스트 적용 (추가문의·재안내·인사)', '모범 마무리 통화 5건 청취'], tutor: '클로징 커뮤니케이션 코스', members: ['A20419', 'A20203'], assigned: true, assignedBy: '박지원', assignedAt: '2026-05-25', status: '배정됨' },
    { key: 'lead', title: '두괄식 결론 전달', priority: 'mid', icon: 'list-ordered', criteria: '두괄식 결론 75점 미만', reason: '결론을 먼저 제시하지 못해 통화가 길어지는 경향이 있는 그룹입니다.', items: ['결론–근거–안내 3단 구조 템플릿 학습', '모범 통화 5건 청취 후 셀프 리뷰'], tutor: '두괄식 커뮤니케이션 코스', members: ['A20311', 'A20622'], assigned: false },
    { key: 'needs', title: '니즈 파악 · 복창', priority: 'high', icon: 'list-checks', criteria: '니즈 파악 79점 미만', reason: '고객 요청을 복창·확인하는 절차가 약해 재문의가 잦은 그룹입니다.', items: ['핵심 복창 체크포인트 셀프 점검 루틴', '니즈 정리 질문 5종 숙지'], tutor: '니즈 파악 집중 코스', members: ['A20518', 'A20127'], assigned: false },
    { key: 'polite', title: '정중한 표현 · 어법', priority: 'mid', icon: 'message-circle', criteria: '정중한 표현 80점 미만', reason: '거절·안내 시 단정적 표현이 잦아 어조 개선이 필요한 그룹입니다.', items: ['단정적 거절 대신 대안 제시 화법 연습', '정중 표현 스크립트 숙지'], tutor: '응대 화법 코스', members: ['A20311', 'A20127'], assigned: false },
    { key: 'open', title: '첫 인사 · 도입 표준화', priority: 'mid', icon: 'hand', criteria: '첫 인사 85점 미만', reason: '인사 3요소(인사·소속·성명) 누락이 관찰되는 그룹입니다.', items: ['표준 인사 스크립트 적용', '도입부 모범 통화 3건 청취'], tutor: '오프닝 표준화 코스', members: ['A20622', 'A20518'], assigned: false },
    { key: 'privacy', title: '개인정보 · 본인 확인', priority: 'high', icon: 'shield-check', criteria: '개인정보 보호 항목 위반 이력', reason: '본인 확인·마스킹 절차 준수가 필요한 고위험 그룹입니다.', items: ['최소 수집 원칙 · 마스킹 절차 재교육', '본인 확인 표준 절차 체크리스트 적용'], tutor: '개인정보 보호 필수 교육', members: ['A20203', 'A20311'], assigned: false },
];

// ─── 헬퍼 ───
export const scoreClass = (s) => (s >= 90 ? 'high' : s >= 80 ? 'mid' : 'low');
export const fmtNum = (n) => n.toLocaleString('ko-KR');

// ─────────────────────────────────────────────────────
// 평가 상세 화면(EvalDetailView)용 데이터
// ─────────────────────────────────────────────────────
export const CHECKLIST_GROUPS = [
    {
        key: 'kindness', label: '친절도',
        items: [
            { key: 'open', label: '첫인사', reason: '고객센터 소속과 성명을 명확히 안내함', utter: '"안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?"', ai: '3/3', max: 3, manual: 10, monthAvg: 100, jobAvg: 100, match: 100, options: ['10점', '7점', '5점', '평가제외'] },
            { key: 'verify', label: '본인 확인', reason: '본인 확인 절차를 표준대로 진행함', utter: '"네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다."', ai: '4/4', max: 4, manual: '평가제외', monthAvg: 100, jobAvg: 100, match: 100, options: ['평가제외', '4점', '3점', '2점', '1점'] },
            { key: 'close', label: '종료 인사', reason: '종료 인사 시 후속 인사가 다소 짧음', utter: '"별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오."', ai: '3/3', max: 3, manual: '평가제외', monthAvg: 80, jobAvg: 80, match: 100, options: ['평가제외', '3점', '2점', '1점'] },
            { key: 'voice', label: '음성', reason: '차분한 속도와 안정된 음성으로 응대함', utter: '"오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?"', ai: '5/5', max: 5, manual: '평가제외', monthAvg: 100, jobAvg: 100, match: 100, options: ['평가제외', '5점', '4점', '3점', '2점'] },
            { key: 'lang', label: '언어 표현', reason: '고객센터 소속과 성명을 명확히 안내함', utter: '"안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?"', ai: '5/5', max: 5, manual: '평가제외', monthAvg: 100, jobAvg: 100, match: 100, options: ['평가제외', '5점', '4점', '3점', '2점'] },
        ],
    },
    {
        key: 'skill', label: '맞춤 응대 스킬',
        items: [
            { key: 'rapport', label: '기반 형성', reason: '고객 문의에 적극적으로 공감하며 가상계좌 안내로 즉시 연결함', utter: '"오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?"', ai: '16/16', max: 16, manual: 10, monthAvg: 85, jobAvg: 85, match: 95, options: ['10점', '8점', '5점', '평가제외'] },
            { key: 'recover', label: '회수 스킬', reason: '고객 문의에 적극적으로 공감하며 가상계좌 안내로 즉시 연결함', utter: '"오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?"', ai: '17/20', max: 20, manual: 20, monthAvg: 85, jobAvg: 85, match: 95, options: ['20점', '15점', '10점', '평가제외'] },
        ],
    },
    {
        key: 'accuracy', label: '업무 정확도',
        items: [
            { key: 'biz-acc', label: '업무 정확도', reason: '가상계좌와 처리 알림 안내가 정확함', utter: '"안내드린 가상계좌로 56만 2천 원 …"', ai: '12/20', max: 20, manual: 12, monthAvg: 80, jobAvg: 80, match: 100, options: ['12점', '10점', '7점', '평가제외'] },
        ],
    },
    {
        key: 'aftercare', label: '사후 처리',
        items: [
            { key: 'after', label: '사후 안내', reason: '추가 안내 사항을 명확히 전달함', utter: '"입금 확인 후 SMS로 처리 결과 안내드리겠습니다."', ai: '8/10', max: 10, manual: 8, monthAvg: 85, jobAvg: 80, match: 90, options: ['10점', '8점', '5점', '평가제외'] },
        ],
    },
];

export const PENTAGON_AXES = [
    { key: 'greet', label: '인사·본인확인' },
    { key: 'speech', label: '응대 화법·음성' },
    { key: 'empathy', label: '경청·공감 응대' },
    { key: 'biz', label: '업무 정확도' },
    { key: 'after', label: '사후 처리' },
];

export const PENTAGON_SERIES = {
    all: [88, 80, 82, 80, 78],
    job: [95, 90, 88, 85, 90],
    agent: [95, 88, 80, 80, 92],
};

export const DETAIL_META = {
    uid: 'QA-20260308-0005',
    callId: 'C-20260308-100005',
    datetime: '2026-03-08 14:35:02',
    duration: '0분 0초',
    team: '컬렉션관리부',
    job: '인바운드',
    agentId: '-',
    agentName: '-',
    custId: '-',
    custGrade: '-',
    aiScore: 88,
    manualEdited: true,
};

export const STT_TRANSCRIPT = [
    { who: '상담사', time: '00:00', text: '안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?' },
    { who: '고객', time: '00:06', text: '안녕하세요. 제가 카드 대금이 일부 연체된 거 같아서 확인 좀 하려고요.' },
    { who: '상담사', time: '00:14', text: '네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다.' },
    { who: '고객', time: '00:20', text: '윤서영이고요 1990년 9월 18일입니다.' },
    { who: '상담사', time: '00:26', text: '확인되셨습니다 회원님. 현재 2월분 결제대금 56만 2천 원이 미납 상태로 표시되고 있습니다.' },
    { who: '고객', time: '00:36', text: '아 그렇군요. 오늘 바로 입금하면 추가 연체료는 어떻게 되나요?' },
    { who: '상담사', time: '00:43', text: '오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?' },
    { who: '고객', time: '00:53', text: '네 부탁드립니다.' },
    { who: '상담사', time: '00:55', text: '안내드린 가상계좌로 56만 2천 원을 영업시간 내 입금해주시면 됩니다. 입금 확인 후 SMS로 처리 결과 안내드리겠습니다.' },
    { who: '고객', time: '01:09', text: '네 감사합니다.' },
    { who: '상담사', time: '01:11', text: '별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오.' },
];
