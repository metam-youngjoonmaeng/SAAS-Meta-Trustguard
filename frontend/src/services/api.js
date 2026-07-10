export const QA_ACTOR_STORAGE_KEY = 'qa_dashboard_actor';
export const QA_ACTIVE_BRAND_KEY = 'qa_dashboard_active_brand_id';

// 비밀번호 정책 (서버 userProfile.mjs PASSWORD_POLICY_RE 와 정합).
// UI 안내 문구/검증에서 공통 사용.
export const PASSWORD_POLICY_HINT = '※ 영문, 숫자, 특수문자[ @$!%*#?& ] 포함 8~20자';
export const PASSWORD_POLICY_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,20}$/;

function actorRequestHeaders() {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        if (!raw) return {};
        const u = JSON.parse(raw);
        const h = {};
        if (u.user_id != null && u.user_id !== '') h['X-Actor-User-Id'] = String(u.user_id);
        if (u.login_id) h['X-Actor-Login-Id'] = encodeURIComponent(String(u.login_id));
        if (u.role) h['X-Actor-Role'] = encodeURIComponent(String(u.role));
        if (u.session_token) h['X-Session-Token'] = String(u.session_token);
        // super_admin 활성 브랜드 컨텍스트. admin 은 서버에서 헤더를 무시하므로 항상 본인 org_id 로 강제 필터.
        if (u.role === 'super_admin') {
            const activeBrand = window.localStorage.getItem(QA_ACTIVE_BRAND_KEY);
            if (activeBrand) h['X-Active-Brand-Id'] = String(activeBrand);
        }
        return h;
    } catch {
        return {};
    }
}

async function request(path, options = {}) {
    const res = await fetch(path, {
        headers: {
            'Content-Type': 'application/json',
            ...actorRequestHeaders(),
            ...(options.headers || {}),
        },
        ...options,
    });
    if (res.status === 401 && !path.startsWith('/api/auth/login') && typeof window !== 'undefined' && window.localStorage) {
        // 세션 만료/무효 → 잔존 LocalStorage 정리 후 React state 도 즉시 로그아웃 상태로 끊기 위해 이벤트 발행.
        window.localStorage.removeItem(QA_ACTOR_STORAGE_KEY);
        window.localStorage.removeItem('qa_dashboard_auth');
        window.localStorage.removeItem('qa_dashboard_auth_expires_at');
        window.dispatchEvent(new CustomEvent('qa:auth-required'));
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = text || `Request failed: ${res.status}`;
        // 서버 오류는 {message} JSON 으로 내려오므로 message 만 추출 (실패 시 원문 유지).
        try {
            const j = JSON.parse(text);
            if (j && j.message) message = j.message;
        } catch {
            /* non-JSON 본문은 원문 그대로 */
        }
        throw new Error(message);
    }
    return res.json();
}

export async function login(id, password) {
    const data = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ id, password }),
    });
    return data;
}

// ICS SSO — ICS 어드민 메뉴 팝업에서 ?userId=USER_CD@PROJ_CD 진입 시 호출.
export async function icsSso(userId) {
    const data = await request('/api/auth/ics-sso', {
        method: 'POST',
        body: JSON.stringify({ userId: String(userId || '').trim() }),
    });
    return data;
}

export async function logout(loginId) {
    return request('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ login_id: String(loginId || '').trim() }),
    });
}

// 다중 소속(02/03 동일) — 내 조직 멤버십 목록.
export async function fetchMyMemberships() {
    return request('/api/auth/memberships');
}

// 활성 조직 전환. 서버 세션 org/role 교체 + 프론트 actor 캐시(role/org)도 동기화.
// (호출부는 성공 후 window.location.reload() 로 전 화면을 새 org 로 재조회하는 것을 권장.)
export async function switchOrg(traineeId) {
    const res = await request('/api/auth/switch-org', {
        method: 'POST',
        body: JSON.stringify({ trainee_id: traineeId }),
    });
    try {
        syncStoredActor({ org_id: res.org_id ?? null, role: res.role });
        // super_admin 은 org 스코프가 X-Active-Brand-Id 헤더 기반 → 전환한 org 로 활성 브랜드도 맞춤.
        if (res.role === 'super_admin' && typeof window !== 'undefined' && window.localStorage && res.org_id != null) {
            window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(res.org_id));
        }
    } catch { /* 캐시 동기화 실패는 무시(리로드로 서버기준 복구) */ }
    return res;
}

export async function fetchCalls() {
    return request('/api/calls');
}

// 관리자 — 평가 콜 삭제(벌크). qa_calls 행 삭제 시 자식 테이블(평가/분석/대화/검수 등)이 CASCADE 로 함께 제거.
// body { ids:[...] } 단일 요청으로 처리(서버 트랜잭션). 응답 { ok, deleted }.
export async function deleteCalls(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (!list.length) throw new Error('ids is required');
    return request('/api/calls', { method: 'DELETE', body: JSON.stringify({ ids: list }) });
}

// 코칭 배정용 실제 상담사 목록(평균점수·부서·콜수). admin_users + qa_calls 조인.
export async function fetchAgents() {
    return request('/api/agents');
}

// 전체 통계 대시보드 데이터. params: { period: 'day'|'week'|'month', department?: string }
export async function fetchStats({ period = 'week', department } = {}) {
    const qs = new URLSearchParams({ period });
    if (department) qs.set('department', department);
    return request(`/api/stats?${qs.toString()}`);
}

export async function fetchAnalysis(qaId) {
    if (!qaId) return null;
    return request(`/api/analysis/${encodeURIComponent(qaId)}`);
}

/** 평가 상세 조회. 응답 top-level 에 `kms` 필드 포함(고객지원실 등 표준 트랙) —
 *  qa-pipeline kms_evaluation 블록 또는 null. 점수 합계와 별개(충족률 모델). */
export async function fetchEvaluations(qaId) {
    if (!qaId) return null;
    return request(`/api/evaluations/${encodeURIComponent(qaId)}`);
}

// 내게 배정된 코칭 — 05 coaching_assignments(본인이 members 에 포함된 것).
export async function fetchMyCoaching() {
    return request('/api/coaching/mine');
}

// 관리자 — 조직 전체 코칭 배정 목록(coaching_assignments, org 스코프). 관리자끼리 공유됨.
export async function fetchCoaching() {
    return request('/api/coaching');
}

// 관리자 — 코칭 배정 생성. body: { title, targetType, channel, members, items, scenarios, reasons }.
//   reasons: [{ memberId, callIds: [qa_call_id...] }] — 배정 근거(문제 콜), 선택.
export async function createCoaching(payload) {
    return request('/api/coaching', { method: 'POST', body: JSON.stringify(payload || {}) });
}

// 관리자 — 특정 상담사의 콜 이력(배정 근거 콜 피커). 저점수 우선 정렬·페이징.
//   opts: { from, to(YYYY-MM-DD), io('I'|'O'|''), sort('score'|'date'), page, limit }
//   응답: { total, page, limit, items:[{ id, date, score, uid, callNo, ioDivi, channel }] }
export async function fetchAgentCalls(agentId, { from, to, io, sort, page, limit } = {}) {
    if (agentId == null) throw new Error('agentId is required');
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (io) qs.set('io', io);
    if (sort) qs.set('sort', sort);
    if (page) qs.set('page', String(page));
    if (limit) qs.set('limit', String(limit));
    return request(`/api/agents/${encodeURIComponent(agentId)}/calls?${qs.toString()}`);
}

// 관리자 — 코칭 배정 삭제.
export async function deleteCoaching(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/coaching/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// 관리자 — 코칭 보드에서 정리(아카이브). 레코드 보존 → 코칭 이력엔 계속 노출.
export async function archiveCoaching(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/coaching/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

// 상담사 — 본인 보드에서만 정리(멤버별). 다른 멤버·관리자 보드엔 영향 없음. 코칭 이력엔 유지.
export async function archiveMyCoaching(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/coaching/${encodeURIComponent(id)}/archive-mine`, { method: 'POST' });
}

// 관리자 — 코칭 이력(상담사별). 코칭배정 × 멤버 + 배정 전/후 평균점수.
export async function fetchCoachingHistory() {
    return request('/api/coaching/history');
}

// 내 TA 지표(부정발화·회복률·금칙어) — 03(Meta_Summary) tb_ta_rslt 를 본인 콜(uid) 기준 집계.
// 기간({start,end} Date) → from/to=YYYY-MM-DD 쿼리 조각. '전체'(start/end null) = 빈 문자열(무필터).
function taPeriodQuery(period) {
    const fmt = (d) => {
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const from = fmt(period?.start);
    const to = fmt(period?.end);
    const parts = [];
    if (from) parts.push(`from=${from}`);
    if (to) parts.push(`to=${to}`);
    return parts.join('&');
}

// 응답: { enabled, total, negative_count/rate, banned_count/rate, recovery_denom/count/rate }.
// enabled=false 면 TA DB 미연동(프론트는 mock 폴백). period 지정 시 기간 필터(A-71).
export async function fetchMyTaMetrics(period = null) {
    const q = taPeriodQuery(period);
    return request(`/api/me/ta-metrics${q ? `?${q}` : ''}`);
}

// 감정·대화 품질 카드 드릴다운 — kind=negative|recovery|forbidden 의 '내 콜' 목록.
// 응답: { enabled, kind, calls:[...] } (kind별 필드 상이 — CounselorResults 참조). period=지표 카드와 동일 기간.
export async function fetchMyTaMetricCalls(kind, period = null) {
    const q = taPeriodQuery(period);
    return request(`/api/me/ta-metrics/calls?kind=${encodeURIComponent(kind)}${q ? `&${q}` : ''}`);
}

// AI 평가 배치관리 — 조건 설정 조회/저장 + 예상 대상 미리보기(실데이터).
// config = BatchManage 화면 state 직렬화({ on, quality, confidence, tenure, bias, scope }).
export async function fetchBatchConfig() {
    return request('/api/batch/config');
}
export async function saveBatchConfig(config) {
    return request('/api/batch/config', {
        method: 'PUT',
        body: JSON.stringify({ config: config || {} }),
    });
}
export async function previewBatch(config) {
    return request('/api/batch/preview', {
        method: 'POST',
        body: JSON.stringify({ config: config || {} }),
    });
}
// 수기평가 대상 도장 즉시 실행(수동/정기 주기의 '지금 실행'). 응답: { ok, stamped }.
export async function runBatchNow() {
    return request('/api/batch/run', { method: 'POST' });
}
// 골든셋 학습 배치 수동 트리거(백그라운드 실행) — 즉시 { ok, started, golden_count } 반환. 진행/결과는 status 폴링.
export async function runGoldenLearn() {
    return request('/api/golden-learn/run', { method: 'POST' });
}
// 골든셋 학습 잡 상태 — { state:'running'|'done'|'error'|'idle', golden_count, result } 반환.
export async function fetchGoldenLearnStatus() {
    return request('/api/golden-learn/status');
}
// 골든셋 규모/학습 기준일(정밀) — { golden_count, conversation_count, latest_golden_at,
//   indexed_count, indexed_conversation_count, latest_indexed_at, needs_relearn } 반환.
export async function fetchGoldenLearnCoverage() {
    return request('/api/golden-learn/coverage');
}
// ② '적용 평가 항목' 칩 — 실제 평가된 항목(order_no+item). 제외 order_no 로 ② 검사 스코프.
export async function fetchBatchEvalItems() {
    return request('/api/batch/eval-items');
}

// ② AI 신뢰도 검증 판정 프롬프트(불확실 표현·근거-점수 모순 두 정의문) 조회/저장/재판정.
// 응답: { uncertain_def, contradiction_def, default_*, version, is_default, judge_enabled, model }.
export async function fetchBatchPrompt() {
    return request('/api/batch/prompt');
}
// 저장 시 변경되면 version 증가 → 기존 판정 stale. 응답: { version, unchanged, stale_count }.
export async function saveBatchPrompt({ uncertain_def, contradiction_def } = {}) {
    return request('/api/batch/prompt', {
        method: 'PUT',
        body: JSON.stringify({
            uncertain_def: String(uncertain_def ?? ''),
            contradiction_def: String(contradiction_def ?? ''),
        }),
    });
}
// 현재 프롬프트 버전으로 미판정 콜 재판정(백그라운드 시작). 진행상황은 fetchRejudgeStatus 로 폴링.
export async function rejudgeConfidence() {
    return request('/api/batch/rejudge', { method: 'POST' });
}
export async function fetchRejudgeStatus() {
    return request('/api/batch/rejudge/status');
}
// 판정 프롬프트 변경 이력(버전별 스냅샷, 최신순). 응답: { items: [{ version, uncertain_def, contradiction_def, updated_at, updated_by_name }] }.
export async function fetchBatchPromptHistory() {
    return request('/api/batch/prompt/history');
}

export async function saveAdminComments(qaId, adminComments) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/evaluations/${encodeURIComponent(qaId)}/admin-comments`, {
        method: 'PUT',
        body: JSON.stringify({
            admin_comments: Array.isArray(adminComments) ? adminComments : [],
        }),
    });
}

/** 수기 배점(항목별) 저장 → evaluation_rows·manual_score 갱신 */
export async function saveManualEvaluationPatches(qaId, manualPatches) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/evaluations/${encodeURIComponent(qaId)}`, {
        method: 'PUT',
        body: JSON.stringify({
            manual_patches: Array.isArray(manualPatches) ? manualPatches : [],
        }),
    });
}

/** 검수상태 변경. 반복 검토 루프: pending/in_review/review_done/admin_revised/approved.
 *  force=true 면 수정사항이 있어도 상담사 확인 없이 강제 최종승인(관리자 오버라이드). */
export async function updateReviewStatus(qaId, reviewStatus, { force = false, reason } = {}) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/calls/${encodeURIComponent(qaId)}/review-status`, {
        method: 'PUT',
        body: JSON.stringify({
            review_status: reviewStatus,
            ...(force ? { force: true } : {}),
            ...(reason ? { reason } : {}),
        }),
    });
}

// 검수 이력(타임라인) — 상세화면 "검수 이력" 팝업용. created_at 오름차순.
export async function fetchReviewEvents(qaId) {
    if (!qaId) return [];
    return request(`/api/calls/${encodeURIComponent(qaId)}/review-events`);
}


/** 평가 항목 단위 골든셋 사례 조회 (브랜드 컨텍스트는 헤더로 자동 적용).
 *  서버는 order_no 가 있으면 그것만으로 매칭, 없으면 (category,item) 폴백. */
export async function fetchGoldenCasesByItem({ category, item, orderNo } = {}) {
    const params = new URLSearchParams();
    if (orderNo !== undefined && orderNo !== null && orderNo !== '') {
        params.set('order_no', String(orderNo));
    }
    if (category) params.set('category', category);
    if (item) params.set('item', item);
    const qs = params.toString();
    return request(`/api/golden-set${qs ? `?${qs}` : ''}`);
}

/** 골든셋 목록 조회 — 콜 단위. 응답: { ok, entries: [{ order_no, ... }, ...] } */
export async function fetchGoldenSet(qaId) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/golden-set/${encodeURIComponent(qaId)}`);
}

/** 골든셋 등록 (서버가 현재 데이터에서 스냅샷). 중복 시 멱등 (inserted=false) */
export async function addGoldenSet(qaId, orderNo) {
    if (!qaId) throw new Error('qaId is required');
    return request(
        `/api/golden-set/${encodeURIComponent(qaId)}/${encodeURIComponent(orderNo)}`,
        { method: 'POST' }
    );
}

/** 골든셋 해제 */
export async function removeGoldenSet(qaId, orderNo) {
    if (!qaId) throw new Error('qaId is required');
    return request(
        `/api/golden-set/${encodeURIComponent(qaId)}/${encodeURIComponent(orderNo)}`,
        { method: 'DELETE' }
    );
}

/** 스킬셋(수기 '높음'/'낮음' 정정 누적) 조회 — 항목(order_no) 단위. 응답 { ok, entries } */
export async function fetchSkillset({ category, item, orderNo } = {}) {
    const params = new URLSearchParams();
    if (orderNo !== undefined && orderNo !== null && orderNo !== '') params.set('order_no', String(orderNo));
    if (category) params.set('category', category);
    if (item) params.set('item', item);
    const qs = params.toString();
    return request(`/api/skillset${qs ? `?${qs}` : ''}`);
}

/** 스킬셋에서 제외(배치 학습 대상에서 제거). 원본 평가행은 불변. */
export async function removeSkillset(qaId, orderNo) {
    if (!qaId) throw new Error('qaId is required');
    return request(
        `/api/skillset/${encodeURIComponent(qaId)}/${encodeURIComponent(orderNo)}`,
        { method: 'DELETE' }
    );
}

/** 소비자보호부 20항목 Y/N 저장 → qa_consumer_eval_rows 갱신 */
export async function saveConsumerYnPatches(qaId, consumerYnPatches) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/evaluations/${encodeURIComponent(qaId)}`, {
        method: 'PUT',
        body: JSON.stringify({
            consumer_yn_patches: Array.isArray(consumerYnPatches) ? consumerYnPatches : [],
        }),
    });
}

/* ── 평가항목 정의 (criterion + prompt_template) + 버전 관리 ────────
 * 항목 메타(category/item/order_no/만점/매핑)는 프론트 constants.js 가 SSOT.
 * 본 엔드포인트는 (org_id, department, order_no, version) 키로 정의/버전 메타를 저장/조회.
 * 버전 관리 설계는 docs/EVALUATION_ITEMS.md "평가체계 버전 관리" 섹션 참조. */
export async function fetchEvalItemDefs({ department, version } = {}) {
    const params = new URLSearchParams();
    if (department) params.set('department', department);
    if (version !== undefined && version !== null) params.set('version', String(version));
    const qs = params.toString();
    return request(`/api/admin/eval-items${qs ? `?${qs}` : ''}`);
}

export async function fetchEvalItemVersions() {
    return request('/api/admin/eval-item-versions');
}

// AI 프롬프트 다듬기 — 러프 설명 초안 → 구조화 평가 프롬프트 생성(서버가 파이프라인 프록시).
// payload: { item_name, category, scoring_type, max_score, steps:[{score, condition}], criterion_draft, yn_criteria_draft }
export async function composeEvalPrompt(payload) {
    return request('/api/admin/eval-items/compose-prompt', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
    });
}

export async function saveEvalItemDef(orderNo, {
    category, item, criterion, prompt_template,
    pentagon_axis, scoring_type, max_score, is_active,
    department, is_meaning_change,
} = {}) {
    if (orderNo === undefined || orderNo === null) throw new Error('orderNo is required');
    return request(`/api/admin/eval-items/${encodeURIComponent(orderNo)}`, {
        method: 'PUT',
        body: JSON.stringify({
            category, item, criterion, prompt_template,
            pentagon_axis, scoring_type, max_score, is_active,
            department, is_meaning_change,
        }),
    });
}

// 신규 평가항목 생성. departments 는 1개 이상의 부서. 서버가 order_no 자동 발급.
export async function createEvalItemDef({
    category, item, criterion, prompt_template,
    pentagon_axis, scoring_type, max_score, is_active,
    departments,
} = {}) {
    return request('/api/admin/eval-items', {
        method: 'POST',
        body: JSON.stringify({
            category, item, criterion, prompt_template,
            pentagon_axis, scoring_type, max_score, is_active,
            departments,
        }),
    });
}

// 평가항목 삭제 (소프트 삭제). 해당 order_no 의 활성 행을 비활성화 → 목록/평가에서 제외, 이력 보존.
// department 지정 시 해당 부서 행만 삭제(타 부서 동일 order_no 항목 보존). 미지정 시 전 부서.
export async function deleteEvalItemDef(orderNo, department) {
    if (orderNo === undefined || orderNo === null) throw new Error('orderNo is required');
    const qs = department ? `?department=${encodeURIComponent(department)}` : '';
    return request(`/api/admin/eval-items/${encodeURIComponent(orderNo)}${qs}`, {
        method: 'DELETE',
    });
}

/* ── Pentagon 축 ─────────────────────────────────────────────── */

export async function fetchPentagonAxes({ department } = {}) {
    const params = new URLSearchParams();
    if (department) params.set('department', department);
    const qs = params.toString();
    return request(`/api/admin/pentagon-axes${qs ? `?${qs}` : ''}`);
}

export async function createPentagonAxis({ label, description, prompt_template, is_active, department } = {}) {
    return request('/api/admin/pentagon-axes', {
        method: 'POST',
        body: JSON.stringify({ label, description, prompt_template, is_active, department }),
    });
}

export async function savePentagonAxis(axisNo, { label, description, prompt_template, is_active, department } = {}) {
    if (axisNo === undefined || axisNo === null) throw new Error('axisNo is required');
    return request(`/api/admin/pentagon-axes/${encodeURIComponent(axisNo)}`, {
        method: 'PUT',
        body: JSON.stringify({ label, description, prompt_template, is_active, department }),
    });
}

// 활성 브랜드의 전체 평가항목 변경 이력 (시간순 DESC). 항목 삭제 후에도 통합 화면에서 표시 가능.
export async function fetchEvalItemHistory({ department, changeType, limit } = {}) {
    const params = new URLSearchParams();
    if (department) params.set('department', department);
    if (changeType) params.set('change_type', changeType);
    if (limit !== undefined && limit !== null) params.set('limit', String(limit));
    const qs = params.toString();
    return request(`/api/admin/eval-item-history${qs ? `?${qs}` : ''}`);
}

/* ── KSQI STT 카탈로그 ──────────────────────────────────────────
 * KSQI STT 평가표 정의 조회. orgId 지정 시 서버가 브랜드별 DB(ksqi_item_defs)를 우선 조회하고
 * 판정 기준 본문(criterion)만 파이프라인 카탈로그에서 병합. 미지정/미시딩 시 파이프라인 프록시.
 * 각 항목: { number, name, area("A"|"B"), kind("llm"|"auto"), max_score, category, is_active,
 *           criterion(llm=판정 프롬프트 본문 / auto=대체채널 안내), alt_channel(auto만) }.
 * 읽기 전용(KsqiMgmt 뷰). 서버 래핑 여부와 무관하게 배열로 정규화해 반환. */
export async function fetchKsqiCatalog(orgId = null) {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    const data = await request(`/api/ksqi-stt/catalog${qs}`);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.catalog)) return data.catalog;
    if (Array.isArray(data?.items)) return data.items;
    return [];
}

/* ── 브랜드 / 도메인 ────────────────────────────────────────── */

export async function fetchOrganizations() {
    return request('/api/admin/organizations');
}

export async function fetchBrands() {
    return request('/api/admin/brands');
}

export async function createBrand(body) {
    return request('/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function updateBrand(id, body) {
    return request(`/api/admin/brands/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteBrand(id) {
    return request(`/api/admin/brands/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

export async function fetchDomains() {
    return request('/api/admin/domains');
}

export async function createDomain(body) {
    return request('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function updateDomain(id, body) {
    return request(`/api/admin/domains/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteDomain(id) {
    return request(`/api/admin/domains/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

/* ── 도메인별 기본 평가항목 (domain_default_eval_items, super_admin) ── */
// 신규 브랜드 생성 시 eval_item_defs 로 복제되는 도메인(업종) 템플릿.

export async function fetchDomainEvalDefaults(domainId) {
    return request(`/api/admin/domains/${encodeURIComponent(domainId)}/eval-defaults`);
}

export async function createDomainEvalDefault(domainId, body) {
    return request(`/api/admin/domains/${encodeURIComponent(domainId)}/eval-defaults`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function updateDomainEvalDefault(itemId, body) {
    return request(`/api/admin/domain-eval-defaults/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteDomainEvalDefault(itemId) {
    return request(`/api/admin/domain-eval-defaults/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
    });
}

/* ── 도메인별 기본 펜타곤 축 (domain_default_pentagon_axes, super_admin) ── */

export async function fetchDomainPentagonDefaults(domainId) {
    return request(`/api/admin/domains/${encodeURIComponent(domainId)}/pentagon-defaults`);
}

export async function createDomainPentagonDefault(domainId, body) {
    return request(`/api/admin/domains/${encodeURIComponent(domainId)}/pentagon-defaults`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function updateDomainPentagonDefault(itemId, body) {
    return request(`/api/admin/domain-pentagon-defaults/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteDomainPentagonDefault(itemId) {
    return request(`/api/admin/domain-pentagon-defaults/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
    });
}

/* ── 사용자(admin_users) ────────────────────────────────────── */

export async function fetchUsers(brandId) {
    const qs = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : '';
    return request(`/api/admin/users${qs}`);
}

export async function createUser(body) {
    return request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateUser(id, body) {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteUser(id) {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 사용자 비밀번호를 초기 비밀번호로 재설정 (super_admin 전용).
 *  응답: { ok, initial_password, user: { user_id, login_id, display_name } } */
export async function resetUserPassword(id) {
    return request(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
        method: 'POST',
    });
}

// ── 유저 멤버십(다중 소속) 관리 (super_admin 전용) ──
export async function fetchUserMemberships(userId) {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/memberships`);
}
export async function addUserMembership(userId, body) {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/memberships`, {
        method: 'POST', body: JSON.stringify(body || {}),
    });
}
export async function removeUserMembership(userId, traineeId) {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(traineeId)}`, {
        method: 'DELETE',
    });
}

/* ── 본인 프로필 (셀프-편집) ───────────────────────────────────
 * 신규 사용자는 초기 비밀번호 발급 + must_change_password=true 로 시작.
 * 본인은 다음만 변경 가능: display_name, password.
 * (login_id / role / org_id / is_active 변경 불가 — super_admin 만 가능) */
export async function fetchMe() {
    return request('/api/me');
}

export async function updateMe({ display_name, current_password, new_password } = {}) {
    const body = {};
    if (typeof display_name === 'string') body.display_name = display_name;
    if (typeof new_password === 'string' && new_password) {
        body.new_password = new_password;
        body.current_password = current_password || '';
    }
    return request('/api/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

/** localStorage 에 저장된 actor 캐시를 서버 최신 상태로 갱신.
 *  ProfileModal 저장 후 호출해 Nav 헤더가 즉시 새 이름을 반영하도록 한다. */
export function syncStoredActor(patch) {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        const cur = raw ? JSON.parse(raw) : {};
        const next = { ...cur, ...patch };
        window.localStorage.setItem(QA_ACTOR_STORAGE_KEY, JSON.stringify(next));
        return next;
    } catch {
        return null;
    }
}

/* ── 감사 로그 ─────────────────────────────────────────────── */

export async function fetchAuditLogs({ limit, before, action } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (before) params.set('before', String(before));
    if (action) params.set('action', String(action));
    const qs = params.toString();
    return request(`/api/admin/audit-logs${qs ? `?${qs}` : ''}`);
}

/* ── Application 로그(파일 기반) ────────────────────────────
 * winston-daily-rotate-file 가 logs/app-YYYY-MM-DD.log 로 적재한 라인을 파싱해 반환.
 * 응답: { file, exists, lines: [{ ts, level, module, message }, ...] }
 */
export async function fetchAppLogsRecent({ limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return request(`/api/admin/logs/recent${qs ? `?${qs}` : ''}`);
}

/* ── RAG · 사전 로그(서버 인메모리 링버퍼) ───────────────────────
 * 평가 시 sub-agent 가 emit 한 RAG few-shot hit / 금지어·사전 매칭을 백엔드 인메모리
 * 링버퍼에 적재한 항목을 최신순으로 반환. (평가 요청에 disable_rag=false 여야 hit 발생)
 * 응답: { entries: [{ qa_id, ts, org_id?, item_number, item_name?, kind:'rag'|'forbidden',
 *                       hits?:[{example_id,score,score_bucket?,summary?}],
 *                       matches?:[{term?,rule_ref?,verdict?,quote?}] }, ...] }
 * → entries 배열만 반환(없으면 빈 배열).
 */
export async function fetchRagLogRecent({ limit = 100, qa_id, within_minutes } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (qa_id) params.set('qa_id', String(qa_id));
    if (within_minutes) params.set('within_minutes', String(within_minutes));
    const qs = params.toString();
    const data = await request(`/api/rag-log/recent${qs ? `?${qs}` : ''}`);
    return Array.isArray(data?.entries) ? data.entries : [];
}

// 루브릭 few-shot 항목 토글 설정 — { "<org_id>": { rubric_id, item_names:[...] } }
export async function fetchRagFewshotConfig() {
    const data = await request('/api/rag-fewshot-config');
    return data?.config && typeof data.config === 'object' ? data.config : {};
}

export async function saveRagFewshotConfig(config) {
    const data = await request('/api/rag-fewshot-config', {
        method: 'PUT',
        body: JSON.stringify({ config: config || {} }),
    });
    return data?.config && typeof data.config === 'object' ? data.config : {};
}

/* ── LLM 스킬 학습(검수 정정 기반 평가 룰 overlay) ───────────────
 * 검수자가 '낮음'/'높음' 정정 판단을 내린 케이스로 브랜드(rubric_id)별·평가항목별
 * 보완 룰(overlay md)을 LLM 으로 학습 — qa-pipeline mtg-skill API 를 서버가 프록시.
 * run/status 체인은 골든셋 학습(runGoldenLearn/fetchGoldenLearnStatus)과 동형 미러.
 */
// 스킬 학습 수동 트리거(백그라운드 실행) — 즉시 { ok, started, org_id } 반환. 진행/결과는 status 폴링.
export async function runSkillLearn() {
    return request('/api/skill-learn/run', { method: 'POST' });
}
// 스킬 학습 잡 상태 — { state:'running'|'done'|'error'|'idle', result:{ ok, rubric_id, version_id, case_count, items_changed, activated, error? } }.
export async function fetchSkillLearnStatus() {
    return request('/api/skill-learn/status');
}
// 스킬 버전 목록(최신순) — { ok, rubric_id, active_version_id, excluded_items:[int],
//   versions:[{ version_id, label, created_at, model_id, case_count, items_changed:[int], item_count, source }] }.
export async function fetchSkillVersions() {
    return request('/api/skill-learn/versions');
}
// 스킬 버전 상세("어떻게 생성했는지" 화면 데이터 소스) — { ok, rubric_id, version_id, label, created_at, model_id,
//   parent_version_id, case_count, active, items:[{ item_number, item_name, changed, overlay_md, cases:[...] }] }.
export async function fetchSkillVersionDetail(versionId) {
    if (!versionId) throw new Error('versionId is required');
    return request(`/api/skill-learn/versions/${encodeURIComponent(versionId)}`);
}
// 스킬 버전 활성화/롤백 — version_id=null 이면 전체 비활성화(스킬 끄기). 응답 { ok, rubric_id, active_version_id }.
export async function activateSkillVersion(versionId) {
    return request('/api/skill-learn/activate', {
        method: 'POST',
        body: JSON.stringify({ version_id: versionId ?? null }),
    });
}
/* ── LLM 스킬 학습 로그(서버 인메모리 링버퍼) ─────────────────────
 * 엔트리: { ts, org_id, source, stage:'collect'|'generate'|'activate'|'done'|'error',
 *          message, rubric_id?, version_id?, case_count?, items_changed?, error? }
 * → entries 배열만 반환(없으면 빈 배열) — fetchRagLogRecent 미러(호출부 재언랩 금지).
 */
export async function fetchSkillLogRecent({ limit = 100 } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const data = await request(`/api/skill-log/recent${qs ? `?${qs}` : ''}`);
    return Array.isArray(data?.entries) ? data.entries : [];
}

/**
 * 에이전트 메모리(qa_skill_memory) 항목별 요약 — 실시간 로그 '메모리' 행 토글 상세.
 * { ok, rubric_id, updated_at, items: [{ item_number, item_name, case_count, dir_high, dir_low,
 *   contested, cases[], patterns[], journal[], last_learned, effect }] }
 */
export async function fetchSkillMemory({ orgId } = {}) {
    const params = new URLSearchParams();
    if (orgId != null) params.set('org_id', String(orgId));
    const qs = params.toString();
    return request(`/api/skill-memory${qs ? `?${qs}` : ''}`);
}

/* ── 알림(수신자별 영구 알림) ───────────────────────────────────
 * 검수 워크플로우 이벤트(최종승인·수정반영)를 수신자(상담사) 단위로 영구 저장/조회.
 * 본인에게 온 알림만 반환(세션 스코프). scope: 'all'(기본) | 'current'(안읽음만).
 * 응답: [{ id, type, title, body, resource_type, resource_id, actor_name, read, created_at }, ...]
 */
export async function fetchNotifications(scope = 'all') {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    return request(`/api/notifications${qs}`);
}

/** 안읽음 알림 개수. 응답: { count }. */
export async function fetchUnreadCount() {
    return request('/api/notifications/unread-count');
}

/** 알림 1건 읽음 처리. */
export async function markNotificationRead(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

/** 내 알림 전체 읽음 처리. */
export async function markAllNotificationsRead() {
    return request('/api/notifications/read', { method: 'POST' });
}

/** 알림 1건 삭제. */
export async function deleteNotification(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 내 알림 전체 삭제. */
export async function deleteAllNotifications() {
    return request('/api/notifications', { method: 'DELETE' });
}

/** 알림 수신 선호 조회. 응답: { prefs: { "<type>": false, ... } } — 미기재 유형은 수신(on). */
export async function fetchNotificationPrefs() {
    return request('/api/notifications/prefs');
}

/** 알림 수신 선호 저장. prefs: { "<type>": bool } (끈 유형만 false 로 두면 됨). */
export async function updateNotificationPrefs(prefs) {
    return request('/api/notifications/prefs', {
        method: 'PUT',
        body: JSON.stringify({ prefs: prefs || {} }),
    });
}

/* ── qa-pipeline 적재 어댑터 ─────────────────────────────────
 * 서버가 qa-pipeline POST /evaluate 를 직접 호출 → 평가 결과를 DB 에 적재.
 * track='standard'(기본): 표준 18항목 1:1 적재 (코오롱 등 표준 8카테고리 브랜드).
 * call.transcript 는 STT 원문 문자열(파이프라인 전달용), call.conversation 은 대화 탭 적재용 턴 배열.
 * 평가가 콜당 수 분 걸릴 수 있어 호출 측에서 장시간 busy 처리 필요.
 * 응답: { ok, ingested, failed: [{qa_id, reason}], details: [{qa_id, ai_score, total_score, elapsed_sec, warnings,
 *         raw_total, max_total, kms_present}] }. raw_total/max_total/kms_present 는 standard 트랙 부가 필드(collection 트랙 부재). */
export async function ingestFromQaPipeline(calls, { track = 'standard' } = {}) {
    return request('/api/ingest/from-qa-pipeline', {
        method: 'POST',
        body: JSON.stringify({ track, calls: Array.isArray(calls) ? calls : [calls] }),
    });
}

/**
 * qa-pipeline 평가 비동기 잡 시작 — 즉시 { ok, job_id } 반환.
 * 서버가 /evaluate/stream(SSE)을 소비하며 노드 진행상황을 보관, fetchQaPipelineJob 으로 폴링.
 */
export async function startQaPipelineJob(call, { track = 'standard' } = {}) {
    return request('/api/ingest/qa-pipeline-jobs', {
        method: 'POST',
        body: JSON.stringify({ track, call }),
    });
}

/** 잡 상태 조회 — { ok, job: { status:'running'|'done'|'error', progress:{nodes_done,running_nodes,recent_done}, result, error } } */
export async function fetchQaPipelineJob(jobId) {
    return request(`/api/ingest/qa-pipeline-jobs/${encodeURIComponent(jobId)}`);
}

/** 활성 브랜드 org_id 해석 — super_admin 은 활성 브랜드 선택값, admin 은 본인 org_id. 없으면 null. */
export function currentOrgId() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        const u = raw ? JSON.parse(raw) : {};
        if (u.role === 'super_admin') {
            const active = window.localStorage.getItem(QA_ACTIVE_BRAND_KEY);
            const n = Number(active);
            if (Number.isFinite(n) && n > 0) return n;
        }
        const own = Number(u.org_id);
        return Number.isFinite(own) && own > 0 ? own : null;
    } catch {
        return null;
    }
}

/* SAMPLE_UPLOAD_FEATURE — 임시 기능. 제거 시 아래 두 함수와 SampleUploadModal 컴포넌트 삭제 */
export async function ingestSample(input, output) {
    return request('/api/sample-ingest', {
        method: 'POST',
        body: JSON.stringify({ input, output }),
    });
}

export async function clearSamples() {
    return request('/api/sample-ingest', { method: 'DELETE' });
}
