/* SAMPLE_UPLOAD_FEATURE — src/constants.js 의 한화 8항목·라디얼 5축과 동일. 임시 기능 제거 시 이 파일 함께 삭제 */

export const CHECKLIST_KEYS = [
    '전화수신/종료태도',
    '첫인사',
    '끝인사',
    '문의내용 파악/경청',
    '사과/대기/감사표현',
    '정확한 업무처리',
    '정보보호',
    '상담태도',
];

export const CHECKLIST_TEMPLATE = [
    { category: '전화수신/종료태도', item: '전화수신/종료태도', validation_time: '배점 10' },
    { category: '첫인사', item: '첫인사', validation_time: '배점 10' },
    { category: '끝인사', item: '끝인사', validation_time: '배점 10' },
    { category: '문의내용 파악/경청', item: '문의내용 파악/경청', validation_time: '배점 10' },
    { category: '사과/대기/감사표현', item: '사과/대기/감사표현', validation_time: '배점 10' },
    { category: '정확한 업무처리', item: '정확한 업무처리', validation_time: '배점 20' },
    { category: '정보보호', item: '정보보호', validation_time: '배점 10' },
    { category: '상담태도', item: '상담태도', validation_time: '배점 20' },
];

// Pentagon 5축 — 컬렉션관리부 기준 (SSOT: docs/EVALUATION_ITEMS.md, Pentagon 5축 설계 절)
export const RADAR_KEYS = [
    'greeting_verify',
    'tone_language',
    'empathy_listening',
    'work_accuracy',
    'aftercare',
];

export const RADAR_REPORT_LABELS = [
    '인사·본인확인',
    '응대 화법·음성',
    '경청·공감 응대',
    '업무 정확도',
    '사후 처리',
];
