/**
 * 대시보드 eval_item_defs(department='기본') → 커스텀 루브릭 빌더.
 *
 * 평가 시 백엔드(qa-pipeline, QA_RUBRIC_SOURCE=db)가 동일 쿼리로 eval_item_defs 를 읽어
 * 루브릭을 구성하므로 본 파일과 SSOT 동기 필수(v2/rubrics/db_source.py).
 * 대시보드는 metadata.org_id 만 전달하고, 응답 5000+index 항목을 order_no 로 환원하기 위한
 * orderMap(index→order_no) 만 본 빌더로 로컬 산출한다.
 *
 * 점수 항목 = order_no {1,2,4~14,17,18}. #3(파이프라인 미산출)·#15·#16(KMS 충족률 모델 대체)은 제외 —
 * 단, 해당 순번의 항목명이 코오롱 표준과 일치할 때만(타 테넌트 자체 항목은 보존).
 */

const SYNC_DEPARTMENT = '기본';
const RUBRIC_TENANT_ID = 'kolon';
const RUBRIC_NAME = '코오롱 표준 (dev프론트)';

const RUBRIC_EXCLUDED_ORDER_NOS = new Set([3, 15, 16]);
const KOLON_LEGACY_ITEM_NAMES = new Map([
    [3, '경청 (말겹침/말자름)'],
    [15, '정확한 안내'],
    [16, '필수 안내 이행'],
]);

// 카탈로그 기본 배점 — #10=10, 나머지=5.
const CATALOG_MAX_SCORE = new Map([[10, 10]]);
function catalogMaxScore(orderNo) {
    return CATALOG_MAX_SCORE.get(orderNo) ?? 5;
}

// 카탈로그 기본 점수 단계(qa_rules.py): #1~9·#11~14=[5,3,0] / #10=[10,7,5,0] / #17·#18=[5,0].
const CATALOG_ALLOWED_STEPS = new Map([
    [10, [10, 7, 5, 0]],
    [17, [5, 0]],
    [18, [5, 0]],
]);
function catalogAllowedSteps(orderNo, maxScore) {
    const base = CATALOG_ALLOWED_STEPS.get(orderNo) ?? [5, 3, 0];
    const ms = Math.round(Number(maxScore));
    if (!Number.isFinite(ms) || ms === base[0]) {
        return base.slice();
    }
    // 배점 변경 시 단계 구조를 새 만점에 비례 스케일(그라데이션 유지). 이진 항목(#17·#18)은 [max,0] 유지.
    const top = base[0];
    if (!Number.isFinite(top) || top <= 0 || ms <= 0) {
        return ms > 0 ? [ms, 0] : [0];
    }
    const factor = ms / top;
    const scaled = base.map((s) => Math.round(s * factor));
    scaled[0] = ms;
    const out = Array.from(new Set(scaled.filter((n) => Number.isFinite(n) && n >= 0))).sort(
        (a, b) => b - a,
    );
    if (out[out.length - 1] !== 0) out.push(0);
    return out.length >= 2 ? out : [ms, 0];
}

// 커스텀 100점 3단계 트랙(이커머스/은행) 표준 가·감점 — 정규 점수 외 별도 조정.
// 백엔드 report 가 deduction_triggers(불친절/개인정보) 와 연동해 after_overrides 에 적용.
// manual=true(우수 +5)는 자동 미적용(평가자 확정). 값은 평가표 '등급·가감점' 시트 기준.
const CUSTOM_SPECIAL_GLOBAL = [
    { kind: 'penalty', trigger: 'unfriendly', amount: -20, condition: '욕설·비하·반말·다그침 등 불친절 (중대 시 콜 0점)' },
    { kind: 'penalty', trigger: 'privacy', amount: -10, cap: -20, condition: '본인확인 전 정보 안내·선언급·제3자 유출 (중대 -20)' },
    { kind: 'bonus', trigger: 'excellent', amount: 5, manual: true, condition: '우수 상담 (평가자 확인 후 확정)' },
];
// 등급 밴드 — S 95+ / A 90~94 / B 80~89 / C 70~79 / D 70 미만 (100점 환산 기준).
const CUSTOM_GRADE_BANDS = [
    { grade: 'S', min_score: 95 },
    { grade: 'A', min_score: 90 },
    { grade: 'B', min_score: 80 },
    { grade: 'C', min_score: 70 },
    { grade: 'D', min_score: 0 },
];

// prompt_template '점수 단계: X / Y / 0' 줄에서 실제 허용 단계 파싱.
// eval_item_defs 에 단계 컬럼이 없어 본문에 정답 단계가 기재됨(예: '점수 단계: 8 / 4 / 0').
// 비례 스케일(catalogAllowedSteps)은 비균등 부분점수(5→3, 3→1, 18→9 등)를 틀리게 만들므로
// 본문 단계를 최우선 사용. 선두값이 maxScore 와 불일치/파싱 실패 시 null → 카탈로그 폴백.
function parseAllowedStepsFromPrompt(promptTemplate, maxScore) {
    const text = safeStr(promptTemplate);
    if (!text) return null;
    const line = text.split('\n').find((ln) => ln.includes('점수 단계'));
    if (!line) return null;
    const nums = (line.match(/\d+/g) || []).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 0);
    let steps = Array.from(new Set(nums)).sort((a, b) => b - a);
    if (steps.length < 2) return null;
    if (steps[steps.length - 1] !== 0) steps.push(0);
    const ms = Math.round(Number(maxScore));
    if (!Number.isFinite(ms) || steps[0] !== ms) return null;
    return steps.length >= 2 ? steps : null;
}

function safeStr(value) {
    return value === null || value === undefined ? '' : String(value);
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}


// 프론트 미리보기 기본 placeholder 프롬프트 가드 — "편집하기 → 그대로 저장" 시 placeholder
// 원문이 DB prompt_template 로 유입될 수 있다. 이 마커가 남아있으면 세부 기준 미입력
// 원문이므로 빈 값으로 정화해 동봉 (백엔드 custom_rubric/prompt.py 가 동일 마커로 2중 가드).
const PROMPT_PLACEHOLDER_MARKER = '(이 항목에 적용할 세부 기준을 입력하세요)';
function sanitizePromptTemplate(value) {
    const s = safeStr(value);
    return s.includes(PROMPT_PLACEHOLDER_MARKER) ? '' : s;
}

/**
 * eval_item_defs(org, department='기본', is_active) 를 order_no 오름차순으로 읽어 루브릭 items[] 조립.
 * @returns {Promise<{rubric:{tenant_id,name,items:Array}, orderMap:number[], rowMeta:Array}>}
 *   orderMap[index] = 루브릭 항목의 order_no, rowMeta[index] = {order_no,category,item,max_score}.
 */
export async function buildRubricFromDefs(pool, orgId) {
    const { rows } = await pool.query(
        `SELECT order_no, category, item, criterion, prompt_template, max_score, scoring_type
           FROM public.eval_item_defs
          WHERE org_id = $1
            AND department = $2
            AND deactivated_at IS NULL
            AND is_active = true
          ORDER BY order_no ASC`,
        [orgId, SYNC_DEPARTMENT]
    );

    const items = [];
    const orderMap = [];
    const rowMeta = [];
    for (const row of rows) {
        const orderNo = asNumber(row.order_no);
        if (orderNo === null) continue;
        if (
            RUBRIC_EXCLUDED_ORDER_NOS.has(orderNo) &&
            safeStr(row.item).trim() === KOLON_LEGACY_ITEM_NAMES.get(orderNo)
        ) {
            continue;
        }

        const dbMax = asNumber(row.max_score);
        const maxScore = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : catalogMaxScore(orderNo);
        // 점수 단계 결정 (SSOT: db_source.py 와 동일 의미):
        //   scoring_type==='yes_no' → 만점·0 의 2단계 고정([Math.round(max),0]). prompt 본문
        //     '점수 단계' 줄보다 상위 우선순위 — Y/N 항목은 중간 단계가 의미 없으므로
        //     prompt 파싱/카탈로그 스케일을 건너뛰고 이진으로 강제.
        //   그 외(numeric / scoring_type 미지정) → 기존 동작 byte-identical 보존:
        //     prompt_template '점수 단계: X / Y / 0' 우선, 실패 시 카탈로그 비례 스케일.
        const scoringType = safeStr(row.scoring_type).trim().toLowerCase();
        const allowedSteps =
            scoringType === 'yes_no'
                ? [Math.round(maxScore), 0]
                : parseAllowedStepsFromPrompt(row.prompt_template, maxScore) ||
                  catalogAllowedSteps(orderNo, maxScore);
        const itemName = safeStr(row.item).trim() || `항목 ${orderNo}`;
        const categoryName = safeStr(row.category).trim();

        items.push({
            name: itemName,
            category: categoryName,
            max_score: maxScore,
            allowed_steps: allowedSteps,
            // 채점 방식 동봉 (SSOT: db_source.py item dict 와 정합). 백엔드
            // custom_rubric/prompt.py 의 build_rubric_item_block 이 이 값으로 Y/N
            // 채점 의미 블록 주입 여부를 판단 — 누락 시 allowed_steps 가 [max,0] 여도
            // numeric 으로 귀결되어 인라인 경로에서 Y/N 의미가 소실되는 회귀 방지.
            scoring_type: scoringType === 'yes_no' ? 'yes_no' : 'numeric',
            criteria_full: safeStr(row.criterion),
            // 항목 전용 평가 프롬프트 — 인라인 루브릭에 동봉해야 백엔드(custom_rubric/prompt.py)가
            // LLM 프롬프트에 원문 주입. 누락 시 만점 기준(criteria_full)만 전달되는 회귀.
            // placeholder 미수정 원문은 빈 값으로 정화(sanitizePromptTemplate).
            prompt_template: sanitizePromptTemplate(row.prompt_template),
            notes: null,
            few_shot: false,
            debate: false,
            is_bonus: false,
        });
        orderMap.push(orderNo);
        rowMeta.push({ order_no: orderNo, category: categoryName, item: itemName, max_score: maxScore });
    }

    return {
        rubric: {
            tenant_id: RUBRIC_TENANT_ID,
            name: RUBRIC_NAME,
            items,
            // 가·감점(정규 점수 외) + 등급 밴드 — 백엔드 report 가 deduction_triggers 연동해
            // 점수 적용 + grade_bands 로 권위 등급 산출. 코오롱 표준 트랙은 rubric_inline 미사용이라 무영향.
            special_global: CUSTOM_SPECIAL_GLOBAL,
            special_enabled: true,
            grade_bands: CUSTOM_GRADE_BANDS,
            grade_bands_enabled: true,
        },
        orderMap,
        rowMeta,
    };
}
