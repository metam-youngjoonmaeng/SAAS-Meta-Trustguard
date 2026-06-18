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
        const message = text || `Request failed: ${res.status}`;
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

export async function fetchCalls() {
    return request('/api/calls');
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

// 관리자 — 코칭 배정 생성. body: { title, targetType, channel, members, items, scenarios }.
export async function createCoaching(payload) {
    return request('/api/coaching', { method: 'POST', body: JSON.stringify(payload || {}) });
}

// 관리자 — 코칭 배정 삭제.
export async function deleteCoaching(id) {
    if (id == null) throw new Error('id is required');
    return request(`/api/coaching/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// 관리자 — 코칭 이력(상담사별). 코칭배정 × 멤버 + 배정 전/후 평균점수.
export async function fetchCoachingHistory() {
    return request('/api/coaching/history');
}

// 내 TA 지표(부정발화·회복률·금칙어) — 03(Meta_Summary) tb_ta_rslt 를 본인 콜(uid) 기준 집계.
// 응답: { enabled, total, negative_count/rate, banned_count/rate, recovery_denom/count/rate }.
// enabled=false 면 TA DB 미연동(프론트는 mock 폴백).
export async function fetchMyTaMetrics() {
    return request('/api/me/ta-metrics');
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

/** 검수상태 변경 (pending / in_review / completed). */
export async function updateReviewStatus(qaId, reviewStatus) {
    if (!qaId) throw new Error('qaId is required');
    return request(`/api/calls/${encodeURIComponent(qaId)}/review-status`, {
        method: 'PUT',
        body: JSON.stringify({ review_status: reviewStatus }),
    });
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

/* ── 본인 프로필 (셀프-편집) ───────────────────────────────────
 * 신규 사용자는 초기 비밀번호 발급 + must_change_password=true 로 시작.
 * 본인은 다음만 변경 가능: display_name, password, profile_image.
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

/** 프로필 이미지 업로드 — multipart/form-data ('avatar' 필드).
 *  서버는 jpg/png/webp 2MB 이하만 수용. 응답: { ok, profile_image_url } */
export async function uploadAvatar(file) {
    if (!(file instanceof File)) throw new Error('file is required');
    const form = new FormData();
    form.append('avatar', file);
    const headers = { ...actorRequestHeaders() };
    delete headers['Content-Type']; // multipart boundary 는 브라우저가 자동 설정
    const res = await fetch('/api/me/avatar', {
        method: 'POST',
        headers,
        body: form,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = text || `Request failed: ${res.status}`;
        try {
            const j = JSON.parse(text);
            if (j?.message) msg = j.message;
        } catch { /* ignore */ }
        throw new Error(msg);
    }
    return res.json();
}

export async function removeAvatar() {
    return request('/api/me/avatar', { method: 'DELETE' });
}

/** localStorage 에 저장된 actor 캐시를 서버 최신 상태로 갱신.
 *  ProfileModal 저장 후 호출해 Nav 헤더가 즉시 새 이름/사진을 반영하도록 한다. */
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
