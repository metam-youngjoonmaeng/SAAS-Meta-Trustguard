// 신규 브랜드 생성 시 eval_item_defs 에 기본 시드되는 18 항목.
// 원본: 01-QA_Dashboard/src/constants.js 의 CHECKLIST_TEMPLATE (STT 상담 품질 평가표).
// criterion / prompt_template 는 NULL — UI 에서 운영자가 추후 작성.

export const DEFAULT_EVAL_ITEMS = [
    { order_no: 1,  category: '인사 예절',         item: '첫인사' },
    { order_no: 2,  category: '인사 예절',         item: '끝인사' },
    { order_no: 3,  category: '경청 및 소통',      item: '경청 (말겹침/말자름)' },
    { order_no: 4,  category: '경청 및 소통',      item: '호응 및 공감' },
    { order_no: 5,  category: '경청 및 소통',      item: '대기 멘트' },
    { order_no: 6,  category: '언어 표현',         item: '정중한 표현' },
    { order_no: 7,  category: '언어 표현',         item: '쿠션어 활용' },
    { order_no: 8,  category: '니즈 파악',         item: '문의 파악 및 재확인(복창)' },
    { order_no: 9,  category: '니즈 파악',         item: '고객정보 확인' },
    { order_no: 10, category: '설명력 및 전달력',  item: '설명의 명확성' },
    { order_no: 11, category: '설명력 및 전달력',  item: '두괄식 답변' },
    { order_no: 12, category: '적극성',            item: '문제 해결 의지' },
    { order_no: 13, category: '적극성',            item: '부연 설명 및 추가 안내' },
    { order_no: 14, category: '적극성',            item: '사후 안내' },
    { order_no: 15, category: '업무 정확도',       item: '정확한 안내' },
    { order_no: 16, category: '업무 정확도',       item: '필수 안내 이행' },
    { order_no: 17, category: '개인정보 보호',     item: '정보 확인 절차' },
    { order_no: 18, category: '개인정보 보호',     item: '정보 보호 준수' },
];

// 07_eval_item_defs.sql 의 4-tuple UNIQUE (org_id, department, order_no, version) 키에 정합.
// department 는 버전 스코프 marker — 신규 브랜드는 부서 구분 없이 '기본' 스코프 단일 트랙으로 시작.
// (신한처럼 부서별 트랙이 필요하면 추후 별도 시드 또는 마이그로 분기)
const SEED_DEPARTMENT = '기본';
const SEED_VERSION = 1;

export async function seedDefaultEvalItems(client, orgId) {
    if (!Number.isFinite(Number(orgId))) {
        throw new Error('seedDefaultEvalItems: orgId must be a number');
    }
    for (const row of DEFAULT_EVAL_ITEMS) {
        await client.query(
            `INSERT INTO public.eval_item_defs
                 (org_id, order_no, category, item, criterion, prompt_template,
                  department, version, effective_from, deactivated_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, now(), NULL, now())
             ON CONFLICT (org_id, department, order_no, version) DO NOTHING`,
            [orgId, row.order_no, row.category, row.item, SEED_DEPARTMENT, SEED_VERSION]
        );
    }
    return DEFAULT_EVAL_ITEMS.length;
}
