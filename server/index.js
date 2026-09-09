import crypto from 'crypto';
import zlib from 'zlib';
import express from 'express';
import pg from 'pg';
import { maxPointsOf, parseStoredEarned } from './rubricManual.mjs';
import { pruneOldAuditLogs } from './auditLog.mjs';
import { logger, requestLogger } from './logger.mjs';
import { ingestStandardCallFromQaPipeline } from './qaPipelineIngest.mjs';
import { startIcsQaPoller, startGoldenLearnScheduler, startSkillLearnScheduler } from './icsQaPoller.mjs';
import { startMqttListener } from './mqttListener.mjs';
import { createBrandRouter } from './brandRoutes.mjs';
import { createUserProfileRouter } from './userProfile.mjs';
import { createIcsSsoRouter } from './icsSso.mjs';
import { createNotificationRouter } from './notificationRoutes.mjs';
import { SANDBOX_LOGIN_ID } from './sandboxSession.mjs';
import { createSvcRoutes } from './routes/svc.mjs';
import { createAuthRoutes } from './routes/auth.mjs';
import { createCoachingRoutes } from './routes/coaching.mjs';
import { createCallRoutes } from './routes/calls.mjs';
import { createGoldenRoutes } from './routes/golden.mjs';
import { createEvalItemRoutes } from './routes/evalItems.mjs';
import { createKmsRoutes } from './routes/kms.mjs';
import { createRagLlmRoutes } from './routes/ragLlm.mjs';
import { createIngestRoutes } from './routes/ingest.mjs';
import { createTaRoutes } from './routes/ta.mjs';
import { createBatchRoutes } from './routes/batch.mjs';
import { round1 } from './util/common.mjs';

const { Pool } = pg;



function clamp0to100(value) {
    return Math.max(0, Math.min(100, value));
}

/* ── [RAG·사전 로그, additive] 백엔드 RAG few-shot hit / 금지어·사전 매칭 인메모리 링버퍼 ──
 * DB 미적재(스키마 불변). 평가 잡 onProgress(type==='rag_hits') 와 평가 결과
 * extractForbiddenFromResult(resp) 가 여기에 push. GET /api/rag-log/recent 가 최신순 반환.
 * 레코드 계약:
 *   { qa_id, ts, org_id?, item_number, item_name?, kind:'rag'|'forbidden',
 *     hits?:[{example_id,score,score_bucket?,summary?}],            // kind==='rag'
 *     matches?:[{term?,rule_ref?,verdict?,quote?}] }                // kind==='forbidden'
 * 상한 500(초과분 shift). 외부(평가 잡)에서 pushRagLog(entry) 로 적재. */
const RAG_LOG = [];
const RAG_LOG_MAX = 500;

/* ── [LLM 스킬 로그, additive] 스킬 학습 체인(수집→생성→활성화) 인메모리 링버퍼 — RAG_LOG 미러 ──
 * DB 미적재(스키마 불변). 레코드 계약:
 *   { ts, org_id, source, stage, message,
 *     rubric_id?, version_id?, case_count?, items_changed?, error? }
 *   stage ∈ collect|generate|memory|activate|done|error · org_id 필수(로그 탭 브랜드 필터용).
 *   memory = 에이전트 메모리(qa_skill_store) 로드/저장/미반환(legacy_mode 카나리) 이벤트.
 * 상한 500(초과분 shift). GET /api/skill-log/recent 가 최신순 반환. */
const SKILL_LOG = [];
const SKILL_LOG_MAX = 500;
function pushSkillLog(entry) {
    if (!entry || typeof entry !== 'object') return;
    SKILL_LOG.push({ ts: Date.now(), ...entry });
    if (SKILL_LOG.length > SKILL_LOG_MAX) SKILL_LOG.shift();
    // 서버 로그(실시간 로그 > 서버 로그 App 탭)에도 한 줄 — 전용 탭 없이 스킬 학습 단계 관측.
    try {
        const tag = `[스킬${entry.stage ? `:${entry.stage}` : ''}] org=${entry.org_id ?? '?'}${entry.source ? ` (${entry.source})` : ''}`;
        const msg = `${tag} ${entry.message || ''}`.trimEnd();
        if (entry.stage === 'error' || entry.error) logger.warn(`${msg}${entry.error ? ` — ${entry.error}` : ''}`);
        else logger.info(msg);
    } catch { /* 로그 실패는 무시 */ }
}

function orderNoPct(orderNos, rows) {
    const wanted = new Set((orderNos || []).map((n) => Number(n)));
    const filtered = (rows || []).filter((r) => wanted.has(Number(r.order_no)));
    if (!filtered.length) return 0;
    let totalMax = 0;
    let totalEarned = 0;
    for (const row of filtered) {
        const maxPts = maxPointsOf(row);
        if (maxPts === null) continue;   // 만점 없음 = 분모 제외 (구 모델의 체크리스트 행 부재)
        totalMax += maxPts;
        totalEarned += parseStoredEarned(row.result, maxPts, row.item) ?? 0;
    }
    if (totalMax <= 0) return 0;
    return round1((100 * totalEarned) / totalMax);
}


// 한화손해보험(고객센터) 8 항목 → 5축 매핑. 원본: 02-hanwha-QA_Dashboard/server/index.js
const HANWHA_RADAR_KEYS = ['intro_quality', 'product_clarity', 'compliance', 'communication', 'speech_stability'];

// 기본 평가체계(지역정보개발원 등 BRAND_CONFIG 미등록 브랜드) 18 항목 → 5축 매핑.
// 원본: 01-QA_Dashboard/server/index.js buildPentagonFromChecklistRows.
// 5축 키/라벨은 한화와 동일(intro_quality/product_clarity/compliance/communication/speech_stability).
const DEFAULT_RADAR_KEYS = HANWHA_RADAR_KEYS;
function defaultCategoryPct(cat, rows) {
    const filtered = (rows || []).filter((r) => String(r.category || '').trim() === cat);
    if (!filtered.length) return 0;
    let totalMax = 0;
    let totalEarned = 0;
    for (const row of filtered) {
        const maxPts = maxPointsOf(row);
        if (maxPts === null) continue;   // 만점 없음 = 분모 제외 (구 모델의 체크리스트 행 부재)
        totalMax += maxPts;
        totalEarned += parseStoredEarned(row.result, maxPts, row.item) ?? 0;
    }
    if (totalMax <= 0) return 0;
    return round1((100 * totalEarned) / totalMax);
}



// 표준 Pentagon 5축 SSOT (QA 미팅 2026-06 결정 — 업종 무관 통일).
// 신규/동적 브랜드(org_id>=4)의 정의-축 폴백 + 프론트 DEFAULT_RADAR_LABELS 와 동일하게 유지할 것.
// 운영자가 eval_item_defs.pentagon_axis 로 항목을 이 5축에 배치한다. (레거시 한화/신한 빌더는 불변)
const CANONICAL_PENTAGON_AXES = [
    '응대·표현',
    '니즈파악·경청',
    '설명·전달력',
    '정확성·해결력',
    '컴플라이언스',
];
// 축 라벨 정규화 — 공백/구두점 차이를 흡수해 DB 값을 정본 라벨에 매칭("발화안정성"→"발화 안정성",
// "준수 고지 품질"→"준수·고지 품질"). 모든 공백 제거 + 중점(·)/가운뎃점류 통일 후 소문자.
function normalizeAxisLabel(value) {
    return String(value ?? '')
        .replace(/[\s·•・·]/g, '') // 공백 + 중점류 전부 제거
        .toLowerCase();
}

// Pentagon 다이어그램 — 코오롱 방식(축 고정 + 항목 자동 합산)을 전 브랜드에 동일 적용.
//   축 집합(definedAxes) = 운영자가 프론트(pentagon_axes 테이블, AxisModal CRUD)에서 정의한 축.
//   비어 있으면 정본 5축(한화 라벨: 오프닝/설명/준수/대화/발화)으로 폴백.
//   ★평가항목이 늘어나도 축 개수 불변 — 축은 definedAxes 로 고정, 항목은 그 축에 합산될 뿐.
//   ★프론트에서 축 추가/변경/삭제하면 definedAxes 가 바뀌어 다이어그램에 즉시 반영(연동).
// 축 라벨 정규화(canonicalizeAxis): DB 값의 공백/중점 차이를 정의 라벨에 매칭("발화안정성"→"발화 안정성").
//   항목의 pentagon_axis 가 정의된 축에 매칭되면 그 축에 합산, 매칭 안 되거나 미지정이면 어느 축에도 안 붙음
//   (category 폴백 없음 — 잡탕 N축 회피). 미평가/미매핑 축은 0 으로 항상 표시(축 증발 방지).
// 반환 shape 은 다른 builder 와 동일({team_avg, agent_score, overall_avg}: {축명: 백분율}) — FE 어댑터 불필요.
function buildPentagonByAxisDefs(checklistRows, axisByOrderNo, definedAxes) {
    const rows = Array.isArray(checklistRows) ? checklistRows : [];
    // 축 집합 = 운영자 정의 축(프론트 편집) > 정본 5축 폴백. 중복/빈값 제거 후 순서 보존.
    const axisSource =
        Array.isArray(definedAxes) && definedAxes.some((a) => String(a ?? '').trim())
            ? definedAxes
            : CANONICAL_PENTAGON_AXES;
    const keyOrder = [];
    const seen = new Set();
    for (const a of axisSource) {
        const label = String(a ?? '').trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        keyOrder.push(label);
    }
    const orderNosByKey = new Map(keyOrder.map((label) => [label, new Set()]));
    // 정의된 축 라벨의 정규화 키 → 정의 라벨 역참조(항목 axis 값을 정의 축에 매칭).
    const definedByNorm = new Map(keyOrder.map((label) => [normalizeAxisLabel(label), label]));
    // 항목 axis 값을 정의된 축 중 하나로 매칭(정규화 흡수). 매칭 안 되면 null → 무시.
    const toDefinedOrNull = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        return definedByNorm.get(normalizeAxisLabel(raw)) || null;
    };
    // 체크리스트 행을 정의된 축에 귀속. 미매핑/미지정 행은 어느 축에도 안 붙음(폴백 OFF).
    for (const r of rows) {
        const orderNo = Number(r?.order_no);
        const axis = axisByOrderNo ? toDefinedOrNull(axisByOrderNo[orderNo]) : null;
        if (!axis) continue;
        orderNosByKey.get(axis).add(orderNo);
    }
    const agent = {};
    for (const key of keyOrder) {
        // 행이 없는 축(미지정/미평가)은 orderNoPct 가 0 반환 → 0 표시(증발 방지).
        agent[key] = clamp0to100(orderNoPct([...orderNosByKey.get(key)], rows));
    }
    const teamAvg = {};
    const overallAvg = {};
    for (const key of keyOrder) {
        const base = agent[key] || 0;
        teamAvg[key] = clamp0to100(round1(base + Math.min(12, 100 - base)));
        overallAvg[key] = clamp0to100(round1(base + Math.min(18, 100 - base)));
    }
    return { team_avg: teamAvg, agent_score: agent, overall_avg: overallAvg };
}





const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('[qa-api] DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

// 통합DB(00-Meta-Unified) 컷오버: 스키마 분리(trustguard/common) → search_path 로 미한정 테이블명 해석.
// timezone=Asia/Seoul: cdate 는 timestamptz(절대 시각)이므로 저장값은 그대로고, 세션 TZ 로 해석되는
// 날짜 경계 SQL(`cdate::date` 기간필터·일별 그룹핑, `to_char(cdate,'YYYY-MM')` 월 평균, `cdate::text`)이
// UTC 대신 KST 기준이 된다. 이전에는 KST 00~09시 콜이 전날/전월로 집계됐다(로컬 3,732건 중 556건).
const pool = new Pool({
    connectionString: databaseUrl,
    options: '-c search_path=trustguard,common,public -c timezone=Asia/Seoul',
});


// 메모리 기반 세션 — 프로세스 재기동 시 전 사용자 재로그인. PoC 규모에선 충분.
const sessionStore = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/ics-sso', '/api/svc/eval-items', '/api/svc/deep-eval', '/api/svc/brand-qa-scores']);

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessionStore.set(token, {
        user_id: user.user_id,
        login_id: user.login_id,
        display_name: user.display_name,
        role: user.role,
        // 통합DB: 활성 브랜드 = tenant_id(citext, =proj_cd, 구 org_id) · 활성 멤버십 = membership_id(구 trainee_id)
        tenant_id: user.tenant_id ?? null,
        membership_id: user.membership_id ?? null,
        expires_at: Date.now() + SESSION_TTL_MS,
    });
    return token;
}

function lookupSession(token) {
    if (!token) return null;
    const session = sessionStore.get(token);
    if (!session) return null;
    if (Date.now() > session.expires_at) {
        sessionStore.delete(token);
        return null;
    }
    return session;
}


setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessionStore) {
        if (now > session.expires_at) sessionStore.delete(token);
    }
}, 10 * 60 * 1000).unref();

// 3일 초과 audit 로그 정리 (AI-Tutor backend/main.py 의 loguru retention="3 days" 와 동일 정책)
pruneOldAuditLogs(pool);
setInterval(() => pruneOldAuditLogs(pool), 6 * 60 * 60 * 1000).unref();

const app = express();
app.use(express.json({ limit: '2mb' }));

// JSON 응답 gzip (2026-09-02) — API 가 압축 없이 나가 `/api/calls` 253KB · `/api/admin/eval-items` 59KB 가
// 원격(한국↔us-east-1 RTT 200ms)에서 TCP 슬로스타트로 1초+ 걸렸다(로컬은 0.05초라 안 보임). 외부 의존성 없이
// zlib 로 `res.json` 만 감싼다 — SSE·`res.write` 스트리밍 경로는 res.json 을 안 쓰므로 영향 없음.
// 1KB 미만은 그대로(압축 이득 없음). `Vary: Accept-Encoding` 은 크기 무관 항상 붙임(캐시 정합 + 배포 확인용 지문).
// ★ 기본 OFF (같은 날 정정) — 브라우저는 항상 Next 대시보드(:3026) 의 rewrites 프록시를 거치는데, Next 15 프록시가
//   업스트림의 `Content-Encoding` 헤더를 떼고 **압축 바이트만** 그대로 넘겨 브라우저 JSON 파싱이 깨졌다(평가 리스트 빈 화면).
//   Next 는 `compress`(기본 true) 로 프록시 응답을 **스스로 gzip/deflate** 하므로 브라우저 경로 압축은 이미 Next 가 담당한다.
//   이 미들웨어는 API 를 직접 호출하는 스크립트/외부 클라이언트용 — 필요할 때만 `QA_API_GZIP=on`.
const GZIP_MIN_BYTES = 1024;
const API_GZIP_ENABLED = /^(1|on|true|yes)$/i.test(String(process.env.QA_API_GZIP || ''));
app.use((req, res, next) => {
    res.setHeader('Vary', 'Accept-Encoding');
    if (!API_GZIP_ENABLED) return next();
    if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
    const origJson = res.json.bind(res);
    res.json = (body) => {
        let text;
        try { text = JSON.stringify(body); } catch { return origJson(body); }
        if (typeof text !== 'string' || res.headersSent) return origJson(body);
        const buf = Buffer.from(text, 'utf8');
        if (buf.length < GZIP_MIN_BYTES) return origJson(body);
        zlib.gzip(buf, { level: 6 }, (err, gz) => {
            if (err || res.headersSent) { if (!res.headersSent) origJson(body); return; }
            if (!res.get('Content-Type')) res.type('application/json; charset=utf-8');
            res.setHeader('Content-Encoding', 'gzip');
            res.removeHeader('Content-Length');
            res.send(gz); // Buffer → Content-Length·ETag 는 express 가 gzip 바이트 기준으로 계산(304 정상 동작)
        });
        return res;
    };
    next();
});
// HTTP 요청 로깅 — 인증/세션 검증 이전이라 actor 가 항상 잡히진 않지만, 401/403 도 기록.
app.use(requestLogger());

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    const token = String(req.headers['x-session-token'] || '').trim();
    const session = lookupSession(token);
    if (!session) {
        res.status(401).json({ message: 'authentication required' });
        return;
    }
    req.session = session;
    next();
});

// 운영 ingest 엔드포인트는 sandbox 계정(test1) 차단 — sandbox 정리 시 휘발되면 안 되는 운영 데이터를 막는다.
const SANDBOX_FORBIDDEN_PATH_PREFIXES = ['/api/ingest/'];
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (!req.session) return next();
    if (req.session.login_id !== SANDBOX_LOGIN_ID) return next();
    const blocked = SANDBOX_FORBIDDEN_PATH_PREFIXES.some((p) => req.path.startsWith(p));
    if (blocked) {
        res.status(403).json({ message: 'sandbox account cannot write production data' });
        return;
    }
    next();
});

// 활성 브랜드 헤더(X-Active-Brand-Id) 실재 검증 — 없는 tenant_id 는 헤더를 지워 무효화한다.
//
// ★검증 없이 통과시키면: 그 값이 그대로 격리 키가 되어 조회는 조용히 0건, 저장만
//   tenant_id FK(common.tenants) 위반으로 거부된다 — "조회는 되는데 저장이 안 되는" 형태로
//   원인이 화면에 드러나지 않는다(03-Meta_Summary-TA 에서 실제로 터진 유형).
//   헤더를 지우면 resolveActiveOrgId 가 조회는 본인 브랜드로, 쓰기(strict)는 400 으로 처리한다
//   → 호출부 31곳을 건드리지 않고 한 곳에서 막는다.
//
// 유효 tenant_id 는 소량·저빈도 변경이라 60초 양성 캐시. 캐시에 없으면 DB 확인 후 등재하므로
// 새로 만든 브랜드가 잘못 거부되는 일은 없다(TTL 은 삭제된 브랜드가 남는 창만 제한).
const ACTIVE_BRAND_CACHE_MS = 60_000;
const _validTenantCache = new Map();   // tenant_id → 확인 시각(ms)

async function isKnownTenant(tenantId) {
    const hit = _validTenantCache.get(tenantId);
    if (hit && Date.now() - hit < ACTIVE_BRAND_CACHE_MS) return true;
    try {
        const { rows } = await pool.query('SELECT 1 FROM common.tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
        if (rows.length > 0) {
            _validTenantCache.set(tenantId, Date.now());
            return true;
        }
        _validTenantCache.delete(tenantId);
        return false;
    } catch (err) {
        // DB 일시 장애로 정상 브랜드를 거부해 화면을 망가뜨리는 쪽이 더 나쁘다 → 통과.
        console.warn('active-brand 검증 생략(DB 오류):', String(err?.message || err));
        return true;
    }
}

app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const raw = String(req.headers['x-active-brand-id'] || '').trim().toLowerCase();
    if (!raw || raw === 'all') return next();   // 미지정 / 전체 조회
    if (await isKnownTenant(raw)) return next();
    console.warn(
        `X-Active-Brand-Id '${raw}' 는 존재하지 않는 브랜드(tenant_id) — 헤더 무시. ` +
        '컷오버 전 숫자 org_id 가 클라이언트에 남아 있을 수 있다.'
    );
    delete req.headers['x-active-brand-id'];
    next();
});

const PORT = Number(process.env.API_PORT || 3007);

// 브랜드(=조직) / 도메인 CRUD
app.use('/api', createBrandRouter(pool));
// 본인 프로필 셀프-편집 (display_name / password). 프로필 이미지 기능은 폐지.
app.use('/api', createUserProfileRouter(pool));
// ICS SSO (ICS 어드민 메뉴 팝업 → ?userId 진입). createSession 주입 — 일반 로그인과 동일 세션 발급.
app.use('/api', createIcsSsoRouter(pool, { createSession }));

// 현재 요청의 활성 브랜드(org_id) 컨텍스트 결정.
// - super_admin: X-Active-Brand-Id 헤더(없으면 본인 org_id, 그것도 없으면 null=전체)
// - 그 외 (admin): 세션 org_id 고정 (header 무시 — 다른 브랜드 데이터 접근 차단)
function resolveActiveOrgId(req, { strict = false } = {}) {
    // 통합DB: 활성 브랜드 = tenant_id(citext, =proj_cd). 헤더 X-Active-Brand-Id 도 tenant_id 문자열.
    // (함수명은 호출부 31곳 호환 위해 유지 — 반환값이 int org_id → tenant_id 문자열로 전환됨.)
    if (!req.session) return null;
    if (req.session.role === 'super_admin') {
        const raw = String(req.headers['x-active-brand-id'] || '').trim();
        if (raw && raw.toLowerCase() !== 'all') return raw.toLowerCase();  // 특정 브랜드 = tenant_id
        if (raw.toLowerCase() === 'all') return null; // 전체 조회
        // strict(쓰기 라우트): 헤더 없으면 본인 홈 브랜드 자동 폴백 금지 → null → 핸들러 가드가 400.
        if (strict) return null;
        return req.session.tenant_id ?? null;
    }
    return req.session.tenant_id ?? null;
}


// 수신자별 알림 1건 생성(검수 워크플로우 이벤트 전달). 실패해도 본 동작은 막지 않음.
async function createNotification(db, n) {
    if (n?.recipientUserId == null) return;
    // 수신 선호 게이트 — 사용자가 설정>알림 설정에서 명시적으로 끈(false) 유형이면 발송 스킵(기본 on).
    // notification_prefs.prefs(JSONB): 키가 없으면 수신. 조회 실패 시에도 발송(안전 측 기본값).
    try {
        const { rows } = await db.query(
            `SELECT (prefs ->> $2) AS v FROM notification_prefs WHERE user_id = $1`,
            [n.recipientUserId, n.type]
        );
        if (rows[0]?.v === 'false') return;
    } catch (e) {
        console.error('notification pref check failed (기본 발송):', e?.message || e);
    }
    try {
        // 통합DB: org_id(int) → tenant_id(citext). 호출부는 tenant_id 문자열을 n.orgId 로 전달.
        await db.query(
            `INSERT INTO notifications
                (recipient_user_id, type, title, body, resource_type, resource_id, actor_user_id, actor_name, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                n.recipientUserId, n.type, n.title, n.body ?? null,
                n.resourceType ?? null, n.resourceId ?? null,
                n.actorUserId ?? null, n.actorName ?? null, n.orgId ?? null,
            ]
        );
    } catch (e) {
        console.error('createNotification error:', e);
    }
}


// 관리자(admin/super_admin) 전용 쓰기 게이트. 상담사 등은 403.
function requireAdmin(req, res, next) {
    if (req.session?.role === 'admin' || req.session?.role === 'super_admin') return next();
    res.status(403).json({ message: '관리자 권한이 필요합니다.' });
}

// ── 서비스 연동 (health · svc · realtime · ipcc) — server/routes/svc.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createSvcRoutes({ CANONICAL_PENTAGON_AXES, buildPentagonByAxisDefs, normalizeDepartment, pool }));


// ── 인증 · 세션 · 조직 전환 — server/routes/auth.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createAuthRoutes({ createSession, lookupSession, pool, sessionStore }));


// ── 콜 목록 · 상담사 · 통계 · 평가 상세/수정 · 검수 — server/routes/calls.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createCallRoutes({ DEFAULT_RADAR_KEYS, HANWHA_RADAR_KEYS, buildPentagonByAxisDefs, clamp0to100, createNotification, defaultCategoryPct, orderNoPct, pool, requireAdmin, resolveActiveOrgId, round1 }));


// ── 골든셋 · 스킬셋 지정 — server/routes/golden.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createGoldenRoutes({ pool, requireAdmin, resolveActiveOrgId }));


// ── 평가항목 정의 (criterion + prompt_template) + 버전 관리 ────────
// 항목 메타(category/item/order_no/만점/매핑)는 프론트 constants.js 가 SSOT.
// 본 API 는 (org_id, department, order_no, version) 키로 편집 가능한 필드를 영속한다.
// department 는 free-form text — 멀티 브랜드의 다양한 부서명을 그대로 받는다.
// 버전 관리 설계는 docs/EVALUATION_ITEMS.md "평가체계 버전 관리" 섹션 참조.
function normalizeDepartment(value) {
    if (typeof value !== 'string') return '기본';
    const trimmed = value.trim();
    return trimmed || '기본';
}

// ── 평가항목 · 버전 · 이력 · 펜타곤 축 · KSQI 카탈로그 — server/routes/evalItems.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createEvalItemRoutes({ normalizeDepartment, pool, requireAdmin, resolveActiveOrgId }));


// ── LLM 백엔드 조회 · RAG 벡터 백엔드 전환 · RAG 로그/few-shot 설정 — server/routes/ragLlm.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createRagLlmRoutes({ RAG_LOG, RAG_LOG_MAX, pool, requireAdmin }));


// ── KMS 업무 데이터 · 색인 — server/routes/kms.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createKmsRoutes({ pool, requireAdmin, resolveActiveOrgId }));


// ── 외부 적재 (AI Canvas · 컬렉션 콜 · QA 파이프라인 · 배치 job) — server/routes/ingest.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createIngestRoutes({ RAG_LOG, RAG_LOG_MAX, pool, pushSkillLog }));


async function bootstrap() {
    // 통합DB: 스키마는 00-Meta-Unified-DB init 이 소유(is_sandbox 는 trustguard.qa_evaluations 컬럼).
    //   구 `ALTER TABLE qa_calls ADD is_sandbox` 런타임 마이그레이션은 통합에선 불필요·유해 → 제거.
    // 운영 행이 0건이면 부팅을 시끄럽게 — 빈 DB 로 컨테이너만 살아 있는 사고를 콘솔에서 즉시 인지.
    try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM trustguard.qa_evaluations WHERE is_sandbox = false`);
        const prodCount = rows[0]?.n ?? 0;
        if (prodCount === 0) {
            console.warn('[qa-api] ⚠ qa_evaluations 의 운영 평가행(is_sandbox=false)이 0건입니다. 신규 볼륨/시드 미적용/대량 삭제 사고 가능성 확인 필요.');
        } else {
            console.log(`[qa-api] qa_evaluations production rows: ${prodCount}`);
        }
    } catch (err) {
        console.error('[qa-api] qa_evaluations production-row 카운트 점검 실패:', err);
    }
}

// ── 코칭 · 튜터 시나리오 · 상담사별 콜 — server/routes/coaching.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createCoachingRoutes({ createNotification, pool, requireAdmin, resolveActiveOrgId }));


// 알림(notifications) — 목록/읽음/삭제 + 수신 선호. 8 라우트를 notificationRoutes.mjs 로 분리.
// ★마운트 위치 = 원래 그 8 라우트가 등록돼 있던 자리. app.use 는 등록 순서대로 매칭되므로 위/아래로
//   옮기면 같은 접두어 라우트와의 상대 순서가 바뀐다. 지금은 /api/notifications* 가 이 블록에만
//   있어 실질 충돌이 없지만, 자리를 지켜 두면 이후 추가되는 라우트가 조용히 가려지지 않는다.
app.use('/api', createNotificationRouter(pool));


// ── 내 TA 지표 — server/routes/ta.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
app.use(createTaRoutes({ pool }));


// 골든셋 학습 비동기 잡 상태(인메모리, org 별 최신 1건). 47건 임베딩+색인이 수십 초 걸려
//   동기 응답 시 대시보드 프록시/브라우저가 타임아웃("Internal Server Error") → 백그라운드 실행 + status 폴링으로 회피.
const goldenLearnStatus = new Map(); // org_id -> { state:'running'|'done'|'error', source, started_at, finished_at, result, error }

// 골든셋 학습 완료/실패 → 알림 센터 통지. 수동(트리거한 관리자 actor 포함) + 해당 브랜드 관리자
// 전원에게 1건씩(user_id 중복 제거). 자동(스케줄러) 발화는 actor 없이 브랜드 관리자에게만.
// dry-run(프리뷰)은 통지 대상 아님 — 호출측에서 제외. 알림 실패는 학습에 영향 없음(삼킴).
async function notifyGoldenLearnComplete(orgId, result, { actorUserId = null, actorName = null, source = 'manual' } = {}) {
    try {
        const recipients = new Set();
        if (actorUserId != null) recipients.add(Number(actorUserId));
        try {
            // 통합DB: 수신자 = (1) super_admin 전원(크로스테넌트) + (2) 해당 브랜드(tenant) admin.
            //   권한·소속은 common.memberships(role/tenant_id/status), 활성 멤버십만.
            const { rows } = await pool.query(
                `SELECT DISTINCT m.user_id FROM common.memberships m
                  WHERE m.status = 'active'
                    AND m.role IN ('admin', 'super_admin')
                    AND (m.role = 'super_admin' OR m.tenant_id = $1)`,
                [orgId]
            );
            for (const r of rows) if (r.user_id != null) recipients.add(Number(r.user_id));
        } catch (e) {
            console.warn('notifyGoldenLearnComplete: 관리자 조회 실패:', e?.message || e);
        }
        if (!recipients.size) return;
        const ok = result?.ok !== false;
        const isSchedule = !!(source && source.startsWith('schedule'));
        // 골든셋 0건 — 학습할 대상 자체가 없음(ingestGoldenSetToRag reason='no_golden_rows').
        //   '학습 완료 · 색인 ?건' 오표기 대신 명시 문구로 통지. 스케줄러 발화는 매 주기
        //   같은 통지가 반복(스팸)되므로 통지 자체를 생략(수동 실행만 통지).
        const noGolden = ok && (result?.reason === 'no_golden_rows' || result?.golden_count === 0);
        const srcLabel = isSchedule ? '자동(스케줄러)' : '수동';
        if (noGolden && isSchedule) return;
        const savedN = Number(result?.saved || 0);
        const skippedN = Number(result?.skipped || 0);
        const failedN = Number(result?.failed || 0);
        const droppedN = Number(result?.invalid || 0) + Number(result?.filtered || 0);
        // ★ 0831 — 자동 발화 중 '바뀐 게 없는 실행'은 통지하지 않는다.
        //   색인(ingestGoldenSetToRag)이 skip_existing 멱등이라, 이미 색인된 골든셋은 매 발화 saved=0.
        //   게다가 스케줄 마커가 인메모리라 재기동마다 같은 버킷이 재발화 → 같은 문구가 관리자
        //   수 × 발화 수만큼 쌓였다(로컬 실측 158건, 전부 '골든 9건 · 색인 0건').
        //   신규 색인이 있거나 실패가 있을 때만 알린다. 수동 실행은 사용자가 결과를 기다리므로 항상 통지.
        if (isSchedule && ok && savedN === 0 && failedN === 0 && droppedN === 0) return;
        const goldenN = result?.golden_count ?? '?';
        const type = !ok ? 'golden_learn_failed' : noGolden ? 'golden_learn_skipped' : 'golden_learn_completed';
        const title = !ok ? '골든셋 학습 실패' : noGolden ? '골든셋 학습 건너뜀' : '골든셋 학습 완료';
        // 성공 본문 — '색인 N건'만 쓰면 멱등 스킵이 실패처럼 보인다. 신규/기존 유지를 분리 표기하고,
        //   제외(invalid+filtered)·실패는 0 이 아닐 때만 덧붙인다.
        const detail = [`골든 ${goldenN}건`, `신규 색인 ${savedN}건`, `기존 유지 ${skippedN}건`]
            .concat(droppedN > 0 ? [`제외 ${droppedN}건`] : [])
            .concat(failedN > 0 ? [`실패 ${failedN}건`] : [])
            .join(' · ');
        const body = !ok
            ? `${srcLabel} · ${result?.error || result?.reason || '오류'}`
            : noGolden
              ? `${srcLabel} · 학습할 골든셋이 없습니다 — 검수 확정으로 골든셋을 먼저 쌓아주세요`
              : `${srcLabel} · ${detail}${result?.dry_run ? ' (dry-run)' : ''}`;
        for (const uid of recipients) {
            await createNotification(pool, {
                recipientUserId: uid,
                type,
                title,
                body,
                resourceType: 'golden_learn',
                resourceId: String(orgId),
                actorUserId,
                actorName,
                orgId,
            });
        }
    } catch (e) {
        console.error('notifyGoldenLearnComplete error:', e?.message || e);
    }
}


// ───────────────────────────────────────────────────────────────────────────
// LLM 스킬 학습 (skillLearn) — 검수 정정('낮음'/'높음') 케이스 기반 항목별 보완 룰(overlay) 생성.
//   골든 학습(golden-learn) 체인 미러. 실행 상태는 인메모리(스키마 불변), 버전 저장·활성화는
//   qa-pipeline(/v2/mtg-skill/*) 담당 — MTG 는 수집·프록시·로그만.
// ───────────────────────────────────────────────────────────────────────────
const skillLearnStatus = new Map(); // org_id -> { state:'running'|'done'|'error', source, started_at, finished_at, result, error }

// 스킬 학습 결과 → 상태 Map + 스킬 로그 반영(수동/스케줄 공용).
function recordSkillLearnResult(orgId, source, result, startedAt = null) {
    const prev = skillLearnStatus.get(orgId) || {};
    const ok = result?.ok === true;
    // 무해 종료(정정 케이스 없음 · 무변경 생략) — 실패가 아닌 '생략' 의미론: state done + 로그 done.
    const benign = !ok && (result?.error === 'no_correction_cases' || result?.error === 'no_new_cases');
    skillLearnStatus.set(orgId, {
        state: ok || benign ? 'done' : 'error',
        source,
        started_at: startedAt ?? prev.started_at ?? null,
        finished_at: Date.now(),
        result,
        error: ok ? null : (result?.error || null),
    });
    if (benign) {
        pushSkillLog({
            org_id: orgId,
            source,
            stage: 'done',
            message: result?.error === 'no_new_cases'
                ? '변경 없음 — 마지막 학습과 동일한 정정 케이스, 학습 생략(LLM 미호출)'
                : '정정 케이스(낮음/높음) 없음 — 학습 생략',
            rubric_id: result?.rubric_id ?? null,
            case_count: result?.case_count ?? null,
        });
        return;
    }
    if (ok) {
        if (result.activated && result.version_id) {
            pushSkillLog({ org_id: orgId, source, stage: 'activate', message: `버전 활성화 — ${result.version_id}`, rubric_id: result.rubric_id, version_id: result.version_id });
        }
        pushSkillLog({
            org_id: orgId,
            source,
            stage: 'done',
            message: `스킬 학습 완료 — 버전 ${result.version_id ?? '-'} · 항목 ${(result.items_changed || []).length}개 갱신`,
            rubric_id: result.rubric_id ?? null,
            version_id: result.version_id ?? null,
            case_count: result.case_count ?? null,
            items_changed: result.items_changed || [],
        });
    } else {
        pushSkillLog({
            org_id: orgId,
            source,
            stage: 'error',
            message: `스킬 학습 실패 — ${result?.error || '미상'}`,
            rubric_id: result?.rubric_id ?? null,
            case_count: result?.case_count ?? null,
            error: result?.error || null,
        });
    }
}

// runSkillLearn onProgress → 스킬 로그 단계 전이 적재 + 상태 Map 실시간 단계 반영(수동/스케줄 공용).
//   status.stage / status.stage_message 를 갱신해 '지금 실행' 화면 폴링이 진행 단계를 표시.
//   collect 시작 로그는 호출측이 적재(중복 방지) — 여기선 상태 stage 만 갱신.
function skillLearnProgressLogger(orgId, source) {
    return (p) => {
        if (!p || typeof p !== 'object') return;
        const prev = skillLearnStatus.get(orgId) || {};
        if (p.stage === 'collect') {
            if (prev.state === 'running') {
                skillLearnStatus.set(orgId, { ...prev, stage: 'collect', stage_message: '검수 정정 케이스 수집 중…' });
            }
        } else if (p.stage === 'generate') {
            // 학습 대상 항목 breakdown(어떤 항목·정정 몇 건) → 진행 메시지에 노출.
            const items = Array.isArray(p.target_items) ? p.target_items : [];
            const names = items.map((t) => `${t.item_name} ${t.count}건`);
            const shown = names.slice(0, 5).join(', ');
            const more = names.length > 5 ? ` 외 ${names.length - 5}개` : '';
            const brief = items.length
                ? `${items.length}개 항목 (${shown}${more})`
                : `정정 케이스 ${p.case_count ?? '?'}건`;
            if (prev.state === 'running') {
                skillLearnStatus.set(orgId, {
                    ...prev,
                    stage: 'generate',
                    stage_message: `보완 룰 생성 중 — ${brief}`,
                    case_count: p.case_count ?? null,
                    target_items: items,
                    // 진행률 프록시 키 — status 라우트가 파이프라인 generating {done,total} 조회에 사용.
                    rubric_id: p.rubric_id ?? prev.rubric_id ?? null,
                });
            }
            pushSkillLog({ org_id: orgId, source, stage: 'generate', message: `overlay 생성 요청 — 정정 케이스 ${p.case_count ?? '?'}건${items.length ? ` · ${items.length}개 항목` : ''}`, case_count: p.case_count ?? null });
        } else if (p.stage === 'memory' && p.message) {
            // 에이전트 메모리(qa_skill_store) 로드/저장/미반환 — skillLearn 이 완성문 동봉, 그대로 적재.
            pushSkillLog({ org_id: orgId, source, stage: 'memory', message: p.message, rubric_id: p.rubric_id ?? null });
        }
    };
}

// ── 배치 설정 · 골든/스킬 학습 · 판정 프롬프트 · 재판정 — server/routes/batch.mjs 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.
//    (ctx 상수 skillLearnStatus 선언(6303줄) 뒤로 이동 — TDZ 회피)
app.use(createBatchRoutes({ SKILL_LOG, SKILL_LOG_MAX, goldenLearnStatus, notifyGoldenLearnComplete, pool, pushSkillLog, recordSkillLearnResult, requireAdmin, resolveActiveOrgId, skillLearnProgressLogger, skillLearnStatus }));


bootstrap()
    .then(() => {
        app.listen(PORT, () => {
            const msg1 = `listening on port ${PORT}`;
            const msg2 = `DATABASE_URL=${databaseUrl.replace(/:[^:@/]+@/, ':****@')}`;
            console.log(`[qa-api] ${msg1}`);
            console.log(`[qa-api] ${msg2}`);
            logger.info(msg1, { module: 'qa-api' });
            logger.info(msg2, { module: 'qa-api' });
            // ICS(mtm30) → 09 QA 폴러 기동. env-gated(ICS_DB_HOST 미설정 시 no-op).
            startIcsQaPoller(pool, { ingestStandardCallFromQaPipeline });
            // 골든셋 학습 스케줄러 — ICS 게이트와 무관하게 모든 배포에서 기동. 브랜드별 goldenFreq(hourly/daily)로 발화.
            //   훅으로 자동 발화를 goldenLearnStatus(수동과 동일 채널)에 반영 → 대시보드 폴링이 실시간 진행바로 표시.
            //   완료 시 알림 센터 통지(브랜드 관리자). 훅 예외는 학습에 영향 없음.
            startGoldenLearnScheduler(pool, {
                onRunStart: (orgId) => {
                    goldenLearnStatus.set(orgId, {
                        state: 'running',
                        source: 'schedule',
                        started_at: Date.now(),
                        golden_count: null,
                        progress: { processed: 0, total: null, saved: 0, skipped: 0, failed: 0 },
                    });
                },
                onProgress: (orgId, p) => {
                    const prev = goldenLearnStatus.get(orgId) || {};
                    if (prev.state !== 'running') return; // 완료/에러 후 늦은 콜백 무시
                    goldenLearnStatus.set(orgId, { ...prev, progress: p, golden_count: prev.golden_count ?? p?.total ?? null });
                },
                onRunDone: (orgId, result) => {
                    goldenLearnStatus.set(orgId, {
                        state: 'done',
                        source: 'schedule',
                        finished_at: Date.now(),
                        golden_count: result?.golden_count ?? null,
                        result,
                    });
                    notifyGoldenLearnComplete(orgId, result, { source: 'schedule' }).catch(() => {});
                },
            });
            // LLM 스킬 학습 스케줄러 — 골든 스케줄러 미러(브랜드별 skillFreq hourly/daily 발화).
            //   자동 발화도 skillLearnStatus(수동과 동일 채널) + 스킬 로그(SKILL_LOG)에 반영.
            startSkillLearnScheduler(pool, {
                onRunStart: (orgId) => {
                    skillLearnStatus.set(orgId, { state: 'running', source: 'schedule', started_at: Date.now(), stage: 'collect', stage_message: '검수 정정 케이스 수집 중…' });
                    pushSkillLog({ org_id: orgId, source: 'schedule', stage: 'collect', message: '정기 스킬 학습 시작 — 검수 정정 케이스 수집' });
                },
                onProgress: (orgId, p) => skillLearnProgressLogger(orgId, 'schedule')(p),
                onRunDone: (orgId, result) => recordSkillLearnResult(orgId, 'schedule', result),
            });
            // AICC MQTT 실시간 STT 스트림 — finish 시 그 콜 즉시 QA 적재(폴러 안전망 병행). MQTT_HOST 미설정 시 no-op.
            startMqttListener(pool, { ingestStandardCallFromQaPipeline });
        });
    })
    .catch((err) => {
        console.error('[qa-api] startup DB init failed:', err);
        logger.error(`startup DB init failed: ${err?.stack || err}`, { module: 'qa-api' });
        process.exit(1);
    });
