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

// 프롬프트의 '점수 단계: X / Y / Z' 줄에서 점수 단계 추출 — ★만점 제약 없음(프롬프트 권위).
// parseAllowedStepsFromPrompt 와 달리 steps[0]===만점 일치를 요구하지 않고, 프롬프트에 적힌 단계를
// 그대로 반환(내림차순·중복제거). 강제 0 추가 안 함 — 프롬프트가 0 을 안 적으면 최저 단계가 0 이
// 아닐 수 있음(예: 30/20/10 → 최저 10). 신규 브랜드 prompt-authoritative 경로 전용.
function parseStepsFromPromptLoose(promptTemplate) {
    const text = safeStr(promptTemplate);
    if (!text) return null;
    let nums = [];
    // ① '점수 단계:' 줄 우선 (가장 명확한 형식)
    const stepLine = text.split('\n').find((ln) => ln.includes('점수 단계'));
    if (stepLine) {
        nums = (stepLine.match(/\d+/g) || []).map((n) => parseInt(n, 10));
    } else {
        // ② 폴백 — 'N점:' / '- **N점**:' 형태 배점 항목 줄에서 점수 추출.
        //   ('N점 만점' 같은 만점 표기 줄은 제외 — 배점 단계가 아니라 총점 안내이므로)
        for (const ln of text.split('\n')) {
            if (ln.includes('만점')) continue;
            const m = ln.match(/(\d+)\s*점\s*\*{0,2}\s*[:：]/);
            if (m) nums.push(parseInt(m[1], 10));
        }
    }
    nums = nums.filter((n) => Number.isFinite(n) && n >= 0);
    const steps = Array.from(new Set(nums)).sort((a, b) => b - a);
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

// 프롬프트에 '실제 평가 기준 내용' 이 있는지 판정 — 기본 템플릿 스캐폴드 + placeholder 만 있으면 false.
// '평가 기준:' ~ '출력 형식:' 구간(헤더 없으면 전체)에서 placeholder 마커와 구조문자(•/-/:/공백/개행)를
// 제거한 뒤 실 텍스트가 남으면 true. 사용자가 placeholder 줄을 지우지 않고 기준을 '추가'만 해도 인식한다
// (예: "• (이 항목에 적용할 세부 기준을 입력하세요)\n상담사명 3점" → '상담사명3점' 잔존 → true).
function hasCriterionContent(value) {
    const s = safeStr(value);
    if (!s.trim()) return false;
    let section = s;
    const a = s.indexOf('평가 기준');
    if (a >= 0) {
        section = s.slice(a + '평가 기준'.length);
        const b = section.indexOf('출력 형식');
        if (b >= 0) section = section.slice(0, b);
    }
    section = section.split(PROMPT_PLACEHOLDER_MARKER).join('');
    section = section.replace(/[•\-:\s]/g, '');
    return section.length > 0;
}

// placeholder 마커 처리: 마커가 있어도 실 기준 내용이 있으면 **마커만 제거하고 본문은 살린다**(전체 blank 금지).
// 마커 + 스캐폴드만(기준 미입력)이면 '' → 호출부 미입력 게이트(evaluateStandardCall)가 평가 실행을 차단.
// 마커가 아예 없으면(사용자 자유 작성 프롬프트) 원문 그대로.
function sanitizePromptTemplate(value) {
    const s = safeStr(value);
    if (!s.includes(PROMPT_PLACEHOLDER_MARKER)) return s;
    if (!hasCriterionContent(s)) return '';
    return s.split(PROMPT_PLACEHOLDER_MARKER).join('').trim();
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

        const scoringType = safeStr(row.scoring_type).trim().toLowerCase();
        // ★ 채점 스케일(maxScore=파이프라인 max_score=allowed_steps[0]) 과 표시 분모(displayMax=만점 폼
        //   필드) 를 분리 — 전 브랜드 통일(2026-06-24 사용자 결정: 레거시·신규 무관 완전 독립).
        //   - 프롬프트 '점수 단계'가 파싱되면(점수제) 그게 곧 채점 척도(파이프라인 max_score/allowed_steps).
        //     파이프라인 _normalize_allowed_steps 가 steps[0]==max_score 를 강제하므로 max_score 도 프롬프트
        //     최상위 단계로 보낸다(채점이 그 단계들로 깨끗이 snap). 만점 폼 필드는 표시 분모(displayMax)로만
        //     분리 → 만점만 바꿔도 채점 불변(완전 독립).
        //   - displayMax 는 rowMeta 에 실려 결과 매퍼(신규=mapEvaluateResponseRubric / 코오롱 표준 트랙=
        //     standardMaxByOrder)가 분모로 사용 → "LLM점수(채점) / 만점필드(표시)".
        //   yes_no / 점수 단계 미파싱(default 코오롱 80점 등)은 채점==표시 결합 유지(byte-identical 무회귀).
        const promptSteps =
            scoringType !== 'yes_no'
                ? parseStepsFromPromptLoose(row.prompt_template)
                : null;
        let maxScore; // 파이프라인 채점 스케일 = allowed_steps[0]
        let allowedSteps;
        let displayMax; // 평가 결과 표시 분모
        if (promptSteps) {
            // 채점 = 프롬프트 단계(파이프라인 정규화가 steps[0]==max 를 강제하므로 max 도 최상위 단계로 일치).
            allowedSteps = promptSteps;
            maxScore = promptSteps[0];
            // 표시 분모 = 폼 만점 필드. 미입력 시 채점 스케일로 폴백(결합).
            const dbMax = asNumber(row.max_score);
            displayMax = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : maxScore;
        } else {
            // 점수 미명시(또는 레거시/yes_no) — 기존 동작: 폼 만점 + (점수단계 줄 || 카탈로그 스케일).
            const dbMax = asNumber(row.max_score);
            maxScore = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : catalogMaxScore(orderNo);
            allowedSteps =
                scoringType === 'yes_no'
                    ? [Math.round(maxScore), 0]
                    : parseAllowedStepsFromPrompt(row.prompt_template, maxScore) ||
                      catalogAllowedSteps(orderNo, maxScore);
            displayMax = maxScore; // 결합 — 채점==표시
        }
        const itemName = safeStr(row.item).trim() || `항목 ${orderNo}`;
        const categoryName = safeStr(row.category).trim();

        items.push({
            name: itemName,
            category: categoryName,
            max_score: maxScore,
            // 표시 분모(만점 폼 필드) — 채점 척도(max_score)와 독립. 백엔드 normalize_rubric 가
            // 패스스루 → ItemResult.display_max. rowMeta(매퍼 분모)와 동일 값(SSOT).
            display_max: displayMax,
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
        // rowMeta.max_score = 표시 분모(displayMax = 만점 폼 필드) — 채점 스케일(item.max_score=maxScore)과 분리.
        // scoring_type='yes_no' = 컴플라이언스 체크 항목 → 매퍼가 점수 합산(ai_score)에서 제외(순수 모니터링,
        // 기획 docs/YN_EVAL_ITEM_PLAN §4.2). 결과 행 자체는 기록(qa_evaluation_rows) → 위반율 집계에 사용.
        rowMeta.push({
            order_no: orderNo,
            category: categoryName,
            item: itemName,
            max_score: displayMax,
            scoring_type: scoringType === 'yes_no' ? 'yes_no' : 'numeric',
        });
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

/**
 * 도메인(업종)별 기본 평가항목(domain_default_eval_items)으로 인라인 루브릭 조립.
 * buildRubricFromDefs 와 동일한 item/rowMeta 형태를 산출하되 출처가 도메인 기본 테이블이다.
 * 튜터(02) 등 외부 시스템의 도메인 기준 딥평가가 이 루브릭을 rubric_inline 으로 엔진에 동봉.
 * 코오롱 레거시 제외(RUBRIC_EXCLUDED_ORDER_NOS) 없음 — 도메인 기본은 신규 트랙.
 * rowMeta 에 pentagon_axis 포함(호출부가 펜타곤 축 귀속에 사용).
 * @returns {Promise<{rubric:{tenant_id,name,items:Array}, orderMap:number[], rowMeta:Array}>}
 */
export async function buildRubricFromDomainDefaults(pool, domainId) {
    const { rows } = await pool.query(
        `SELECT order_no, category, item, criterion, prompt_template, max_score, scoring_type, pentagon_axis
           FROM public.domain_default_eval_items
          WHERE domain_id = $1
            AND is_active = true
          ORDER BY order_no ASC, id ASC`,
        [domainId]
    );

    const items = [];
    const orderMap = [];
    const rowMeta = [];
    for (const row of rows) {
        const orderNo = asNumber(row.order_no);
        if (orderNo === null) continue;

        const scoringType = safeStr(row.scoring_type).trim().toLowerCase();
        // 채점 스케일(maxScore=allowed_steps[0]) ↔ 표시 분모(displayMax) 분리 — buildRubricFromDefs 와 동일 규칙.
        const promptSteps =
            scoringType !== 'yes_no' ? parseStepsFromPromptLoose(row.prompt_template) : null;
        let maxScore;
        let allowedSteps;
        let displayMax;
        if (promptSteps) {
            allowedSteps = promptSteps;
            maxScore = promptSteps[0];
            const dbMax = asNumber(row.max_score);
            displayMax = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : maxScore;
        } else {
            const dbMax = asNumber(row.max_score);
            maxScore = dbMax !== null && dbMax > 0 ? Math.round(dbMax) : catalogMaxScore(orderNo);
            allowedSteps =
                scoringType === 'yes_no'
                    ? [Math.round(maxScore), 0]
                    : parseAllowedStepsFromPrompt(row.prompt_template, maxScore) ||
                      catalogAllowedSteps(orderNo, maxScore);
            displayMax = maxScore;
        }
        const itemName = safeStr(row.item).trim() || `항목 ${orderNo}`;
        const categoryName = safeStr(row.category).trim();

        items.push({
            name: itemName,
            category: categoryName,
            max_score: maxScore,
            display_max: displayMax,
            allowed_steps: allowedSteps,
            scoring_type: scoringType === 'yes_no' ? 'yes_no' : 'numeric',
            criteria_full: safeStr(row.criterion),
            prompt_template: sanitizePromptTemplate(row.prompt_template),
            notes: null,
            few_shot: false,
            debate: false,
            is_bonus: false,
        });
        orderMap.push(orderNo);
        rowMeta.push({
            order_no: orderNo,
            category: categoryName,
            item: itemName,
            max_score: displayMax,
            scoring_type: scoringType === 'yes_no' ? 'yes_no' : 'numeric',
            pentagon_axis: safeStr(row.pentagon_axis).trim() || null,
        });
    }

    return {
        rubric: {
            tenant_id: RUBRIC_TENANT_ID,
            name: RUBRIC_NAME,
            items,
            special_global: CUSTOM_SPECIAL_GLOBAL,
            special_enabled: true,
            grade_bands: CUSTOM_GRADE_BANDS,
            grade_bands_enabled: true,
        },
        orderMap,
        rowMeta,
    };
}
