import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import pg from 'pg';
import {
    computeManualRubricPct,
    MANUAL_JUDGMENT_LABELS,
    mergeManualPatches,
    parseMaxPointsFromValidationTime,
    parseStoredEarned,
    validateMergedManualEvals,
} from './rubricManual.mjs';
import { AUDIT_ACTION, insertQaAuditLog, pruneOldAuditLogs } from './auditLog.mjs';
import { logger, requestLogger } from './logger.mjs';
import { buildChecklistYnKorFromDbRows, checklistKeysForDepartment, effectiveChecklistKeys } from './checklistCategorySummary.mjs';
/* SAMPLE_UPLOAD_FEATURE */ import { ingestSampleToDb, clearSamplesFromDb } from './sampleIngest.mjs';
import { ingestCollectionCallToDb } from './collectionCallIngest.mjs';
import { fetchAndIngestFromAiCanvas } from './aiCanvasIngest.mjs';
import { ingestCallFromQaPipeline, ingestStandardCallFromQaPipeline, evaluateStandardCall } from './qaPipelineIngest.mjs';
import { startIcsQaPoller } from './icsQaPoller.mjs';
import { startMqttListener, getActiveCalls } from './mqttListener.mjs';
import { callAnswerStats, ipccEnabled } from './xhubSource.mjs';
import { taEnabled, fetchTaMetricsByUids, fetchSegmentSentimentsByUids } from './taSource.mjs';
import {
    buildSystemPrompt, resolvePromptParts, judgeEnabled, judgeModel,
    DEFAULT_UNCERTAIN_DEF, DEFAULT_CONTRADICTION_DEF,
} from './geminiJudge.mjs';
import { runJudgeBackfill } from './judgeConfidence.mjs';
import { randomUUID } from 'node:crypto';
import { createBrandRouter } from './brandRoutes.mjs';
import { createUserProfileRouter } from './userProfile.mjs';
import { createIcsSsoRouter } from './icsSso.mjs';
import {
    SANDBOX_LOGIN_ID,
    beginSandboxSession,
    endSandboxSession,
} from './sandboxSession.mjs';

const { Pool } = pg;

// Pentagon 5축 — 컬렉션관리부 9 항목 매핑 (SSOT: docs/EVALUATION_ITEMS.md, Pentagon 5축 설계 절)
const RADAR_KEYS = ['greeting_verify', 'tone_language', 'empathy_listening', 'work_accuracy', 'aftercare'];
const RADAR_REPORT_ITEMS = [
    { item_type_no: 1, item_type: '인사·본인확인',    axis: 'greeting_verify',   orderNos: [1, 2, 3] },
    { item_type_no: 2, item_type: '응대 화법·음성',    axis: 'tone_language',     orderNos: [4, 5] },
    { item_type_no: 3, item_type: '경청·공감 응대',    axis: 'empathy_listening', orderNos: [6, 7] },
    { item_type_no: 4, item_type: '업무 정확도',       axis: 'work_accuracy',     orderNos: [8] },
    { item_type_no: 5, item_type: '사후 처리',         axis: 'aftercare',         orderNos: [9] },
];
const RADAR_AXIS_TO_ORDER_NOS = Object.fromEntries(
    RADAR_REPORT_ITEMS.map((r) => [r.axis, r.orderNos])
);

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function clamp0to100(value) {
    return Math.max(0, Math.min(100, value));
}

function orderNoPct(orderNos, rows) {
    const wanted = new Set((orderNos || []).map((n) => Number(n)));
    const filtered = (rows || []).filter((r) => wanted.has(Number(r.order_no)));
    if (!filtered.length) return 0;
    let totalMax = 0;
    let totalEarned = 0;
    for (const row of filtered) {
        const maxPts = parseMaxPointsFromValidationTime(row.validation_time);
        totalMax += maxPts;
        totalEarned += parseStoredEarned(row.result, maxPts, row.item) ?? 0;
    }
    if (totalMax <= 0) return 0;
    return round1((100 * totalEarned) / totalMax);
}

function buildPentagonFromChecklistRows(checklistRows) {
    if (!Array.isArray(checklistRows) || checklistRows.length === 0) {
        const empty = Object.fromEntries(RADAR_KEYS.map((k) => [k, 0]));
        return { team_avg: empty, agent_score: empty, overall_avg: empty };
    }
    // 컬렉션관리부 9 항목 → Pentagon 5축 매핑 (docs/EVALUATION_ITEMS.md, Pentagon 5축 설계 / 5축 정의 SSOT 절).
    // 각 축은 매핑된 order_no 항목들의 만점·획득점수 합으로 백분율 환산.
    const agent = {};
    for (const k of RADAR_KEYS) {
        agent[k] = clamp0to100(orderNoPct(RADAR_AXIS_TO_ORDER_NOS[k], checklistRows));
    }
    const teamAvg = {};
    const overallAvg = {};
    for (const k of RADAR_KEYS) {
        const base = agent[k] || 0;
        teamAvg[k] = clamp0to100(round1(base + Math.min(12, 100 - base)));
        overallAvg[k] = clamp0to100(round1(base + Math.min(18, 100 - base)));
    }
    return { team_avg: teamAvg, agent_score: agent, overall_avg: overallAvg };
}

// 한화손해보험(고객센터) 8 항목 → 5축 매핑. 원본: 02-hanwha-QA_Dashboard/server/index.js
const HANWHA_RADAR_KEYS = ['intro_quality', 'product_clarity', 'compliance', 'communication', 'speech_stability'];
const HANWHA_RADAR_REPORT_ITEMS = [
    { item_type_no: 1, item_type: '오프닝 및 목적 안내', axis: 'intro_quality' },
    { item_type_no: 2, item_type: '설명 명확성',         axis: 'product_clarity' },
    { item_type_no: 3, item_type: '준수·고지 품질',      axis: 'compliance' },
    { item_type_no: 4, item_type: '대화·경청 품질',      axis: 'communication' },
    { item_type_no: 5, item_type: '발화 안정성',         axis: 'speech_stability' },
];
function hanwhaCategoryPct(cat, rows) {
    const filtered = (rows || []).filter((r) => String(r.category || '').trim() === cat);
    if (!filtered.length) return 0;
    let totalMax = 0;
    let totalEarned = 0;
    for (const row of filtered) {
        const maxPts = parseMaxPointsFromValidationTime(row.validation_time);
        totalMax += maxPts;
        totalEarned += parseStoredEarned(row.result, maxPts, row.item) ?? 0;
    }
    if (totalMax <= 0) return 0;
    return round1((100 * totalEarned) / totalMax);
}
function buildHanwhaPentagonFromChecklistRows(checklistRows) {
    if (!Array.isArray(checklistRows) || checklistRows.length === 0) {
        const empty = Object.fromEntries(HANWHA_RADAR_KEYS.map((k) => [k, 0]));
        return { team_avg: empty, agent_score: empty, overall_avg: empty };
    }
    const agent = {
        intro_quality:
            (hanwhaCategoryPct('전화수신/종료태도', checklistRows) +
                hanwhaCategoryPct('첫인사', checklistRows) +
                hanwhaCategoryPct('끝인사', checklistRows)) / 3,
        product_clarity: hanwhaCategoryPct('문의내용 파악/경청', checklistRows),
        compliance:
            (hanwhaCategoryPct('정확한 업무처리', checklistRows) +
                hanwhaCategoryPct('정보보호', checklistRows)) / 2,
        communication: hanwhaCategoryPct('사과/대기/감사표현', checklistRows),
        speech_stability: hanwhaCategoryPct('상담태도', checklistRows),
    };
    for (const k of HANWHA_RADAR_KEYS) agent[k] = clamp0to100(round1(agent[k]));
    const teamAvg = {};
    const overallAvg = {};
    for (const k of HANWHA_RADAR_KEYS) {
        const base = agent[k] || 0;
        teamAvg[k] = clamp0to100(round1(base + Math.min(12, 100 - base)));
        overallAvg[k] = clamp0to100(round1(base + Math.min(18, 100 - base)));
    }
    return { team_avg: teamAvg, agent_score: agent, overall_avg: overallAvg };
}

// 기본 평가체계(지역정보개발원 등 BRAND_CONFIG 미등록 브랜드) 18 항목 → 5축 매핑.
// 원본: 01-QA_Dashboard/server/index.js buildPentagonFromChecklistRows.
// 5축 키/라벨은 한화와 동일(intro_quality/product_clarity/compliance/communication/speech_stability).
const DEFAULT_RADAR_KEYS = HANWHA_RADAR_KEYS;
const DEFAULT_RADAR_REPORT_ITEMS = HANWHA_RADAR_REPORT_ITEMS;
function defaultCategoryPct(cat, rows) {
    const filtered = (rows || []).filter((r) => String(r.category || '').trim() === cat);
    if (!filtered.length) return 0;
    let totalMax = 0;
    let totalEarned = 0;
    for (const row of filtered) {
        const maxPts = parseMaxPointsFromValidationTime(row.validation_time);
        totalMax += maxPts;
        totalEarned += parseStoredEarned(row.result, maxPts, row.item) ?? 0;
    }
    if (totalMax <= 0) return 0;
    return round1((100 * totalEarned) / totalMax);
}
function buildDefaultPentagonFromChecklistRows(checklistRows) {
    if (!Array.isArray(checklistRows) || checklistRows.length === 0) {
        const empty = Object.fromEntries(DEFAULT_RADAR_KEYS.map((k) => [k, 0]));
        return { team_avg: empty, agent_score: empty, overall_avg: empty };
    }
    // 8 카테고리 → 5축 매핑 (01-QA_Dashboard SSOT)
    const agent = {
        intro_quality: defaultCategoryPct('인사 예절', checklistRows),
        speech_stability: defaultCategoryPct('언어 표현', checklistRows),
        product_clarity: defaultCategoryPct('설명력 및 전달력', checklistRows),
        compliance:
            (defaultCategoryPct('업무 정확도', checklistRows) +
                defaultCategoryPct('개인정보 보호', checklistRows)) / 2,
        communication:
            (defaultCategoryPct('경청 및 소통', checklistRows) +
                defaultCategoryPct('니즈 파악', checklistRows) +
                defaultCategoryPct('적극성', checklistRows)) / 3,
    };
    for (const k of DEFAULT_RADAR_KEYS) agent[k] = clamp0to100(round1(agent[k]));
    const teamAvg = {};
    const overallAvg = {};
    for (const k of DEFAULT_RADAR_KEYS) {
        const base = agent[k] || 0;
        teamAvg[k] = clamp0to100(round1(base + Math.min(12, 100 - base)));
        overallAvg[k] = clamp0to100(round1(base + Math.min(18, 100 - base)));
    }
    return { team_avg: teamAvg, agent_score: agent, overall_avg: overallAvg };
}

// 기본(고객지원실) 코오롱 표준 8 카테고리 — 동적 루브릭 콜 판별용.
// 콜의 행 카테고리가 이 셋과 전혀 겹치지 않으면 동적 루브릭(이커머스/은행 등) 콜.
const DEFAULT_PENTAGON_CATEGORIES = new Set([
    '인사 예절', '경청 및 소통', '언어 표현', '니즈 파악',
    '설명력 및 전달력', '적극성', '업무 정확도', '개인정보 보호',
]);

// 동적 루브릭 콜: 행 자체 카테고리를 축으로 레이더 구성 (축 수 가변 — FE RadarChart 는 labels 기반).
// agent_score 키 = 카테고리명 그대로 — FE(useEffectiveBrandConfig)가 radarKeys 를 카테고리로 맞춘다.
function buildDynamicPentagonFromChecklistRows(checklistRows) {
    const cats = [];
    for (const r of checklistRows || []) {
        const c = String(r?.category || '').trim();
        if (c && !cats.includes(c)) cats.push(c);
    }
    if (!cats.length) {
        const empty = Object.fromEntries(DEFAULT_RADAR_KEYS.map((k) => [k, 0]));
        return { team_avg: empty, agent_score: empty, overall_avg: empty };
    }
    const agent = {};
    for (const c of cats) agent[c] = clamp0to100(round1(defaultCategoryPct(c, checklistRows)));
    const teamAvg = {};
    const overallAvg = {};
    for (const c of cats) {
        const base = agent[c] || 0;
        teamAvg[c] = clamp0to100(round1(base + Math.min(12, 100 - base)));
        overallAvg[c] = clamp0to100(round1(base + Math.min(18, 100 - base)));
    }
    return { team_avg: teamAvg, agent_score: agent, overall_avg: overallAvg };
}

function buildDynamicFallbackReportRows(pentagon, aiScore) {
    const agentScore = pentagon?.agent_score || {};
    const rows = Object.keys(agentScore).map((cat, i) => {
        const score = Number(agentScore[cat] || 0);
        return {
            item_type_no: i + 1,
            item_type: cat,
            rating: reportRatingFromScore(score),
            comment: `${reportCommentFromScore(score)} (지표 점수: ${round1(score)})`,
        };
    });
    rows.push({
        item_type_no: 99,
        item_type: 'summary',
        comment: reportSummaryFromAiScore(aiScore),
    });
    return rows;
}

function buildDefaultFallbackReportRows(pentagon, aiScore) {
    const agentScore = pentagon?.agent_score || {};
    const rows = DEFAULT_RADAR_REPORT_ITEMS.map((item) => {
        const score = Number(agentScore[item.axis] || 0);
        return {
            item_type_no: item.item_type_no,
            item_type: item.item_type,
            rating: reportRatingFromScore(score),
            comment: `${reportCommentFromScore(score)} (지표 점수: ${round1(score)})`,
        };
    });
    rows.push({
        item_type_no: 99,
        item_type: 'summary',
        comment: reportSummaryFromAiScore(aiScore),
    });
    return rows;
}

function buildHanwhaFallbackReportRows(pentagon, aiScore) {
    const agentScore = pentagon?.agent_score || {};
    const rows = HANWHA_RADAR_REPORT_ITEMS.map((item) => {
        const score = Number(agentScore[item.axis] || 0);
        return {
            item_type_no: item.item_type_no,
            item_type: item.item_type,
            rating: reportRatingFromScore(score),
            comment: `${reportCommentFromScore(score)} (지표 점수: ${round1(score)})`,
        };
    });
    rows.push({
        item_type_no: 99,
        item_type: 'summary',
        comment: reportSummaryFromAiScore(aiScore),
    });
    return rows;
}

function reportRatingFromScore(score) {
    if (score >= 90) return '우수';
    if (score >= 80) return '보통';
    if (score >= 70) return '주의';
    return '실패';
}

function reportCommentFromScore(score) {
    if (score >= 90) return '핵심 응대가 안정적으로 수행되어 품질 수준이 우수합니다.';
    if (score >= 80) return '기본 응대는 양호하나 일관성과 전달력을 조금 더 보완할 필요가 있습니다.';
    if (score >= 70) return '핵심 구간에서 누락 또는 불명확한 응대가 보여 개선이 필요합니다.';
    return '기준 대비 품질 편차가 커 우선 개선 대상입니다.';
}

function reportSummaryFromAiScore(aiScore) {
    const score = Number(aiScore);
    if (Number.isNaN(score)) return '전반적인 상담 품질 개선이 필요합니다.';
    if (score >= 90) return '전반적으로 우수한 상담 품질을 보이며, 현재 강점을 유지하는 것이 중요합니다.';
    if (score >= 80) return '기본 절차는 양호하며, 경청·공감 응대와 사후 처리 구간을 보완하면 더 안정적입니다.';
    if (score >= 70) return '인사·본인확인은 수행되었으나 경청·공감 응대와 업무 정확도 보강이 필요합니다.';
    return '인사·본인확인·경청·공감 응대·업무 정확도·사후 처리 전반에 걸쳐 우선 개선이 필요합니다.';
}

function buildFallbackReportRows(pentagon, aiScore) {
    const agentScore = pentagon?.agent_score || {};
    const rows = RADAR_REPORT_ITEMS.map((item) => {
        const score = Number(agentScore[item.axis] || 0);
        return {
            item_type_no: item.item_type_no,
            item_type: item.item_type,
            rating: reportRatingFromScore(score),
            comment: `${reportCommentFromScore(score)} (지표 점수: ${round1(score)})`,
        };
    });
    rows.push({
        item_type_no: 99,
        item_type: 'summary',
        comment: reportSummaryFromAiScore(aiScore),
    });
    return rows;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 저장된 password_hash 정규화(Buffer/hex 혼용 대응) */
function normalizePasswordHash(value) {
    if (value === null || value === undefined) return '';
    if (Buffer.isBuffer(value)) {
        if (value.length === 32) return value.toString('hex').toLowerCase();
        return value.toString('utf8').trim().toLowerCase();
    }
    return String(value).trim().toLowerCase();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('[qa-api] DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

const pool = new Pool({ connectionString: databaseUrl });

// 검수 단계: pending → in_review → review_done(검토요청) → [admin_revised(관리자 수정·상담사 확인대기)] → approved(최종승인).
// 레거시 3단계의 'completed' 는 'approved' 로 정규화(저장/입력 모두 호환).
const REVIEW_STATUS_VALUES = new Set(['pending', 'in_review', 'review_done', 'admin_revised', 'objection', 'approved']);

function normalizeReviewStatus(value) {
    if (typeof value !== 'string') return 'pending';
    const v = value === 'completed' ? 'approved' : value;
    return REVIEW_STATUS_VALUES.has(v) ? v : 'pending';
}

function toCallRow(row) {
    const hasOverride = row.has_manual_override === true || row.has_manual_override === 't';
    const consumerViolations =
        row.consumer_violations === null || row.consumer_violations === undefined
            ? null
            : Number(row.consumer_violations);
    const consumerTotal =
        row.consumer_total === null || row.consumer_total === undefined ? null : Number(row.consumer_total);
    // 체크리스트 완료 시그널 — Detail 의 reviewProgress.pct === 100 과 정합.
    // 1) has_manual_override=true → 모든 행의 manual_eval 이 응답에 살아남고 judgment 가 채워짐.
    // 2) manual_eval 이 전부 ai_eval 과 같아 override 로는 안 잡히지만, qa_golden_set 에 모든 행이
    //    들어 있어 judgment='동일' 로 시드되는 케이스 → golden_count == ev_total > 0.
    // 모든 평가행이 수기 판단(manual_eval_option NOT NULL)을 가질 때만 완료 — 행별 판단이 SSOT.
    // "override 1개만 있어도 완료"였던 옛 조기-완료 버그 제거. (golden 은 백필로 option 에 반영됨)
    const evTotal = Number(row.ev_total ?? 0);
    const optedCount = Number(row.opted_count ?? 0);
    const checklistComplete = evTotal > 0 && optedCount >= evTotal;
    return {
        qa_id: row.qa_id,
        id: row.qa_id,
        uid: row.uid ?? null,          // 상담번호(ICS UID) — 평가목록 표시용
        agent_code: row.agent_code ?? null,
        call_no: row.call_no,
        call_datetime: row.call_datetime,
        duration_sec: row.duration_sec,
        team_name: row.team_name,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        consultation_type: row.consultation_type,
        ai_score: row.ai_score,
        total_score: row.total_score,
        manual_score: hasOverride ? row.total_score : null,
        checklist_complete: checklistComplete,
        review_status: normalizeReviewStatus(row.review_status),
        review_round: Number(row.review_round ?? 0),   // N차 검토 표시용
        // 검수 메타 — 검수상태 배지 호버 시 "검수자/일시" 표시용.
        // 완료시각 없으면(자동 승격·검수중 등) 검수 시작시각으로 폴백.
        reviewed_by: row.reviewer_name || null,
        reviewed_at: row.review_completed_at ?? row.review_started_at ?? null,
        // 채널구분 — ICS tb_stt_master.IO_DIVI. io_divi 원값 + FE 편의용 channel(inbound/outbound) 동시 제공.
        io_divi: row.io_divi ?? null,
        channel: row.io_divi === 'I' ? 'inbound' : row.io_divi === 'O' ? 'outbound' : null,
        department: row.department || '컬렉션관리부',
        role: row.role || 'PDS1',
        ai_analysis_target: row.ai_analysis_target ?? null,
        ai_analysis_reason: row.ai_analysis_reason ?? null,
        voc_code: row.voc_code ?? null,
        promotion_code: row.promotion_code ?? null,
        consumer_violations: consumerViolations,
        consumer_total: consumerTotal,
        checklist_yn_kor:
            row.checklist_yn_kor && typeof row.checklist_yn_kor === 'object' && !Array.isArray(row.checklist_yn_kor)
                ? row.checklist_yn_kor
                : {},
        // 평가-시점 만점 동결 — checklist_rows.validation_time 배점 합(표시 컬럼 필터 기준).
        // 옛 콜=카탈로그 배점 합(80), 루브릭 평가 콜=ev.max_score 합(예: 78). 마이그레이션 불필요.
        // 미적재(체크리스트 없음) 시 null → FE 가 DEFAULT_TOTAL_MAX(80) 폴백.
        total_max: (row.total_max !== undefined && row.total_max !== null) ? Number(row.total_max) || null : null,
    };
}

// 메모리 기반 세션 — 프로세스 재기동 시 전 사용자 재로그인. PoC 규모에선 충분.
const sessionStore = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/ics-sso', '/api/svc/eval-items', '/api/svc/deep-eval']);

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessionStore.set(token, {
        user_id: user.user_id,
        login_id: user.login_id,
        display_name: user.display_name,
        role: user.role,
        org_id: user.org_id ?? null,
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

function destroySession(token) {
    if (token) sessionStore.delete(token);
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

const PORT = Number(process.env.API_PORT || 3007);

// 업로드 루트 — docker-compose 가 ./data/uploads 를 마운트.
// 로컬 dev (docker 미사용) 시에도 동작하도록 projectRoot 기준 절대경로 사용.
const UPLOADS_ROOT = path.join(projectRoot, 'data', 'uploads');
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
// 정적 서빙: /uploads/profiles/<file>. 인증 미들웨어 이전에 마운트해서 로그인 사용자/외부에서도 아바타 접근 가능.
// (아바타는 비공개 정보가 아니라는 가정 — 공유 사내 PoC. 변경 필요 시 인증 미들웨어 이후로 이동)
app.use(
    '/uploads',
    express.static(UPLOADS_ROOT, {
        immutable: false,
        maxAge: '1d',
        fallthrough: true,
    })
);

// 브랜드(=조직) / 도메인 CRUD
app.use('/api', createBrandRouter(pool));
// 본인 프로필 셀프-편집 (display_name / password / avatar).
app.use('/api', createUserProfileRouter(pool, { uploadsRoot: UPLOADS_ROOT }));
// ICS SSO (ICS 어드민 메뉴 팝업 → ?userId 진입). createSession 주입 — 일반 로그인과 동일 세션 발급.
app.use('/api', createIcsSsoRouter(pool, { createSession }));

// 현재 요청의 활성 브랜드(org_id) 컨텍스트 결정.
// - super_admin: X-Active-Brand-Id 헤더(없으면 본인 org_id, 그것도 없으면 null=전체)
// - 그 외 (admin): 세션 org_id 고정 (header 무시 — 다른 브랜드 데이터 접근 차단)
function resolveActiveOrgId(req) {
    if (!req.session) return null;
    if (req.session.role === 'super_admin') {
        const raw = String(req.headers['x-active-brand-id'] || '').trim();
        if (raw && raw.toLowerCase() !== 'all') {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) return parsed;
        }
        if (raw.toLowerCase() === 'all') return null; // 전체 조회
        return req.session.org_id ?? null;
    }
    return req.session.org_id ?? null;
}

// 상담사(role='agent')는 "본인이 응대한 콜"만 볼 수 있다. qa_calls.agent_user_id = 본인 user_id.
// admin/super_admin 은 제한 없음(''). params 배열에 값을 push 하고 SQL 조각을 돌려준다.
// alias = qa_calls 테이블 별칭(예: 'c').
function agentScopeSql(req, params, alias = 'c') {
    if (req.session?.role === 'agent') {
        params.push(req.session.user_id);
        return ` AND ${alias}.agent_user_id = $${params.length}`;
    }
    return '';
}

// 현재 세션이 콜 1건을 볼 수 있는지(상담사는 본인 콜만). admin/super=항상 true.
async function canAccessCall(req, qaId) {
    if (req.session?.role !== 'agent') return true;
    const { rows } = await pool.query('SELECT agent_user_id FROM qa_calls WHERE "ID" = $1', [qaId]);
    if (!rows.length) return false;
    return rows[0].agent_user_id === req.session.user_id;
}

// 수신자별 알림 1건 생성(검수 워크플로우 이벤트 전달). 실패해도 본 동작은 막지 않음.
async function createNotification(db, n) {
    if (n?.recipientUserId == null) return;
    try {
        await db.query(
            `INSERT INTO public.notifications
                (recipient_user_id, type, title, body, resource_type, resource_id, actor_user_id, actor_name, org_id)
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

// 평가 점수 표시용 — 정수면 정수로, 소수면 소수 2자리까지.
function fmtEvalNum(n) {
    if (n == null) return '-';
    const num = Number(n);
    if (Number.isNaN(num)) return String(n);
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
}

// 관리자(admin/super_admin) 전용 쓰기 게이트. 상담사 등은 403.
function requireAdmin(req, res, next) {
    if (req.session?.role === 'admin' || req.session?.role === 'super_admin') return next();
    res.status(403).json({ message: '관리자 권한이 필요합니다.' });
}

app.get('/api/health', async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT NOW() AS now_time`);
        res.json({ ok: true, db_time: rows[0]?.now_time || null, backend: 'postgresql' });
    } catch (error) {
        res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
});

/* ── 서비스 간 평가항목 공유 (튜터 등 외부 시스템이 도메인 평가항목을 읽어가는 통로) ──
 * GET /api/svc/eval-items?org_id=<n>
 * 인증: X-Service-Token === env EVAL_SHARE_TOKEN (세션 아님). 토큰 미설정 시 비활성(503).
 * 평가항목의 단일 진실 출처(SSOT)는 QA의 eval_item_defs — 복사 없이 이 통로로 읽어 씀.
 */
app.get('/api/svc/eval-items', async (req, res) => {
    const expected = String(process.env.EVAL_SHARE_TOKEN || '').trim();
    if (!expected) {
        res.status(503).json({ message: 'eval-item 공유 비활성 (EVAL_SHARE_TOKEN 미설정)' });
        return;
    }
    const provided = String(req.headers['x-service-token'] || '').trim();
    if (provided !== expected) {
        res.status(401).json({ message: 'invalid service token' });
        return;
    }
    const orgId = Number(req.query.org_id);
    if (!Number.isFinite(orgId)) {
        res.status(400).json({ message: 'org_id (number) required' });
        return;
    }
    const department = req.query.department ? normalizeDepartment(req.query.department) : null;
    try {
        const params = [orgId];
        const where = ['org_id = $1', 'deactivated_at IS NULL', 'is_active = true', 'effective_from <= now()'];
        if (department) {
            params.push(department);
            where.push(`department = $${params.length}`);
        }
        const { rows } = await pool.query(
            `SELECT order_no, category, item, criterion, pentagon_axis, scoring_type, max_score, department
               FROM public.eval_item_defs
              WHERE ${where.join(' AND ')}
              ORDER BY department ASC, order_no ASC`,
            params
        );
        res.json({ ok: true, org_id: orgId, count: rows.length, items: rows });
    } catch (error) {
        console.error('GET /api/svc/eval-items error:', error);
        res.status(500).json({ message: 'Failed to load eval items.' });
    }
});

/* ── 서비스 간 딥평가 (튜터 2차 등 외부 시스템이 transcript 를 보내 QA 엔진으로 채점) ──
 * POST /api/svc/deep-eval   (X-Service-Token)
 * body: { transcript:[{speaker,text}|{role,text}], qa_org_id, department?, role?, consultation_id? }
 * QA 의 검증된 평가 로직(evaluateStandardCall: 루브릭 빌드→엔진 호출→매핑)을 그대로 재사용하되
 * DB 에는 저장하지 않고(=다른 시스템 소유) 구조화 결과만 돌려준다.
 */
app.post('/api/svc/deep-eval', async (req, res) => {
    const expected = String(process.env.EVAL_SHARE_TOKEN || '').trim();
    if (!expected) {
        res.status(503).json({ message: '딥평가 공유 비활성 (EVAL_SHARE_TOKEN 미설정)' });
        return;
    }
    if (String(req.headers['x-service-token'] || '').trim() !== expected) {
        res.status(401).json({ message: 'invalid service token' });
        return;
    }
    const { transcript, qa_org_id, department, role, consultation_id } = req.body || {};
    const orgId = Number(qa_org_id);
    if (!Array.isArray(transcript) || !transcript.length) {
        res.status(400).json({ message: 'transcript (non-empty array) required' });
        return;
    }
    if (!Number.isFinite(orgId)) {
        res.status(400).json({ message: 'qa_org_id (number) required' });
        return;
    }
    const cid = String(consultation_id || `deep-${orgId}-${transcript.length}`).trim();
    const call = {
        transcript,
        org_id: orgId,
        department: department || undefined,
        role: role || undefined,
        consultation_id: cid,
        qa_id: cid,
        pipeline_target: 'ec2',
    };
    try {
        const mapped = await evaluateStandardCall(pool, call, {});
        res.json({
            ok: true,
            qa_org_id: orgId,
            source: mapped.source || null,
            raw_total: mapped.raw_total ?? null,
            max_total: mapped.max_total ?? null,
            ai_score: mapped.ai_score ?? null,
            evaluations: mapped.evaluations || [],
            checklist: mapped.checklist || [],
            warnings: mapped.warnings || [],
        });
    } catch (error) {
        console.error('POST /api/svc/deep-eval error:', error);
        res.status(502).json({ message: `deep-eval 실패: ${String(error?.message || error)}` });
    }
});

// 실시간 진행중 통화 현황 — MQTT /asr-result 스트림 기준(표시 전용, 전화 한정, 전화번호 PII 없음).
// MQTT 미설정 시 빈 목록. include_ended=false 면 진행중만.
app.get('/api/realtime/active-calls', (req, res) => {
    const includeEnded = String(req.query.include_ended ?? 'true') !== 'false';
    const calls = getActiveCalls(includeEnded);
    res.json({ calls, count: calls.length });
});

// IPCC 응답률/포기호(call) — xhub.call_logs 집계(읽기전용 터널 경유). IPCC 미설정 시 enabled=false.
// 진짜 포기호(상담원 연결 전 끊김)는 STT/TA 에 안 잡히므로 IPCC 가 유일 소스. proj_cd/from/to 쿼리.
app.get('/api/ipcc/call-stats', async (req, res) => {
    const proj = String(req.query.proj_cd || process.env.IPCC_PROJ_CD || 'METAM');
    const from = req.query.from || null;
    const to = req.query.to || null;
    try {
        const stats = await callAnswerStats(proj, from, to);
        res.json({ enabled: ipccEnabled(), proj_cd: proj, stats });
    } catch (e) {
        res.status(500).json({ enabled: ipccEnabled(), error: String(e?.message || e) });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const loginId = String(req.body?.id || '').trim();
    const password = String(req.body?.password || '').trim();
    if (!loginId || !password) {
        res.status(400).json({ message: 'id and password are required' });
        return;
    }
    try {
        const { rows } = await pool.query(
            `SELECT user_id, login_id, display_name, role, org_id, is_active, password_hash,
                    profile_image_path, must_change_password, department
             FROM admin_users
             WHERE login_id = $1
             LIMIT 1`,
            [loginId]
        );
        const row = rows[0];
        if (!row) {
            await insertQaAuditLog(pool, {
                req,
                actor: { user_id: null, login_id: loginId || '(unknown)', role: null },
                action: AUDIT_ACTION.AUTH_LOGIN_FAIL,
                resource_type: 'admin_user',
                resource_id: loginId || 'unknown',
                http_method: 'POST',
                http_path: '/api/auth/login',
                detail_json: JSON.stringify({ reason: 'user_not_found' }),
                success: false,
                error_message: 'invalid credentials',
            });
            res.status(401).json({ message: 'invalid credentials', reason: 'user_not_found' });
            return;
        }
        if (!row.is_active) {
            await insertQaAuditLog(pool, {
                req,
                actor: {
                    user_id: row.user_id,
                    login_id: row.login_id,
                    display_name: row.display_name,
                    role: row.role,
                },
                action: AUDIT_ACTION.AUTH_LOGIN_FAIL,
                resource_type: 'admin_user',
                resource_id: row.login_id,
                http_method: 'POST',
                http_path: '/api/auth/login',
                detail_json: JSON.stringify({ reason: 'inactive' }),
                success: false,
                error_message: 'invalid credentials',
            });
            res.status(401).json({ message: 'invalid credentials', reason: 'inactive' });
            return;
        }
        const storedHash = normalizePasswordHash(row.password_hash);
        const inputHash = sha256Hex(password).toLowerCase();
        if (!storedHash || storedHash !== inputHash) {
            await insertQaAuditLog(pool, {
                req,
                actor: {
                    user_id: row.user_id,
                    login_id: row.login_id,
                    display_name: row.display_name,
                    role: row.role,
                },
                action: AUDIT_ACTION.AUTH_LOGIN_FAIL,
                resource_type: 'admin_user',
                resource_id: row.login_id,
                http_method: 'POST',
                http_path: '/api/auth/login',
                detail_json: JSON.stringify({ reason: 'bad_password' }),
                success: false,
                error_message: 'invalid credentials',
            });
            res.status(401).json({ message: 'invalid credentials', reason: 'bad_password' });
            return;
        }
        // 샌드박스 계정: 인증 성공 + 감사 로그 기록 전에 스냅샷.
        // 이 스냅샷에는 test1의 로그인 감사 로그가 포함되지 않으므로,
        // 로그아웃 시 복원하면 test1의 모든 흔적(로그인 이벤트 포함)이 사라진다.
        if (row.login_id === SANDBOX_LOGIN_ID) {
            try {
                await beginSandboxSession(pool);
            } catch (sandboxErr) {
                console.error('[qa-api] sandbox session begin failed:', sandboxErr);
                res.status(500).json({ message: '샌드박스 세션 초기화 실패' });
                return;
            }
        }
        await insertQaAuditLog(pool, {
            req,
            actor: {
                user_id: row.user_id,
                login_id: row.login_id,
                display_name: row.display_name,
                role: row.role,
            },
            action: AUDIT_ACTION.AUTH_LOGIN_SUCCESS,
            resource_type: 'admin_user',
            resource_id: row.login_id,
            http_method: 'POST',
            http_path: '/api/auth/login',
            detail_json: JSON.stringify({ user_id: row.user_id, role: row.role }),
            success: true,
        });
        const sessionToken = createSession(row);
        res.json({
            ok: true,
            user: {
                user_id: row.user_id,
                login_id: row.login_id,
                display_name: row.display_name,
                role: row.role,
                org_id: row.org_id ?? null,
                department: row.department ?? null,
                profile_image_url: row.profile_image_path ? `/uploads/${row.profile_image_path}` : null,
                must_change_password: Boolean(row.must_change_password),
                session_token: sessionToken,
            },
        });
    } catch (error) {
        console.error('POST /api/auth/login error:', error);
        res.status(500).json({ message: 'Failed to login.' });
    }
});

app.post('/api/auth/logout', async (req, res) => {
    // body 또는 X-Actor-Login-Id 헤더 어느 쪽으로도 actor를 특정할 수 있게 허용.
    const headerLoginId = decodeURIComponent(String(req.headers['x-actor-login-id'] || '')).trim();
    const bodyLoginId = String(req.body?.login_id || '').trim();
    const loginId = bodyLoginId || headerLoginId;
    const sessionToken = String(req.headers['x-session-token'] || '').trim();
    const sessionBeforeDestroy = lookupSession(sessionToken);
    destroySession(sessionToken);
    try {
        if (loginId === SANDBOX_LOGIN_ID) {
            await endSandboxSession(pool);
        }
        await insertQaAuditLog(pool, {
            req,
            actor: {
                user_id: sessionBeforeDestroy?.user_id ?? null,
                login_id: loginId || sessionBeforeDestroy?.login_id || '(unknown)',
                display_name: sessionBeforeDestroy?.display_name ?? null,
                role: sessionBeforeDestroy?.role ?? null,
            },
            action: AUDIT_ACTION.AUTH_LOGOUT,
            resource_type: 'session',
            resource_id: loginId || sessionBeforeDestroy?.login_id || '(unknown)',
            http_method: 'POST',
            http_path: '/api/auth/logout',
            success: true,
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('POST /api/auth/logout error:', error);
        res.status(500).json({ message: 'Failed to end session.' });
    }
});

app.get('/api/calls', async (req, res) => {
    try {
        const activeOrgId = resolveActiveOrgId(req);
        const params = [];
        const conds = [];
        if (activeOrgId != null) {
            params.push(activeOrgId);
            conds.push(`c.org_id = $${params.length}`);
        }
        // 상담사(agent)는 본인이 응대한 콜만.
        if (req.session?.role === 'agent') {
            params.push(req.session.user_id);
            conds.push(`c.agent_user_id = $${params.length}`);
        }
        // '수기평가 대상만' 필터 — 배치 조건으로 도장(manual_review)된 콜만.
        if (String(req.query.manual_review || '') === 'true') {
            conds.push(`c.manual_review = true`);
        }
        // 실제 응대(=QA평가된) 콜만 노출. 포기호/미응대(상담사 미연결)는 파이프라인이
        // 평가 산출물을 만들지 못해 평가행/체크리스트/소비자평가가 전무하므로 리스트에서 제외한다.
        conds.push(`(
            EXISTS (SELECT 1 FROM qa_evaluation_rows er    WHERE er."ID" = c."ID")
         OR EXISTS (SELECT 1 FROM qa_consumer_eval_rows cr WHERE cr."ID" = c."ID")
         OR EXISTS (SELECT 1 FROM qa_checklist_rows kr     WHERE kr."ID" = c."ID")
        )`);
        // 상담사 발화가 전혀 없이 끊긴 콜(상담사 미응답/즉시 종료)은 평가 대상이 아니므로 리스트에서 제외.
        conds.push(`EXISTS (SELECT 1 FROM qa_conversations q WHERE q."ID" = c."ID" AND q.speaker = '상담사')`);
        const orgFilter = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows: callRows } = await pool.query(
            `SELECT
                c."ID" AS qa_id,
                c."ID" AS id,
                c."UID" AS uid,
                c."CALL_SEQ" AS call_no,
                c."CDATE" AS call_datetime,
                c.duration_sec AS duration_sec,
                ''::text AS team_name,
                c.agent_code AS agent_code,
                ''::text AS agent_id,
                COALESCE(au.display_name, '')::text AS agent_name,
                ''::text AS consultation_type,
                c."AI_SCORE" AS ai_score,
                c."TOTAL_SCORE" AS total_score,
                COALESCE(o.name, '')::text AS brand,
                ''::text AS eval_status,
                ''::text AS customer_no,
                ''::text AS customer_grade,
                c.department AS department,
                c.role AS role,
                c.ai_analysis_target AS ai_analysis_target,
                c.ai_analysis_reason AS ai_analysis_reason,
                c.voc_code AS voc_code,
                c.promotion_code AS promotion_code,
                c.org_id AS org_id,
                c.review_status AS review_status,
                c.review_round AS review_round,
                c.review_completed_at AS review_completed_at,
                c.review_started_at AS review_started_at,
                COALESCE(ru.display_name, ru.login_id, '')::text AS reviewer_name,
                c.io_divi AS io_divi,
                c.manual_review AS manual_review,
                c.manual_review_reasons AS manual_review_reasons,
                cv.consumer_violations,
                cv.consumer_total,
                EXISTS(
                    SELECT 1
                    FROM qa_evaluation_rows er
                    WHERE er."ID" = c."ID"
                    AND ABS(er.manual_eval - er.ai_eval) > 1e-9
                ) AS has_manual_override,
                COALESCE(gs.golden_count, 0) AS golden_count,
                COALESCE(ev.ev_total, 0) AS ev_total,
                COALESCE(ev.opted_count, 0) AS opted_count
             FROM qa_calls c
             LEFT JOIN public.organizations o ON o.id = c.org_id
             LEFT JOIN public.admin_users au ON au.user_id = c.agent_user_id
             LEFT JOIN public.admin_users ru ON ru.user_id = c.user_id
             LEFT JOIN (
                 SELECT "ID",
                        COUNT(*) FILTER (WHERE yn = 'N') AS consumer_violations,
                        COUNT(*) AS consumer_total
                 FROM qa_consumer_eval_rows
                 GROUP BY "ID"
             ) cv ON cv."ID" = c."ID"
             LEFT JOIN (
                 SELECT qa_id, COUNT(*) AS golden_count
                 FROM qa_golden_set
                 GROUP BY qa_id
             ) gs ON gs.qa_id = c."ID"
             LEFT JOIN (
                 SELECT "ID", COUNT(*) AS ev_total,
                        COUNT(*) FILTER (WHERE manual_eval_option IS NOT NULL) AS opted_count
                 FROM qa_evaluation_rows
                 GROUP BY "ID"
             ) ev ON ev."ID" = c."ID"
             ${orgFilter}
             ORDER BY c."CDATE" DESC`,
            params
        );
        const qaIds = (callRows || []).map((r) => r.qa_id).filter(Boolean);
        if (qaIds.length === 0) {
            res.json([]);
            return;
        }
        const { rows: chRows } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, category, item, agent_utterance, validation_time
             FROM qa_checklist_rows
             WHERE "ID" = ANY($1::text[])`,
            [qaIds]
        );
        const { rows: evRows } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, ai_eval
             FROM qa_evaluation_rows
             WHERE "ID" = ANY($1::text[])`,
            [qaIds]
        );
        const chByQa = new Map();
        for (const r of chRows || []) {
            if (!chByQa.has(r.qa_id)) chByQa.set(r.qa_id, []);
            chByQa.get(r.qa_id).push(r);
        }
        const evByQa = new Map();
        for (const r of evRows || []) {
            if (!evByQa.has(r.qa_id)) evByQa.set(r.qa_id, []);
            evByQa.get(r.qa_id).push(r);
        }
        const payload = (callRows || []).map((row) => {
            const chRows = chByQa.get(row.qa_id) || [];
            // 동적 루브릭 콜(이커머스/은행 등)은 행 자체 카테고리로 집계 — 부서 고정 키셋은 불일치.
            const keys = effectiveChecklistKeys(row.department, chRows);
            const yn = buildChecklistYnKorFromDbRows(chRows, evByQa.get(row.qa_id) || [], keys);
            // 평가-시점 만점 합산 — 표시 컬럼(keys) 에 해당하는 행만 집계(builder 와 동일 필터).
            // 체크리스트 없으면 null → FE DEFAULT_TOTAL_MAX 폴백.
            const keySet = new Set(keys);
            let sumTotalMax = 0;
            for (const r of chRows) {
                if (keySet.has(String(r.category || '').trim())) {
                    sumTotalMax += parseMaxPointsFromValidationTime(r.validation_time);
                }
            }
            const total_max = sumTotalMax > 0 ? sumTotalMax : null;
            return toCallRow({ ...row, checklist_yn_kor: yn, total_max });
        });
        res.json(payload);
    } catch (error) {
        console.error('GET /api/calls error:', error);
        res.status(500).json({ message: 'Failed to load calls.' });
    }
});

/* ── 상담사 목록(코칭 배정용) ─────────────────────────────────
 * GET /api/agents
 * 실제로 콜을 처리·평가받은 상담사(qa_calls.agent_user_id)를 admin_users 와 조인해
 * 이름·부서·평균점수·콜수를 반환. 코칭 배정 대상/멤버 표시의 실데이터 소스.
 * org 스코프 + is_sandbox 제외. 부서는 admin_users.department 가 비면 콜의 부서로 대체.
 * ────────────────────────────────────────────────────────── */
app.get('/api/agents', async (req, res) => {
    try {
        const activeOrgId = resolveActiveOrgId(req);
        const params = [];
        let where = `WHERE c.is_sandbox = false AND c.agent_user_id IS NOT NULL`;
        if (activeOrgId != null) {
            params.push(activeOrgId);
            where += ` AND c.org_id = $${params.length}`;
        }
        const { rows } = await pool.query(
            `SELECT c.agent_user_id AS user_id,
                    MAX(c.agent_code) AS agent_code,
                    COALESCE(MAX(u.display_name), MAX(c.agent_code), '미지정') AS name,
                    COALESCE(NULLIF(MAX(u.department), ''), MAX(NULLIF(c.department, '')), '미지정') AS department,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS score,
                    COUNT(*) AS calls
               FROM qa_calls c
               LEFT JOIN admin_users u ON u.user_id = c.agent_user_id
               ${where}
              GROUP BY c.agent_user_id
              ORDER BY score DESC NULLS LAST, calls DESC`,
            params
        );
        res.json(
            rows.map((r) => ({
                id: r.agent_code || `u${r.user_id}`,
                user_id: r.user_id,
                name: r.name,
                team: r.department,
                score: r.score != null ? Number(r.score) : null,
                calls: Number(r.calls),
            }))
        );
    } catch (error) {
        console.error('GET /api/agents error:', error);
        res.status(500).json({ message: 'Failed to load agents.' });
    }
});

/* ── 전체 통계(대시보드) ──────────────────────────────────────
 * GET /api/stats?department=<부서|all>&period=day|week|month
 *
 * 점수 = qa_calls."TOTAL_SCORE"(0~100). 코칭대상 = 80점 미만. is_sandbox 제외.
 * 기간 앵커 = 해당 스코프의 최신 CDATE(과거 시드 데이터도 항상 보이도록 상대창).
 *   day=1일, week=7일, month=30일 (앵커일 기준 거슬러). 직전 동일창과 비교해 delta 산출.
 * 부서 그룹화(팀 개념 없음) + 상담사 랭킹은 agent_user_id→admin_users 이름조인,
 *   미연결(agent_user_id IS NULL)은 '미지정' 한 줄로 묶어 추적 가능하게 노출.
 * 항목별 게이지는 0~100 정규화: avg(manual_eval) / (부서·order_no 관측 최대점) * 100.
 * ────────────────────────────────────────────────────────── */
app.get('/api/stats', async (req, res) => {
    try {
        const orgId = resolveActiveOrgId(req);
        const periodRaw = String(req.query.period || 'week').toLowerCase();
        const periodDays = periodRaw === 'day' ? 1 : periodRaw === 'month' ? 30 : 7;
        const deptRaw = String(req.query.department || '').trim();
        const department = deptRaw && deptRaw.toLowerCase() !== 'all' ? deptRaw : null;

        // 공통 스코프(WHERE) 빌더 — is_sandbox 제외 + org + (상담사 본인필터) + 선택 부서.
        // 반환: { where, params } — alias 'c'.
        const buildScope = ({ withDept = false } = {}) => {
            const params = [];
            let where = `WHERE c.is_sandbox = false`;
            if (orgId != null) { params.push(orgId); where += ` AND c.org_id = $${params.length}`; }
            where += agentScopeSql(req, params, 'c');
            if (withDept && department) { params.push(department); where += ` AND c.department = $${params.length}`; }
            return { where, params };
        };

        // 1) 기간 앵커 = 스코프 내 최신 콜 날짜
        const scopeAll = buildScope();
        const anchorRes = await pool.query(
            `SELECT MAX(c."CDATE"::timestamp)::date AS anchor FROM qa_calls c ${scopeAll.where}`,
            scopeAll.params
        );
        const anchor = anchorRes.rows[0]?.anchor || null;
        if (!anchor) {
            res.json({ period: periodRaw, department, anchor: null, departments: [],
                kpi: { avg: null, count: 0, agent_count: 0, coaching: 0, delta: null },
                items: [], daily: [], weak: [], ranking: [] });
            return;
        }
        // 창 경계 SQL 조각(앵커 기준 상대창). 현재창 [start, anchor], 직전창 [prevStart, start)
        const winCur = `c."CDATE"::date BETWEEN ($A::date - ($D - 1)) AND $A::date`;
        const winPrev = `c."CDATE"::date BETWEEN ($A::date - (2*$D - 1)) AND ($A::date - $D)`;
        const bind = (sql, params) => {
            params.push(anchor); const a = `$${params.length}`;
            params.push(periodDays); const d = `$${params.length}`;
            return sql.replace(/\$A/g, a).replace(/\$D/g, d);
        };

        // 2) 부서 카드(현재창, 모든 부서)
        const sc2 = buildScope();
        const deptRows = (await pool.query(
            `SELECT c.department,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS avg,
                    COUNT(*) AS count,
                    COUNT(DISTINCT COALESCE(c.agent_user_id::text, c.agent_code)) AS agent_count,
                    COUNT(*) FILTER (WHERE c."TOTAL_SCORE" < 80) AS coaching
               FROM qa_calls c ${sc2.where} AND ${bind(winCur, sc2.params)}
              GROUP BY c.department
              ORDER BY count DESC`,
            sc2.params
        )).rows;

        // 3) 선택 부서(또는 전체) KPI — 현재창 + 직전창 평균(delta)
        const sc3 = buildScope({ withDept: true });
        const kpiRow = (await pool.query(
            `SELECT ROUND(AVG(c."TOTAL_SCORE") FILTER (WHERE ${bind(winCur, sc3.params)})::numeric,1) AS avg,
                    COUNT(*) FILTER (WHERE ${bind(winCur, sc3.params)}) AS count,
                    COUNT(DISTINCT COALESCE(c.agent_user_id::text, c.agent_code))
                      FILTER (WHERE ${bind(winCur, sc3.params)}) AS agent_count,
                    COUNT(*) FILTER (WHERE ${bind(winCur, sc3.params)} AND c."TOTAL_SCORE" < 80) AS coaching,
                    ROUND(AVG(c."TOTAL_SCORE") FILTER (WHERE ${bind(winPrev, sc3.params)})::numeric,1) AS prev_avg
               FROM qa_calls c ${sc3.where}`,
            sc3.params
        )).rows[0];
        const kpi = {
            avg: kpiRow.avg != null ? Number(kpiRow.avg) : null,
            count: Number(kpiRow.count) || 0,
            agent_count: Number(kpiRow.agent_count) || 0,
            coaching: Number(kpiRow.coaching) || 0,
            delta: (kpiRow.avg != null && kpiRow.prev_avg != null)
                ? Number((kpiRow.avg - kpiRow.prev_avg).toFixed(1)) : null,
        };

        // 4) 항목별 평균(0~100 정규화) — 부서·order_no 관측 최대점으로 나눔.
        //    CTE(item_max)는 전체기간(안정적 분모), 본문은 현재창. 같은 scope.where 를 양쪽이 공유
        //    → 동일 $1.. 플레이스홀더가 같은 값 가리키므로 안전. 창 파라미터는 한 번만 덧붙인다.
        const sc4 = buildScope({ withDept: true });
        const winCur4 = bind(winCur, sc4.params);
        const items = (await pool.query(
            `WITH item_max AS (
                 SELECT c.department, er.order_no, MAX(er.ai_eval) AS max_pts
                   FROM qa_evaluation_rows er JOIN qa_calls c ON c."ID" = er."ID"
                   ${sc4.where}
                  GROUP BY c.department, er.order_no
             )
             SELECT MIN(er.order_no) AS order_no, er.category, er.item,
                    ROUND(AVG(er.manual_eval)::numeric, 2) AS avg_raw,
                    MAX(im.max_pts) AS item_max,
                    CASE WHEN MAX(im.max_pts) > 0
                         THEN ROUND((AVG(er.manual_eval)/MAX(im.max_pts)*100)::numeric, 1) END AS avg,
                    COUNT(*) AS count
               FROM qa_evaluation_rows er
               JOIN qa_calls c ON c."ID" = er."ID"
               LEFT JOIN item_max im ON im.department = c.department AND im.order_no = er.order_no
               ${sc4.where} AND ${winCur4}
              GROUP BY er.category, er.item
              ORDER BY order_no`,
            sc4.params
        )).rows.map((r) => ({
            order_no: Number(r.order_no), category: r.category, item: r.item,
            // 관측 최대 분모라 수기 override(높음)로 100 초과 가능 → 0~100 클램프.
            avg: r.avg != null ? Math.max(0, Math.min(100, Number(r.avg))) : null,
            avg_raw: Number(r.avg_raw),
            item_max: r.item_max != null ? Number(r.item_max) : null, count: Number(r.count),
        }));
        const weak = [...items].filter((i) => i.avg != null).sort((a, b) => a.avg - b.avg).slice(0, 5);

        // 5) 일별 추이(현재창)
        const sc5 = buildScope({ withDept: true });
        const daily = (await pool.query(
            `SELECT c."CDATE"::date AS date,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS avg, COUNT(*) AS count
               FROM qa_calls c ${sc5.where} AND ${bind(winCur, sc5.params)}
              GROUP BY c."CDATE"::date ORDER BY 1`,
            sc5.params
        )).rows.map((r) => ({ date: r.date, avg: Number(r.avg), count: Number(r.count) }));

        // 6) 상담사 랭킹(현재창) — 이름 조인, 미연결은 '미지정' 한 줄
        const sc6 = buildScope({ withDept: true });
        const ranking = (await pool.query(
            `SELECT c.agent_user_id, c.agent_code,
                    u.display_name, u.role,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS avg, COUNT(*) AS count
               FROM qa_calls c
               LEFT JOIN admin_users u ON u.user_id = c.agent_user_id
               ${sc6.where} AND ${bind(winCur, sc6.params)}
              GROUP BY c.agent_user_id, c.agent_code, u.display_name, u.role
              ORDER BY avg DESC NULLS LAST, count DESC`,
            sc6.params
        )).rows.map((r) => {
            const unassigned = r.agent_user_id == null && !r.agent_code;
            return {
                agent_user_id: r.agent_user_id ?? null,
                agent_code: r.agent_code ?? null,
                name: unassigned ? '미지정' : (r.display_name || r.agent_code || '미지정'),
                role: r.role || null,
                unassigned,
                avg: r.avg != null ? Number(r.avg) : null,
                count: Number(r.count),
            };
        });

        res.json({
            period: periodRaw, period_days: periodDays, department,
            anchor: typeof anchor === 'string' ? anchor : anchor.toISOString?.().slice(0, 10) ?? String(anchor),
            departments: deptRows.map((r) => ({
                department: r.department, avg: r.avg != null ? Number(r.avg) : null,
                count: Number(r.count), agent_count: Number(r.agent_count), coaching: Number(r.coaching),
            })),
            kpi, items, weak, daily, ranking,
        });
    } catch (error) {
        console.error('GET /api/stats error:', error);
        res.status(500).json({ message: 'Failed to load stats.' });
    }
});

app.get('/api/analysis/:qaId', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }
    if (!(await canAccessCall(req, qaId))) {
        res.status(403).json({ message: '본인 콜만 조회할 수 있습니다.' });
        return;
    }
    try {
        const { rows } = await pool.query(
            'SELECT "ID" AS qa_id, "AI_SCORE" AS ai_score, "TOTAL_SCORE" AS total_score, department FROM qa_calls WHERE "ID" = $1 LIMIT 1',
            [qaId]
        );
        if (!rows[0]) {
            res.status(404).json({ message: 'Not found' });
            return;
        }
        const dept = rows[0].department;
        // 소비자보호부 콜은 Pentagon 분석 트랙 사용 안 함 — 빈 응답.
        if (dept === '소비자보호부') {
            res.json({ qa_id: rows[0].qa_id, department: '소비자보호부', pentagon: null, report: [] });
            return;
        }
        const isHanwha = dept === '고객센터';
        const isDefault = dept === '고객지원실';
        const { rows: checklistRows } = await pool.query(
            `SELECT c.order_no, c.category, c.item, c.validation_time, e.ai_eval
             FROM qa_checklist_rows c
             LEFT JOIN qa_evaluation_rows e
               ON e."ID" = c."ID" AND e.order_no = c.order_no
             WHERE c."ID" = $1
             ORDER BY c.order_no ASC`,
            [qaId]
        );
        const checklistAugmented = (checklistRows || []).map((r) => ({
            ...r,
            result: String(r.ai_eval ?? ''),
        }));
        // 동적 루브릭 콜(이커머스/은행 등): 행 카테고리가 코오롱 표준 8 카테고리와 전혀 안 겹침 —
        // 코오롱 매핑으로는 5축 전부 0 이 되므로 행 카테고리 축으로 레이더 구성.
        const rowCategorySet = new Set(
            checklistAugmented.map((r) => String(r.category || '').trim()).filter(Boolean)
        );
        const isDynamicRubric =
            isDefault &&
            rowCategorySet.size > 0 &&
            ![...rowCategorySet].some((c) => DEFAULT_PENTAGON_CATEGORIES.has(c));
        const pentagon = isHanwha
            ? buildHanwhaPentagonFromChecklistRows(checklistAugmented)
            : isDynamicRubric
                ? buildDynamicPentagonFromChecklistRows(checklistAugmented)
                : isDefault
                    ? buildDefaultPentagonFromChecklistRows(checklistAugmented)
                    : buildPentagonFromChecklistRows(checklistAugmented);
        const { rows: reportRowsRaw } = await pool.query(
            `SELECT item_type_no, item_type, rating, comment, summary
             FROM qa_analysis_report
             WHERE "ID" = $1
             ORDER BY item_type_no ASC`,
            [qaId]
        );
        const persistedReportRows = (reportRowsRaw || [])
            .filter((r) => String(r.item_type || '').trim() && String(r.comment || '').trim())
            .map((r) => ({
                item_type_no: Number(r.item_type_no) || 0,
                item_type: String(r.item_type || '').trim(),
                rating: String(r.rating || '').trim(),
                comment: String(r.comment || '').trim(),
            }));
        const summaryText =
            (reportRowsRaw || [])
                .map((r) => String(r.summary || '').trim())
                .find((v) => Boolean(v)) || reportSummaryFromAiScore(rows[0].ai_score);
        const report =
            persistedReportRows.length > 0
                ? [...persistedReportRows, { item_type_no: 99, item_type: 'summary', comment: summaryText }]
                : isHanwha
                    ? buildHanwhaFallbackReportRows(pentagon, rows[0].ai_score)
                    : isDynamicRubric
                        ? buildDynamicFallbackReportRows(pentagon, rows[0].ai_score)
                        : isDefault
                            ? buildDefaultFallbackReportRows(pentagon, rows[0].ai_score)
                            : buildFallbackReportRows(pentagon, rows[0].ai_score);
        res.json({
            qa_id: rows[0].qa_id,
            department: dept,
            pentagon,
            report,
        });
    } catch (error) {
        console.error('GET /api/analysis/:qaId error:', error);
        res.status(500).json({ message: 'Failed to load analysis.' });
    }
});

app.get('/api/evaluations/:qaId', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }
    if (!(await canAccessCall(req, qaId))) {
        res.status(403).json({ message: '본인 콜만 조회할 수 있습니다.' });
        return;
    }
    try {
        const { rows: callRows } = await pool.query(
            `SELECT "ID" AS qa_id, department, role, ai_analysis_target, ai_analysis_reason, voc_code, promotion_code,
                    manual_review, manual_review_reasons
             FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
            [qaId]
        );
        if (!callRows[0]) {
            res.status(404).json({ message: 'Not found' });
            return;
        }
        const callMeta = callRows[0];
        // 수기평가 대상 사유(상세 배지용) — ['저품질 검증 · 평균점수 미달', ...]
        const manualReviewReasons = Array.isArray(callMeta.manual_review_reasons) ? callMeta.manual_review_reasons : [];

        // 관리자 코멘트 — qa_admin_comments(qa_id 단일행에 전체 배열 보관). 없으면 [].
        const { rows: acRows } = await pool.query(
            'SELECT comments FROM public.qa_admin_comments WHERE qa_id = $1',
            [qaId]
        );
        const adminComments = Array.isArray(acRows[0]?.comments) ? acRows[0].comments : [];

        const { rows: convRaw } = await pool.query(
            `SELECT "ID" AS qa_id, turn_no, ''::text AS ts, speaker, "text" AS text
             FROM qa_conversations
             WHERE "ID" = $1
             ORDER BY turn_no ASC`,
            [qaId]
        );

        // 소비자보호부 분기 — 평가 트랙(20 Y/N) + AI 분석 트랙(금칙어/카테고리/분석대상) 반환.
        if (callMeta.department === '소비자보호부') {
            const { rows: consumerEvalRows } = await pool.query(
                `SELECT "ID" AS qa_id, item_no, major_category, sub_no, criterion, item_text, yn, detail_text,
                        evidence_line_no, evidence_text
                 FROM qa_consumer_eval_rows
                 WHERE "ID" = $1
                 ORDER BY item_no ASC`,
                [qaId]
            );
            const { rows: keywordRows } = await pool.query(
                `SELECT keyword_id, "ID" AS qa_id, level, major_category, sub_category, keyword, line_no, line_text
                 FROM qa_consumer_keywords
                 WHERE "ID" = $1
                 ORDER BY keyword_id ASC`,
                [qaId]
            );
            const { rows: aiCatRows } = await pool.query(
                `SELECT "ID" AS qa_id, category_no, major_category, sub_category, score
                 FROM qa_consumer_ai_categories
                 WHERE "ID" = $1
                 ORDER BY category_no ASC`,
                [qaId]
            );
            res.json({
                qa_id: qaId,
                department: '소비자보호부',
                role: callMeta.role || '전체',
                ai_analysis_target: callMeta.ai_analysis_target,
                ai_analysis_reason: callMeta.ai_analysis_reason,
                voc_code: callMeta.voc_code,
                promotion_code: callMeta.promotion_code,
                consumer_eval_rows: consumerEvalRows,
                consumer_keywords: keywordRows,
                consumer_ai_categories: aiCatRows.map((r) => ({
                    ...r,
                    score: r.score === null || r.score === undefined ? 0 : Number(r.score),
                })),
                conversation: convRaw,
                admin_comments: adminComments,
                manual_review: !!callMeta.manual_review,
                manual_review_reasons: manualReviewReasons,
            });
            return;
        }

        // 컬렉션관리부 분기 (기존 로직)
        const { rows: evaluation_rows } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, category, item, reason_text, ai_eval, manual_eval, manual_eval_option, counselor_eval
             FROM qa_evaluation_rows
             WHERE "ID" = $1
             ORDER BY order_no ASC`,
            [qaId]
        );
        const { rows: checklist_rows } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, category, item, agent_utterance, validation_time
             FROM qa_checklist_rows
             WHERE "ID" = $1
             ORDER BY order_no ASC`,
            [qaId]
        );

        // 평가매칭률·당월평균·직무평균을 동적 계산.
        // - match_rate:  행 단위로 |ai_eval - manual_eval| / max_pts 만큼 깎아서 일치율(%) 산출.
        // - monthly_avg: 같은 연-월(CDATE 첫 7자) + 같은 직무(role) 안에서 동일 item 의 ai_eval 평균을 max_pts 대비 %.
        // - team_avg:    같은 직무(role) 운영 baseline 평균 (UI 라벨: "직무평균"). 시점 무관.
        // 본 PoC는 직무별 만점 매트릭스가 다르므로 baseline 도 같은 role 안에서만 비교해야 의미가 정합.
        // 집계는 sample-* 행을 제외해 "운영 baseline" 만 반영.
        const maxByOrderNo = new Map();
        for (const r of checklist_rows) {
            maxByOrderNo.set(Number(r.order_no), parseMaxPointsFromValidationTime(r.validation_time));
        }
        const { rows: ymRows } = await pool.query(
            `SELECT substr("CDATE", 1, 7) AS ym FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
            [qaId]
        );
        const yearMonth = String(ymRows[0]?.ym || '');
        const callRole = String(callMeta.role || '').trim();
        const { rows: aggRows } = await pool.query(
            `SELECT
                e.item AS item,
                AVG(CASE WHEN substr(c."CDATE", 1, 7) = $1 THEN e.ai_eval END) AS monthly_avg_raw,
                AVG(e.ai_eval) AS team_avg_raw
             FROM qa_evaluation_rows e
             JOIN qa_calls c ON c."ID" = e."ID"
             WHERE e."ID" NOT LIKE 'sample-%'
               AND c.role = $2
             GROUP BY e.item`,
            [yearMonth, callRole]
        );
        const monthlyByItem = new Map();
        const teamByItem = new Map();
        for (const r of aggRows) {
            const m = r.monthly_avg_raw === null || r.monthly_avg_raw === undefined ? null : Number(r.monthly_avg_raw);
            const t = r.team_avg_raw === null || r.team_avg_raw === undefined ? null : Number(r.team_avg_raw);
            monthlyByItem.set(r.item, Number.isFinite(m) ? m : null);
            teamByItem.set(r.item, Number.isFinite(t) ? t : null);
        }
        const toPct = (avg, max) => {
            if (avg === null || avg === undefined || !Number.isFinite(avg) || max <= 0) return null;
            return Math.max(0, Math.min(100, Math.round((100 * avg) / max)));
        };
        // 판단의 SSOT = manual_eval_option(텍스트, 행별). NULL 이면 "미평가" → manual_eval/match_rate 도 비운다.
        // (예전엔 "콜에 override 1개라도 있으면 전 행의 manual_eval 을 내려줌" → 안 누른 행이 ai=동일로 보이는 버그.
        //  이제 행별로 판단한 행만 값을 내려준다. 옛 데이터 호환: 옵션이 없어도 manual_eval 이 ai 와 다르면 override 로 간주.)
        const evaluation_rows_with_metrics = evaluation_rows.map((r) => {
            const max = maxByOrderNo.get(Number(r.order_no)) || 0;
            const ai = Number(r.ai_eval);
            const manual = Number(r.manual_eval);
            const opt = r.manual_eval_option ? String(r.manual_eval_option).trim() : '';
            const isOverride = Number.isFinite(ai) && Number.isFinite(manual) && Math.abs(ai - manual) > 1e-9;
            const judged = opt !== '' || isOverride; // 이 행을 실제로 수기 판단했는가
            const matchRate =
                judged && max > 0 && Number.isFinite(ai) && Number.isFinite(manual)
                    ? Math.max(0, Math.min(100, Math.round(100 - (Math.abs(ai - manual) / max) * 100)))
                    : null;
            const teamAvgPct = toPct(teamByItem.get(r.item) ?? null, max);
            const monthlyAvgPct = toPct(monthlyByItem.get(r.item) ?? null, max);
            return {
                ...r,
                manual_eval_option: opt || null,
                manual_eval: judged ? r.manual_eval : null,
                match_rate: matchRate,
                // 당월평균 = 같은 연-월·직무 운영 baseline 평균. 같은 월에 비교 대상이 없으면(예: 오늘 업로드한
                // 샘플 + mock 이 다른 월에 시드된 케이스) 직무평균으로 대체해서 빈 칸을 피한다.
                monthly_avg: monthlyAvgPct ?? teamAvgPct,
                team_avg: teamAvgPct,
            };
        });

        res.json({
            qa_id: qaId,
            department: callMeta.department || '컬렉션관리부',
            role: callMeta.role || 'PDS1',
            evaluation_rows: evaluation_rows_with_metrics,
            checklist_rows,
            conversation: convRaw,
            admin_comments: adminComments,
            manual_review: !!callMeta.manual_review,
            manual_review_reasons: manualReviewReasons,
        });
    } catch (error) {
        console.error('GET /api/evaluations/:qaId error:', error);
        res.status(500).json({ message: 'Failed to load evaluations.' });
    }
});

app.put('/api/evaluations/:qaId', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    const patches = req.body?.manual_patches;
    const consumerPatches = req.body?.consumer_yn_patches;
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }

    // sandbox 계정은 운영 행(is_sandbox=false) 평가를 수정할 수 없음 — 운영 데이터 무결성 보호.
    if (req.session?.login_id === SANDBOX_LOGIN_ID) {
        try {
            const { rows: targetRow } = await pool.query(
                `SELECT is_sandbox FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
                [qaId]
            );
            if (targetRow[0] && targetRow[0].is_sandbox === false) {
                res.status(403).json({ message: 'sandbox account cannot modify production evaluations' });
                return;
            }
        } catch (err) {
            console.error('PUT /api/evaluations sandbox guard error:', err);
            res.status(500).json({ message: 'failed to verify target row' });
            return;
        }
    }

    // 쓰기 권한: 관리자=전체 / 상담사=본인 콜 + (검토요청·최종승인 전까지)만 수정(이의제기) / 그 외 차단.
    {
        const role = req.session?.role;
        const isAdmin = role === 'admin' || role === 'super_admin';
        if (!isAdmin) {
            if (role !== 'agent') {
                res.status(403).json({ message: '평가를 수정할 권한이 없습니다.' });
                return;
            }
            try {
                const { rows: own } = await pool.query(
                    `SELECT agent_user_id, review_status FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
                    [qaId]
                );
                if (!own[0]) {
                    res.status(404).json({ message: 'call not found' });
                    return;
                }
                const isOwn = own[0].agent_user_id != null && own[0].agent_user_id === req.session?.user_id;
                const st = normalizeReviewStatus(own[0].review_status);
                if (!isOwn) {
                    res.status(403).json({ message: '본인 콜만 수정할 수 있습니다.' });
                    return;
                }
                if (st === 'review_done' || st === 'admin_revised' || st === 'approved') {
                    res.status(403).json({ message: '검토요청/확인대기/최종승인 상태에서는 수정할 수 없습니다. (재이의제기 후 수정)' });
                    return;
                }
            } catch (err) {
                console.error('PUT /api/evaluations perm guard error:', err);
                res.status(500).json({ message: 'failed to verify permission' });
                return;
            }
        }
    }

    // 소비자보호부 Y/N 업데이트 분기
    if (Array.isArray(consumerPatches) && consumerPatches.length > 0) {
        try {
            const { rows: existCall } = await pool.query(
                'SELECT "ID" AS qa_id, department FROM qa_calls WHERE "ID" = $1 LIMIT 1',
                [qaId]
            );
            if (!existCall[0]) {
                res.status(404).json({ message: 'Not found' });
                return;
            }
            if (existCall[0].department !== '소비자보호부') {
                res.status(400).json({ message: 'consumer_yn_patches는 소비자보호부 콜에서만 사용 가능합니다.' });
                return;
            }
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                let applied = 0;
                for (const p of consumerPatches) {
                    const yn = String(p?.yn || '').trim();
                    const itemNo = Number(p?.item_no);
                    if (!Number.isFinite(itemNo) || (yn !== 'Y' && yn !== 'N')) continue;
                    const detail = p?.detail_text === undefined ? null : String(p.detail_text);
                    if (detail === null) {
                        await client.query(
                            `UPDATE qa_consumer_eval_rows SET yn = $1 WHERE "ID" = $2 AND item_no = $3`,
                            [yn, qaId, itemNo]
                        );
                    } else {
                        await client.query(
                            `UPDATE qa_consumer_eval_rows SET yn = $1, detail_text = $2 WHERE "ID" = $3 AND item_no = $4`,
                            [yn, detail, qaId, itemNo]
                        );
                    }
                    applied += 1;
                }
                await client.query('COMMIT');
                await insertQaAuditLog(pool, {
                    req,
                    action: AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
                    resource_type: 'qa_call',
                    resource_id: qaId,
                    http_method: 'PUT',
                    http_path: `/api/evaluations/${encodeURIComponent(qaId)}`,
                    detail_json: JSON.stringify({ track: 'consumer_yn', patch_count: applied }),
                    success: true,
                });
                res.json({ ok: true, track: 'consumer_yn', applied });
                return;
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PUT /api/evaluations/:qaId (consumer) error:', error);
            res.status(500).json({ message: 'Failed to save consumer evaluations.' });
            return;
        }
    }

    if (!Array.isArray(patches) || patches.length === 0) {
        res.status(400).json({ message: 'manual_patches 또는 consumer_yn_patches 가 필요합니다.' });
        return;
    }
    try {
        const { rows: callRows } = await pool.query('SELECT "ID" AS qa_id FROM qa_calls WHERE "ID" = $1 LIMIT 1', [qaId]);
        if (!callRows[0]) {
            res.status(404).json({ message: 'Not found' });
            return;
        }
        const { rows: existingEval } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, category, item, reason_text, ai_eval, manual_eval
             FROM qa_evaluation_rows
             WHERE "ID" = $1
             ORDER BY order_no ASC`,
            [qaId]
        );
        const { rows: checklistBase } = await pool.query(
            `SELECT "ID" AS qa_id, order_no, category, item, agent_utterance, validation_time
             FROM qa_checklist_rows
             WHERE "ID" = $1
             ORDER BY order_no ASC`,
            [qaId]
        );
        const aiByOrderNo = new Map(existingEval.map((r) => [Number(r.order_no), Number(r.ai_eval)]));
        const checklist = checklistBase.map((r) => ({
            ...r,
            result: String(aiByOrderNo.get(Number(r.order_no)) ?? ''),
        }));
        const merged = mergeManualPatches(existingEval, patches);
        // 검증·저장 모두 이번 요청으로 패치된 행만 대상으로 한다 — 기존 행에 tier 밖
        // 레거시 수기값(예: "3")이 있어도 새 저장이 막히면 안 된다 (2026-06-11 판단 저장 롤백 버그).
        const patchedOrderNos = new Set((patches || []).map((p) => Number(p.order_no)));
        const patchedRows = merged.filter((r) => patchedOrderNos.has(Number(r.order_no)));
        const validation = validateMergedManualEvals(patchedRows, checklist);
        if (!validation.ok) {
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
                resource_type: 'qa_call',
                resource_id: qaId,
                http_method: 'PUT',
                http_path: `/api/evaluations/${encodeURIComponent(qaId)}`,
                detail_json: JSON.stringify({ patch_count: patches.length, validation_error: validation.message }),
                success: false,
                error_message: validation.message,
            });
            res.status(400).json({ message: validation.message });
            return;
        }
        // 판단 라벨('낮음'/'동일'/'높음')만 저장하는 요청은 점수 집계 대상이 아니다 —
        // TOTAL_SCORE(AI 점수 표시값)를 레거시 수기 숫자 기반 환산치로 덮어쓰지 않는다.
        const labelOnly = (patches || []).every((p) =>
            MANUAL_JUDGMENT_LABELS.includes(String(p?.manual_eval ?? '').trim())
        );
        const manualPct = labelOnly ? null : computeManualRubricPct(merged, checklist);
        // manual_eval 은 double precision — 판단 라벨은 해당 행 AI 점수 기준 숫자로 인코딩:
        // 동일 → ai 그대로, 높음 → ai+0.5, 낮음 → ai-0.5. (±0.5 는 실데이터에 없는 half-point
        // 라 판단 저장분임을 구분 가능, 프론트 시드가 ai 와의 대소 비교로 판단을 역산한다.)
        // option: 판단 SSOT(낮음/동일/높음). 숫자 직접 저장(레거시 경로)은 option=null.
        const encodeForStore = (rawVal, orderNo) => {
            const v = String(rawVal ?? '').trim();
            // manual_eval 은 NOT NULL — 빈 값/평가제외는 쓰기 자체를 생략 (UI 에 판단 해제 경로 없음).
            if (v === '' || v === '평가제외') return { ok: true, skip: true };
            if (MANUAL_JUDGMENT_LABELS.includes(v)) {
                const ai = aiByOrderNo.get(Number(orderNo));
                if (!Number.isFinite(ai)) {
                    return { ok: false, message: `order_no=${orderNo} AI 점수가 없어 판단을 저장할 수 없습니다.` };
                }
                if (v === '동일') return { ok: true, value: ai, option: '동일' };
                return { ok: true, value: v === '높음' ? ai + 0.5 : ai - 0.5, option: v };
            }
            const n = Number(v);
            return Number.isFinite(n)
                ? { ok: true, value: n, option: null }
                : { ok: false, message: `order_no=${orderNo} 수기값 "${v}" 를 숫자로 저장할 수 없습니다.` };
        };
        const encoded = [];
        for (const r of patchedRows) {
            const e = encodeForStore(r.manual_eval, r.order_no);
            if (!e.ok) {
                res.status(400).json({ message: e.message });
                return;
            }
            if (e.skip) continue;
            encoded.push({ order_no: Number(r.order_no), value: e.value, option: e.option ?? null });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const r of encoded) {
                await client.query(
                    `UPDATE qa_evaluation_rows
                     SET manual_eval = $1, manual_eval_option = $2
                     WHERE "ID" = $3 AND order_no = $4`,
                    [r.value, r.option, qaId, r.order_no]
                );
            }
            // 수기 환산점수가 산출될 때만 TOTAL_SCORE 갱신 — null 일 때 0 으로 덮어쓰면 안 된다.
            if (manualPct !== null) {
                await client.query(`UPDATE qa_calls SET "TOTAL_SCORE" = $1 WHERE "ID" = $2`, [
                    Number(manualPct),
                    qaId,
                ]);
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        const { rows: savedRows } = await pool.query('SELECT "ID" AS qa_id FROM qa_calls WHERE "ID" = $1', [qaId]);
        if (!savedRows[0]) {
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
                resource_type: 'qa_call',
                resource_id: qaId,
                http_method: 'PUT',
                http_path: `/api/evaluations/${encodeURIComponent(qaId)}`,
                detail_json: JSON.stringify({ patch_count: patches.length }),
                success: false,
                error_message: 'Not found',
            });
            res.status(404).json({ message: 'Not found' });
            return;
        }
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
            resource_type: 'qa_call',
            resource_id: qaId,
            http_method: 'PUT',
            http_path: `/api/evaluations/${encodeURIComponent(qaId)}`,
            detail_json: JSON.stringify({
                manual_score_after: manualPct,
                patch_count: patches.length,
                patches_preview: patches.slice(0, 8),
            }),
            success: true,
        });
        res.json({
            ok: true,
            manual_score: manualPct === null ? null : Number(manualPct),
            evaluation_rows: merged,
        });
    } catch (error) {
        console.error('PUT /api/evaluations/:qaId error:', error);
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
            resource_type: 'qa_call',
            resource_id: qaId,
            http_method: 'PUT',
            http_path: `/api/evaluations/${encodeURIComponent(qaId)}`,
            detail_json: null,
            success: false,
            error_message: String(error?.message || error),
        });
        res.status(500).json({ message: 'Failed to save manual evaluations.' });
    }
});

app.put('/api/evaluations/:qaId/admin-comments', async (req, res) => {
    const qaId = req.params.qaId;
    const list = Array.isArray(req.body?.admin_comments) ? req.body.admin_comments : [];
    try {
        await pool.query(
            `INSERT INTO public.qa_admin_comments (qa_id, comments, updated_at)
                 VALUES ($1, $2::jsonb, now())
             ON CONFLICT (qa_id) DO UPDATE SET comments = EXCLUDED.comments, updated_at = now()`,
            [qaId, JSON.stringify(list)]
        );
        res.json({ ok: true, admin_comments: list });
    } catch (error) {
        console.error('PUT /api/evaluations/:qaId/admin-comments error:', error);
        res.status(500).json({ message: 'Failed to save admin comments.' });
    }
});

// 검수 4단계 전이 — 대기(pending) → 검수중(in_review) → 검토요청(review_done) → 최종승인(approved).
//   상담사(agent): 본인 콜 한정, pending↔in_review↔review_done (approved 이후 잠금).
//   관리자(admin/super): 모든 전이(최종승인 포함).
//   review_done 진입 시 상담사 점수 스냅샷(counselor_eval), approved 시 관리자 수정분 diff → 상담사 알림.
app.put('/api/calls/:qaId/review-status', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    const raw = req.body?.review_status;
    const next = normalizeReviewStatus(raw);
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }
    if (!(REVIEW_STATUS_VALUES.has(raw) || raw === 'completed')) {
        res.status(400).json({ message: 'invalid review_status' });
        return;
    }

    // 현재 콜 상태 로드 — 전이 검증·알림 수신자(상담사)·sandbox 판정에 사용.
    let cur;
    try {
        const { rows } = await pool.query(
            `SELECT review_status, agent_user_id, org_id, is_sandbox FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
            [qaId]
        );
        if (!rows[0]) {
            res.status(404).json({ message: 'call not found' });
            return;
        }
        cur = rows[0];
    } catch (err) {
        console.error('PUT /api/calls/:qaId/review-status load error:', err);
        res.status(500).json({ message: 'failed to load target row' });
        return;
    }

    // sandbox 계정은 운영 행 검수상태도 수정 불가 — 운영 데이터 보호.
    if (req.session?.login_id === SANDBOX_LOGIN_ID && cur.is_sandbox === false) {
        res.status(403).json({ message: 'sandbox account cannot modify production calls' });
        return;
    }

    // 역할 기반 전이 검증 — 반려/이의제기 루프(새 설계).
    //   상담사(본인): pending→in_review(검수시작) / pending·in_review→review_done(검토제출,round+1) /
    //                 admin_revised→objection(이의제기,사유)·approved(점수 동의→확정).
    //   관리자: pending·in_review→approved(직접 확정) / review_done→admin_revised(반려,사유)·approved(최종 승인) /
    //           objection→approved(재검토 후 승인)·admin_revised(다시 반려,사유) / admin_revised→approved(강제 확정) /
    //           approved→review_done(확정 취소).
    const role = req.session?.role;
    const isAdmin = role === 'admin' || role === 'super_admin';
    const isAgent = role === 'agent';
    const isOwn = cur.agent_user_id != null && cur.agent_user_id === req.session?.user_id;
    const from = normalizeReviewStatus(cur.review_status);
    const uid = req.session?.user_id ?? null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;

    let allowed = false;
    if (isAdmin) {
        if (next === 'pending' || next === 'in_review') allowed = true;
        else if (next === 'approved') allowed = ['pending', 'in_review', 'review_done', 'objection', 'admin_revised'].includes(from);
        else if (next === 'admin_revised') allowed = (from === 'review_done' || from === 'objection'); // 반려 / 다시 반려
        else if (next === 'review_done') allowed = (from === 'approved'); // 확정 취소
    } else if (isAgent && isOwn) {
        if (from === 'pending' && next === 'in_review') allowed = true; // 검수 시작(작성중 표시)
        else if ((from === 'pending' || from === 'in_review') && next === 'review_done') allowed = true; // 검토 제출
        else if (from === 'admin_revised' && (next === 'objection' || next === 'approved')) allowed = true; // 이의제기 / 점수 동의
    }
    if (!allowed) {
        res.status(403).json({ message: '이 상태로 변경할 권한이 없습니다.' });
        return;
    }

    // 반려/이의제기엔 사유 필수.
    if ((next === 'admin_revised' || next === 'objection') && !reason) {
        res.status(400).json({ message: '사유를 입력해 주세요.' });
        return;
    }

    // 검토요청 제출은 수기평가 100% 완료해야 가능(프론트 버튼 게이트의 백엔드 백스톱 — API 직접 호출 우회 방지).
    //   "판단됨" 정의 = manual_eval_option 설정됨 OR manual_eval≠ai_eval (GET /api/evaluations 의 judged 와 동일).
    if (isAgent && next === 'review_done' && (from === 'pending' || from === 'in_review')) {
        const { rows: prog } = await pool.query(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (
                        WHERE (manual_eval_option IS NOT NULL AND btrim(manual_eval_option) <> '')
                           OR (ai_eval IS NOT NULL AND manual_eval IS NOT NULL AND manual_eval IS DISTINCT FROM ai_eval)
                    )::int AS judged
               FROM qa_evaluation_rows WHERE "ID" = $1`,
            [qaId]
        );
        const total = prog[0]?.total ?? 0;
        const judged = prog[0]?.judged ?? 0;
        if (total > 0 && judged < total) {
            res.status(400).json({ message: `수기평가를 모두 입력해야 검토요청할 수 있습니다 (${judged}/${total}).` });
            return;
        }
    }

    // counselor_eval(상담사 마지막 제출) 대비 manual_eval(현재) 변경분.
    async function computeDiff() {
        const { rows } = await pool.query(
            `SELECT order_no, item, counselor_eval, manual_eval
               FROM qa_evaluation_rows
              WHERE "ID" = $1 AND counselor_eval IS NOT NULL AND manual_eval IS DISTINCT FROM counselor_eval
              ORDER BY order_no`,
            [qaId]
        );
        return rows;
    }

    // 행위(action) 판정 + 승인자 결정.
    let action = null;
    let diffRows = [];
    let approvedBy = null;
    if (next === 'approved') {
        if (isAgent) {
            action = 'agree'; // 상담사 점수 동의 → 확정. 승인자=마지막 반려 관리자.
            const { rows: rev } = await pool.query(
                `SELECT actor_user_id FROM qa_review_events WHERE qa_id=$1 AND action IN ('reject','reject_again') ORDER BY id DESC LIMIT 1`, [qaId]
            );
            approvedBy = rev[0]?.actor_user_id ?? uid;
        } else {
            if (from === 'review_done') action = 'approve';            // 최종 승인
            else if (from === 'objection') action = 'reapprove';       // 재검토 후 승인
            else if (from === 'admin_revised') action = 'force_approve'; // 강제 확정
            else action = 'direct_approve';                            // pending/in_review 직접 확정
            approvedBy = uid;
        }
    } else if (next === 'admin_revised') {
        diffRows = await computeDiff();
        action = (from === 'objection') ? 'reject_again' : 'reject'; // 반려 / 다시 반려
    } else if (next === 'objection') {
        action = 'object'; // 이의제기
    } else if (next === 'review_done') {
        action = (from === 'approved') ? 'cancel' : 'submit';
    } else if (next === 'in_review' && from === 'pending') {
        action = 'start';
    }

    const bumpRound = (action === 'submit');

    try {
        const { rows } = await pool.query(
            `UPDATE qa_calls
                SET review_status = $2,
                    review_round = review_round + CASE WHEN $4 THEN 1 ELSE 0 END,
                    review_started_at = CASE
                        WHEN review_started_at IS NULL AND $2 IN ('in_review', 'review_done', 'admin_revised', 'objection', 'approved')
                        THEN now() ELSE review_started_at
                    END,
                    review_completed_at = CASE
                        WHEN $2 IN ('review_done', 'approved') AND review_completed_at IS NULL THEN now()
                        ELSE review_completed_at
                    END,
                    approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, now()) ELSE NULL END,
                    approved_by_user_id = CASE WHEN $2 = 'approved' THEN $5::integer ELSE NULL END,
                    user_id = COALESCE($3::integer, user_id)
              WHERE "ID" = $1
              RETURNING review_status, review_round, review_started_at, review_completed_at, approved_at`,
            [qaId, next, uid, bumpRound, approvedBy]
        );
        if (!rows[0]) {
            res.status(404).json({ message: 'call not found' });
            return;
        }
        const updated = rows[0];
        const round = updated.review_round;

        // 검토요청 제출(→검토요청) 시 상담사 점수 스냅샷(이후 관리자 변경분 diff 기준).
        if (action === 'submit') {
            await pool.query(`UPDATE qa_evaluation_rows SET counselor_eval = manual_eval WHERE "ID" = $1`, [qaId])
                .catch((e) => console.error('counselor_eval snapshot error:', e));
        }

        // 감사 이벤트 기록(사유·변경분 포함).
        if (action) {
            const changed = (action === 'reject' || action === 'reject_again' || action === 'force_approve') && diffRows.length
                ? JSON.stringify(diffRows.map((r) => ({ order_no: r.order_no, item: r.item, from: r.counselor_eval, to: r.manual_eval })))
                : null;
            await pool.query(
                `INSERT INTO qa_review_events (qa_id, round, actor_user_id, action, changed_items, reason) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
                [qaId, round, uid, action, changed, reason]
            ).catch((e) => console.error('review event insert error:', e));
        }

        // 알림.
        try {
            const actorName = req.session?.display_name || req.session?.login_id || null;
            const changesText = diffRows
                .map((r) => `${r.item} ${fmtEvalNum(r.counselor_eval)}→${fmtEvalNum(r.manual_eval)}`)
                .join(', ');
            const N = (cur.agent_user_id != null);
            const notifyAgent = (type, title, body) => createNotification(pool, {
                recipientUserId: cur.agent_user_id, type, title, body,
                resourceType: 'qa_call', resourceId: qaId, actorUserId: uid, actorName, orgId: cur.org_id ?? null,
            });
            if ((action === 'reject' || action === 'reject_again') && N) {
                await notifyAgent('review_revised',
                    action === 'reject_again' ? '평가가 다시 반려되었습니다' : '평가가 반려되었습니다',
                    `반려 사유: ${reason}${diffRows.length ? ` · 변경 ${diffRows.length}건(${changesText})` : ''}`);
            } else if ((action === 'approve' || action === 'reapprove' || action === 'direct_approve') && N) {
                await notifyAgent('review_approved', '평가가 확정되었습니다',
                    action === 'reapprove' ? '재검토 후 점수가 확정되었습니다.' : '평가 점수가 최종 확정되었습니다.');
            } else if (action === 'force_approve' && N) {
                await notifyAgent('review_edited', '평가가 강제 확정되었습니다',
                    diffRows.length ? `변경 ${diffRows.length}건: ${changesText}` : '관리자가 점수를 확정했습니다.');
            } else if (action === 'agree' && approvedBy != null) {
                await createNotification(pool, {
                    recipientUserId: approvedBy, type: 'review_acknowledged',
                    title: '상담사가 점수에 동의했습니다',
                    body: `${actorName || '상담사'}님이 점수에 동의하여 확정되었습니다.`,
                    resourceType: 'qa_call', resourceId: qaId, actorUserId: uid, actorName, orgId: cur.org_id ?? null,
                });
            } else if (action === 'object') {
                const { rows: rev } = await pool.query(
                    `SELECT actor_user_id FROM qa_review_events WHERE qa_id=$1 AND action IN ('reject','reject_again') ORDER BY id DESC LIMIT 1`, [qaId]
                );
                const target = rev[0]?.actor_user_id;
                if (target != null) {
                    await createNotification(pool, {
                        recipientUserId: target, type: 'review_reobjected',
                        title: '상담사가 이의제기했습니다',
                        body: `이의제기 사유: ${reason}`,
                        resourceType: 'qa_call', resourceId: qaId, actorUserId: uid, actorName, orgId: cur.org_id ?? null,
                    });
                }
            }
        } catch (e) {
            console.error('review notify error:', e);
        }

        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_REVIEW_STATUS_UPDATE,
            resource_type: 'qa_call',
            resource_id: qaId,
            http_method: 'PUT',
            http_path: `/api/calls/${encodeURIComponent(qaId)}/review-status`,
            detail_json: JSON.stringify({ review_status: next, action, round }),
            success: true,
        });
        res.json({
            ok: true,
            review_status: updated.review_status,
            review_round: updated.review_round,
            review_started_at: updated.review_started_at,
            review_completed_at: updated.review_completed_at,
        });
    } catch (error) {
        console.error('PUT /api/calls/:qaId/review-status error:', error);
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_REVIEW_STATUS_UPDATE,
            resource_type: 'qa_call',
            resource_id: qaId,
            http_method: 'PUT',
            http_path: `/api/calls/${encodeURIComponent(qaId)}/review-status`,
            success: false,
            error_message: String(error?.message || error),
        });
        res.status(500).json({ message: 'failed to update review_status' });
    }
});

// 검수 이력(타임라인) — 상세화면 "검수 이력" 팝업용. 최신순 아님(오름차순) — 타임라인 누적 표시.
app.get('/api/calls/:qaId/review-events', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }
    try {
        const { rows } = await pool.query(
            `SELECT e.id, e.round, e.action, e.changed_items, e.reason, e.created_at,
                    e.actor_user_id, u.name AS actor_name
               FROM qa_review_events e
               LEFT JOIN users u ON u.id = e.actor_user_id
              WHERE e.qa_id = $1
              ORDER BY e.id ASC`,
            [qaId]
        );
        res.json(rows.map((r) => ({
            id: Number(r.id),
            round: Number(r.round ?? 0),
            action: r.action,
            changed_items: r.changed_items || null,
            reason: r.reason || null,
            actor_user_id: r.actor_user_id ?? null,
            actor_name: r.actor_name || null,
            created_at: r.created_at,
        })));
    } catch (error) {
        console.error('GET /api/calls/:qaId/review-events error:', error);
        res.status(500).json({ message: 'failed to load review events' });
    }
});

/* ── 골든셋(qa_golden_set) ──────────────────────────────────
 * 수기평가 "AI 와 동일" 로 확정된 케이스를 LLM Few-shot 예제로 보관.
 * - GET    /api/golden-set/:qaId               → 해당 콜의 골드셋 행 목록 (order_no 기준)
 * - POST   /api/golden-set/:qaId/:orderNo      → 등록 (서버가 현재 데이터에서 스냅샷)
 * - DELETE /api/golden-set/:qaId/:orderNo      → 해제
 *
 * "동일" 판정 자체는 프론트의 새 수기평가 모델(낮음/동일/높음)에서 결정되며,
 * DB qa_evaluation_rows.manual_eval 컬럼은 아직 그 모델과 비호환이므로
 * 본 라우트는 manual_eval == ai_eval 검증을 강제하지 않는다 (프론트가 gatekeeper).
 * score 는 ai_eval (== 동일 판정 시 사용자가 인정한 점수) 을 그대로 스냅샷.
 */
// 평가 항목 단위 골든셋 사례 조회 — AI 평가항목 관리 탭의 "골든셋 사례" 탭에서 사용.
// 활성 브랜드(org_id) 로 필터. super_admin 이 X-Active-Brand-Id=all 이면 전체.
// 매칭 키: order_no 가 오면 그것만 사용 (qa_evaluation_rows.item 의 긴 문구와
// CHECKLIST_TEMPLATE.item 의 UI 단축어가 다른 신한 케이스 대응). 없으면 (category, item) 폴백.
app.get('/api/golden-set', async (req, res) => {
    const orderNoRaw = req.query.order_no;
    const orderNo = orderNoRaw !== undefined && orderNoRaw !== '' && Number.isFinite(Number(orderNoRaw))
        ? Number(orderNoRaw)
        : null;
    const category = String(req.query.category || '').trim();
    const item = String(req.query.item || '').trim();
    const orgId = resolveActiveOrgId(req);
    try {
        const conds = [];
        const params = [];
        if (orderNo !== null) {
            params.push(orderNo); conds.push(`g.order_no = $${params.length}`);
            // super_admin 의 활성 브랜드가 "all" (=orgId null) 인 경우 order_no 만으로는
            // 브랜드 간 동일 번호 항목이 섞일 수 있어 category 도 강제 AND.
            if ((orgId === null || orgId === undefined) && category) {
                params.push(category); conds.push(`g.category = $${params.length}`);
            }
        } else {
            if (category) { params.push(category); conds.push(`g.category = $${params.length}`); }
            if (item)     { params.push(item);     conds.push(`g.item     = $${params.length}`); }
        }
        if (orgId !== null && orgId !== undefined) {
            params.push(orgId); conds.push(`g.org_id = $${params.length}`);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool.query(
            `SELECT g.golden_id, g.qa_id, g.order_no, g.org_id,
                    c."CDATE" AS call_datetime,
                    g.category, g.item, g.reason_text, g.agent_utterance, g.score,
                    g.created_at,
                    c.user_id      AS user_id,
                    u.login_id     AS login_id,
                    u.display_name AS display_name
             FROM qa_golden_set g
             LEFT JOIN qa_calls    c ON c."ID"    = g.qa_id
             LEFT JOIN admin_users u ON u.user_id = c.user_id
             ${where}
             ORDER BY g.created_at DESC
             LIMIT 200`,
            params
        );
        res.json({ ok: true, entries: rows });
    } catch (error) {
        console.error('GET /api/golden-set error:', error);
        res.status(500).json({ message: 'Failed to load golden set entries.' });
    }
});

app.get('/api/golden-set/:qaId', async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    if (!qaId) {
        res.status(400).json({ message: 'qaId is required' });
        return;
    }
    try {
        const { rows } = await pool.query(
            `SELECT g.golden_id, g.qa_id, g.order_no, g.org_id,
                    c."CDATE" AS call_datetime,
                    g.category, g.item, g.reason_text, g.agent_utterance, g.score,
                    g.created_at,
                    c.user_id     AS user_id,
                    u.login_id    AS login_id,
                    u.display_name AS display_name
             FROM qa_golden_set g
             LEFT JOIN qa_calls    c ON c."ID"     = g.qa_id
             LEFT JOIN admin_users u ON u.user_id  = c.user_id
             WHERE g.qa_id = $1
             ORDER BY g.order_no ASC`,
            [qaId]
        );
        res.json({ ok: true, entries: rows });
    } catch (error) {
        console.error('GET /api/golden-set/:qaId error:', error);
        res.status(500).json({ message: 'Failed to load golden set.' });
    }
});

app.post('/api/golden-set/:qaId/:orderNo', requireAdmin, async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    const orderNo = Number(req.params.orderNo);
    if (!qaId || !Number.isFinite(orderNo)) {
        res.status(400).json({ message: 'qaId and orderNo are required' });
        return;
    }

    // sandbox 계정은 운영 콜의 골드셋을 만들 수 없음 (운영 데이터 무결성 보호).
    if (req.session?.login_id === SANDBOX_LOGIN_ID) {
        try {
            const { rows: targetRow } = await pool.query(
                `SELECT is_sandbox FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
                [qaId]
            );
            if (targetRow[0] && targetRow[0].is_sandbox === false) {
                res.status(403).json({ message: 'sandbox account cannot modify production data' });
                return;
            }
        } catch (err) {
            console.error('POST /api/golden-set sandbox guard error:', err);
            res.status(500).json({ message: 'failed to verify target row' });
            return;
        }
    }

    try {
        // 스냅샷 소스: 평가행 + 체크리스트(발화) + 콜 메타
        // 등록자는 qa_calls.user_id (검수자) 로 추적되므로 별도 컬럼 적재 불필요.
        const { rows: evalRow } = await pool.query(
            `SELECT er."ID" AS qa_id, er.order_no, er.category, er.item, er.reason_text, er.ai_eval,
                    cr.agent_utterance, c.org_id
             FROM qa_evaluation_rows er
             LEFT JOIN qa_checklist_rows cr ON cr."ID" = er."ID" AND cr.order_no = er.order_no
             LEFT JOIN qa_calls c ON c."ID" = er."ID"
             WHERE er."ID" = $1 AND er.order_no = $2
             LIMIT 1`,
            [qaId, orderNo]
        );
        if (!evalRow[0]) {
            res.status(404).json({ message: 'evaluation row not found' });
            return;
        }
        const e = evalRow[0];

        // UNIQUE (qa_id, order_no) 충돌 시 충돌 행 그대로 반환 (멱등성)
        const { rows: inserted } = await pool.query(
            `INSERT INTO qa_golden_set (
                qa_id, order_no, org_id,
                category, item, reason_text, agent_utterance, score
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (qa_id, order_no) DO NOTHING
             RETURNING golden_id, qa_id, order_no, score, created_at`,
            [
                qaId, orderNo, e.org_id ?? null,
                e.category, e.item,
                e.reason_text ?? null, e.agent_utterance ?? null,
                Number(e.ai_eval),
            ]
        );
        const wasNew = inserted.length > 0;
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_GOLDEN_SET_ADD,
            resource_type: 'qa_golden_set',
            resource_id: `${qaId}#${orderNo}`,
            http_method: 'POST',
            http_path: `/api/golden-set/${encodeURIComponent(qaId)}/${orderNo}`,
            detail_json: JSON.stringify({ inserted: wasNew, category: e.category, item: e.item }),
            success: true,
        });
        res.json({ ok: true, inserted: wasNew, entry: inserted[0] || null });
    } catch (error) {
        console.error('POST /api/golden-set/:qaId/:orderNo error:', error);
        res.status(500).json({ message: 'Failed to add to golden set.' });
    }
});

app.delete('/api/golden-set/:qaId/:orderNo', requireAdmin, async (req, res) => {
    const qaId = String(req.params.qaId || '').trim();
    const orderNo = Number(req.params.orderNo);
    if (!qaId || !Number.isFinite(orderNo)) {
        res.status(400).json({ message: 'qaId and orderNo are required' });
        return;
    }

    if (req.session?.login_id === SANDBOX_LOGIN_ID) {
        try {
            const { rows: targetRow } = await pool.query(
                `SELECT is_sandbox FROM qa_calls WHERE "ID" = $1 LIMIT 1`,
                [qaId]
            );
            if (targetRow[0] && targetRow[0].is_sandbox === false) {
                res.status(403).json({ message: 'sandbox account cannot modify production data' });
                return;
            }
        } catch (err) {
            console.error('DELETE /api/golden-set sandbox guard error:', err);
            res.status(500).json({ message: 'failed to verify target row' });
            return;
        }
    }

    try {
        const { rowCount } = await pool.query(
            `DELETE FROM qa_golden_set WHERE qa_id = $1 AND order_no = $2`,
            [qaId, orderNo]
        );
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.QA_GOLDEN_SET_REMOVE,
            resource_type: 'qa_golden_set',
            resource_id: `${qaId}#${orderNo}`,
            http_method: 'DELETE',
            http_path: `/api/golden-set/${encodeURIComponent(qaId)}/${orderNo}`,
            detail_json: JSON.stringify({ removed: rowCount > 0 }),
            success: true,
        });
        res.json({ ok: true, removed: rowCount > 0 });
    } catch (error) {
        console.error('DELETE /api/golden-set/:qaId/:orderNo error:', error);
        res.status(500).json({ message: 'Failed to remove from golden set.' });
    }
});

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

// GET /api/admin/eval-items
// query: ?department=...&version=...  (둘 다 옵션)
// - 둘 다 미지정: 현재 효력 중인 활성 정의만 반환 (deactivated_at IS NULL AND effective_from <= now())
// - version 지정: 해당 부서·버전 행 반환
app.get('/api/admin/eval-items', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.json({ ok: true, items: [] });
        return;
    }
    const department = req.query.department ? normalizeDepartment(req.query.department) : null;
    const version = req.query.version !== undefined ? Number(req.query.version) : null;
    if (version !== null && !Number.isFinite(version)) {
        res.status(400).json({ message: 'version must be a number' });
        return;
    }
    try {
        const params = [orgId];
        const where = ['org_id = $1'];
        if (department) {
            params.push(department);
            where.push(`department = $${params.length}`);
        }
        if (version !== null) {
            params.push(version);
            where.push(`version = $${params.length}`);
        } else {
            where.push('deactivated_at IS NULL');
            where.push('effective_from <= now()');
        }
        const { rows } = await pool.query(
            `SELECT order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    department, version, effective_from, deactivated_at, updated_at
             FROM public.eval_item_defs
             WHERE ${where.join(' AND ')}
             ORDER BY department ASC, order_no ASC`,
            params
        );
        res.json({ ok: true, items: rows });
    } catch (error) {
        console.error('GET /api/admin/eval-items error:', error);
        res.status(500).json({ message: 'Failed to load eval item defs.' });
    }
});

// GET /api/admin/eval-item-versions
// 부서별 버전 목록 (드롭다운용). 각 버전의 effective_from = MIN(해당 버전 항목들의 effective_from).
app.get('/api/admin/eval-item-versions', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.json({ ok: true, versions: [] });
        return;
    }
    try {
        const { rows } = await pool.query(
            `SELECT department,
                    version,
                    MIN(effective_from) AS effective_from,
                    MAX(deactivated_at) FILTER (WHERE deactivated_at IS NOT NULL) AS last_deactivated_at,
                    bool_and(deactivated_at IS NULL) AS is_active
             FROM public.eval_item_defs
             WHERE org_id = $1
             GROUP BY department, version
             ORDER BY department ASC, version DESC`,
            [orgId]
        );
        res.json({ ok: true, versions: rows });
    } catch (error) {
        console.error('GET /api/admin/eval-item-versions error:', error);
        res.status(500).json({ message: 'Failed to load eval item versions.' });
    }
});

// PUT /api/admin/eval-items/:orderNo
// body: {
//   category, item, criterion, prompt_template,
//   pentagon_axis?, scoring_type?, max_score?, is_active?,
//   department?, is_meaning_change?
// }
// - is_meaning_change=false (기본): 활성 행 in-place UPDATE
// - is_meaning_change=true: 활성 행 deactivated_at=now() + 새 버전 행 INSERT
app.put('/api/admin/eval-items/:orderNo', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    const orderNo = Number(req.params.orderNo);
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    if (!Number.isFinite(orderNo)) {
        res.status(400).json({ message: 'orderNo must be a number' });
        return;
    }
    const { category, item, criterion, prompt_template } = req.body || {};
    if (typeof category !== 'string' || typeof item !== 'string') {
        res.status(400).json({ message: 'category and item are required strings' });
        return;
    }
    // 새 메타 필드 — undefined 면 백엔드에서 기본값/기존값 처리.
    const pentagonAxisRaw = req.body?.pentagon_axis;
    const pentagonAxis =
        pentagonAxisRaw === undefined ? undefined
        : (typeof pentagonAxisRaw === 'string' && pentagonAxisRaw.trim()) ? pentagonAxisRaw.trim()
        : null;
    const scoringTypeRaw = req.body?.scoring_type;
    const scoringType =
        scoringTypeRaw === undefined ? undefined
        : (scoringTypeRaw === 'numeric' || scoringTypeRaw === 'yes_no') ? scoringTypeRaw
        : null;
    if (scoringType === null) {
        res.status(400).json({ message: "scoring_type must be 'numeric' or 'yes_no'" });
        return;
    }
    const maxScoreRaw = req.body?.max_score;
    let maxScore;
    if (maxScoreRaw === undefined) maxScore = undefined;
    else if (maxScoreRaw === null || maxScoreRaw === '') maxScore = null;
    else {
        const n = Number(maxScoreRaw);
        if (!Number.isFinite(n) || n < 0) {
            res.status(400).json({ message: 'max_score must be a non-negative number' });
            return;
        }
        maxScore = Math.round(n);
    }
    const isActiveRaw = req.body?.is_active;
    const isActive =
        isActiveRaw === undefined ? undefined
        : isActiveRaw === true ? true
        : isActiveRaw === false ? false
        : null;
    if (isActive === null) {
        res.status(400).json({ message: 'is_active must be boolean' });
        return;
    }
    const department = normalizeDepartment(req.body?.department);
    const isMeaningChange = req.body?.is_meaning_change === true;

    const actor = req.session || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 현재 활성 행 (있으면) — 변경 전 스냅샷 계산용으로 전체 필드 가져옴
        const { rows: activeRows } = await client.query(
            `SELECT id, version, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active
               FROM public.eval_item_defs
              WHERE org_id = $1 AND department = $2 AND order_no = $3
                AND deactivated_at IS NULL
              ORDER BY version DESC
              LIMIT 1`,
            [orgId, department, orderNo]
        );
        const activeRow = activeRows[0];

        // 미제공 필드는 기존 활성 행 값 유지 (없으면 백엔드 default).
        const effPentagonAxis = pentagonAxis !== undefined ? pentagonAxis : (activeRow?.pentagon_axis ?? null);
        const effScoringType = scoringType !== undefined ? scoringType : (activeRow?.scoring_type ?? 'numeric');
        const effMaxScore = maxScore !== undefined ? maxScore : (activeRow?.max_score ?? null);
        const effIsActive = isActive !== undefined ? isActive : (activeRow?.is_active ?? true);

        let resultRow;
        let logChangeType = null;
        let logBefore = null;
        let logAfter = null;
        let logVersion = null;

        if (!activeRow) {
            // 활성 행 없음 → 신규 발행 (v1 또는 부서 max+1)
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM public.eval_item_defs
                  WHERE org_id = $1 AND department = $2 AND order_no = $3`,
                [orgId, department, orderNo]
            );
            const nextVersion = (maxRows[0]?.max_version || 0) + 1;
            const { rows: insertRows } = await client.query(
                `INSERT INTO public.eval_item_defs
                   (org_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [
                    orgId, department, orderNo, category, item,
                    criterion ?? null, prompt_template ?? null,
                    effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                    nextVersion,
                ]
            );
            resultRow = insertRows[0];
            logChangeType = 'create';
            logBefore = null;
            logAfter = {
                category, item,
                criterion: criterion ?? null,
                prompt_template: prompt_template ?? null,
                pentagon_axis: effPentagonAxis,
                scoring_type: effScoringType,
                max_score: effMaxScore,
                is_active: effIsActive,
                version: nextVersion,
            };
            logVersion = nextVersion;
        } else if (isMeaningChange) {
            // 의미 변경 → 활성 행 deactivate + 새 버전 발행
            await client.query(
                `UPDATE public.eval_item_defs
                    SET deactivated_at = now()
                  WHERE id = $1`,
                [activeRow.id]
            );
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM public.eval_item_defs
                  WHERE org_id = $1 AND department = $2`,
                [orgId, department]
            );
            const nextVersion = (maxRows[0]?.max_version || 0) + 1;
            const { rows: insertRows } = await client.query(
                `INSERT INTO public.eval_item_defs
                   (org_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [
                    orgId, department, orderNo, category, item,
                    criterion ?? null, prompt_template ?? null,
                    effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                    nextVersion,
                ]
            );
            resultRow = insertRows[0];
            logChangeType = 'new_version';
            logBefore = {
                category: activeRow.category,
                item: activeRow.item,
                criterion: activeRow.criterion,
                prompt_template: activeRow.prompt_template,
                pentagon_axis: activeRow.pentagon_axis,
                scoring_type: activeRow.scoring_type,
                max_score: activeRow.max_score,
                is_active: activeRow.is_active,
                version: activeRow.version,
            };
            logAfter = {
                category, item,
                criterion: criterion ?? null,
                prompt_template: prompt_template ?? null,
                pentagon_axis: effPentagonAxis,
                scoring_type: effScoringType,
                max_score: effMaxScore,
                is_active: effIsActive,
                version: nextVersion,
            };
            logVersion = nextVersion;
        } else {
            // 텍스트 다듬기 / 배점 변경 → in-place UPDATE
            const { rows: updateRows } = await client.query(
                `UPDATE public.eval_item_defs
                    SET category        = $1,
                        item            = $2,
                        criterion       = $3,
                        prompt_template = $4,
                        pentagon_axis   = $5,
                        scoring_type    = $6,
                        max_score       = $7,
                        is_active       = $8,
                        updated_at      = now()
                  WHERE id = $9
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [
                    category, item, criterion ?? null, prompt_template ?? null,
                    effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                    activeRow.id,
                ]
            );
            resultRow = updateRows[0];
            // 변경된 필드만 before/after 에 담는다. 변경 없으면 audit log 박지 않음.
            const changedFields = {};
            const fieldMap = {
                category, item,
                criterion: criterion ?? null,
                prompt_template: prompt_template ?? null,
                pentagon_axis: effPentagonAxis,
                scoring_type: effScoringType,
                max_score: effMaxScore,
                is_active: effIsActive,
            };
            for (const [key, newVal] of Object.entries(fieldMap)) {
                const oldVal = activeRow[key] ?? null;
                if ((oldVal ?? null) !== (newVal ?? null)) {
                    changedFields[key] = { before: oldVal, after: newVal };
                }
            }
            if (Object.keys(changedFields).length > 0) {
                const before = {};
                const after = {};
                for (const [k, v] of Object.entries(changedFields)) {
                    before[k] = v.before;
                    after[k] = v.after;
                }
                // change_type 결정: 의미적으로 가장 영향 큰 변경 기준
                if (changedFields.item || changedFields.category) logChangeType = 'item_rename';
                else if (changedFields.is_active !== undefined && Object.keys(changedFields).length === 1) {
                    logChangeType = effIsActive ? 'reactivate' : 'deactivate';
                }
                else if (changedFields.pentagon_axis) logChangeType = 'pentagon_axis_update';
                else if (changedFields.scoring_type || changedFields.max_score) logChangeType = 'scoring_update';
                else if (changedFields.prompt_template && changedFields.criterion) logChangeType = 'criterion_prompt_update';
                else if (changedFields.prompt_template) logChangeType = 'prompt_update';
                else logChangeType = 'criterion_update';
                logBefore = before;
                logAfter = after;
                logVersion = activeRow.version;
            }
        }

        // change log 삽입 (변경이 있을 때만)
        // item_name / category_name 은 변경 시점의 스냅샷 — 항목 삭제 후에도 통합 이력에서 표시 가능.
        if (logChangeType) {
            await client.query(
                `INSERT INTO public.eval_item_change_log
                   (org_id, department, order_no, item_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
                [
                    orgId, department, orderNo,
                    item, category,
                    logVersion, logChangeType,
                    logBefore ? JSON.stringify(logBefore) : null,
                    logAfter ? JSON.stringify(logAfter) : null,
                    actor.user_id ?? null,
                    actor.login_id ?? null,
                    actor.display_name ?? null,
                ]
            );
        }

        await client.query('COMMIT');
        // 루브릭 push 훅 없음 — 백엔드(QA_RUBRIC_SOURCE=db)가 평가 시 eval_item_defs 를 직접 읽음.
        res.json({ ok: true, item: resultRow });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('PUT /api/admin/eval-items/:orderNo error:', error);
        res.status(500).json({ message: 'Failed to save eval item def.' });
    } finally {
        client.release();
    }
});

// POST /api/admin/eval-items
// body: {
//   category, item, criterion?, prompt_template?,
//   pentagon_axis?, scoring_type, max_score?, is_active?,
//   departments: string[]    // 1개 이상의 부서. 각 부서별로 row 발행.
// }
// - order_no 는 활성 브랜드 전체에서 max(order_no)+1 로 자동 발급.
// - 동일 order_no 를 모든 부서에 INSERT (브랜드 내에서 같은 항목 = 같은 order_no 패턴 유지).
// - change_type='create' 로 부서별로 변경 이력 적재.
app.post('/api/admin/eval-items', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const { category, item, criterion, prompt_template } = req.body || {};
    if (typeof category !== 'string' || !category.trim()) {
        res.status(400).json({ message: 'category is required' });
        return;
    }
    if (typeof item !== 'string' || !item.trim()) {
        res.status(400).json({ message: 'item is required' });
        return;
    }
    const departments = Array.isArray(req.body?.departments) ? req.body.departments : [];
    const normalizedDepts = Array.from(new Set(
        departments.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
    ));
    if (normalizedDepts.length === 0) {
        res.status(400).json({ message: 'departments must include at least one department' });
        return;
    }
    const pentagonAxisRaw = req.body?.pentagon_axis;
    const pentagonAxis =
        pentagonAxisRaw === undefined || pentagonAxisRaw === null || pentagonAxisRaw === '' ? null
        : typeof pentagonAxisRaw === 'string' ? pentagonAxisRaw.trim() : null;
    const scoringType = req.body?.scoring_type === 'yes_no' ? 'yes_no' : 'numeric';
    let maxScore = null;
    if (scoringType === 'numeric') {
        const n = Number(req.body?.max_score);
        if (!Number.isFinite(n) || n <= 0) {
            res.status(400).json({ message: 'max_score must be > 0 for numeric scoring' });
            return;
        }
        maxScore = Math.round(n);
    }
    const isActive = req.body?.is_active === false ? false : true;

    const actor = req.session || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // order_no 발급: 활성 브랜드 전체 (부서 무관) max + 1
        const { rows: maxRows } = await client.query(
            `SELECT COALESCE(MAX(order_no), 0) AS max_order
               FROM public.eval_item_defs
              WHERE org_id = $1`,
            [orgId]
        );
        const nextOrderNo = (maxRows[0]?.max_order || 0) + 1;

        const inserted = [];
        for (const dept of normalizedDepts) {
            const { rows: vRows } = await client.query(
                `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM public.eval_item_defs
                  WHERE org_id = $1 AND department = $2`,
                [orgId, dept]
            );
            const nextVersion = (vRows[0]?.max_version || 0) + 1;
            const { rows: insertRows } = await client.query(
                `INSERT INTO public.eval_item_defs
                   (org_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [
                    orgId, dept, nextOrderNo, category.trim(), item.trim(),
                    criterion ?? null, prompt_template ?? null,
                    pentagonAxis, scoringType, maxScore, isActive,
                    nextVersion,
                ]
            );
            inserted.push(insertRows[0]);

            // 부서별 변경 이력
            const afterJson = {
                category: category.trim(), item: item.trim(),
                criterion: criterion ?? null,
                prompt_template: prompt_template ?? null,
                pentagon_axis: pentagonAxis,
                scoring_type: scoringType,
                max_score: maxScore,
                is_active: isActive,
                version: nextVersion,
            };
            await client.query(
                `INSERT INTO public.eval_item_change_log
                   (org_id, department, order_no, item_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, $2, $3, $4, $5, $6, 'create', NULL, $7::jsonb, $8, $9, $10)`,
                [
                    orgId, dept, nextOrderNo,
                    item.trim(), category.trim(),
                    nextVersion,
                    JSON.stringify(afterJson),
                    actor.user_id ?? null,
                    actor.login_id ?? null,
                    actor.display_name ?? null,
                ]
            );
        }

        await client.query('COMMIT');
        // 루브릭 push 훅 없음 — 백엔드(QA_RUBRIC_SOURCE=db)가 평가 시 eval_item_defs 를 직접 읽음.
        res.json({ ok: true, items: inserted, order_no: nextOrderNo });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('POST /api/admin/eval-items error:', error);
        res.status(500).json({ message: 'Failed to create eval item.' });
    } finally {
        client.release();
    }
});

/* ── Pentagon 축 ───────────────────────────────────────────── */

// GET /api/admin/pentagon-axes
// 현재 효력 중인 활성 행만 반환. 행이 없으면 빈 배열 — UI 는 brandConfig.radarLabels fallback.
app.get('/api/admin/pentagon-axes', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.json({ ok: true, axes: [] });
        return;
    }
    const department = req.query.department ? normalizeDepartment(req.query.department) : null;
    try {
        const params = [orgId];
        const where = ['org_id = $1', 'deactivated_at IS NULL', 'effective_from <= now()'];
        if (department) {
            params.push(department);
            where.push(`department = $${params.length}`);
        }
        const { rows } = await pool.query(
            `SELECT axis_no, label, description, prompt_template, is_active,
                    department, version, effective_from, deactivated_at, updated_at
             FROM public.pentagon_axes
             WHERE ${where.join(' AND ')}
             ORDER BY department ASC, axis_no ASC`,
            params
        );
        res.json({ ok: true, axes: rows });
    } catch (error) {
        console.error('GET /api/admin/pentagon-axes error:', error);
        res.status(500).json({ message: 'Failed to load pentagon axes.' });
    }
});

// POST /api/admin/pentagon-axes  — 신규 축 추가
// body: { label, description?, prompt_template?, is_active?, department? }
// axis_no = 활성 브랜드 내 max+1.
app.post('/api/admin/pentagon-axes', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const { label } = req.body || {};
    if (typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ message: 'label is required' });
        return;
    }
    const description = typeof req.body?.description === 'string' ? req.body.description : null;
    const promptTemplate = typeof req.body?.prompt_template === 'string' ? req.body.prompt_template : null;
    const isActive = req.body?.is_active === false ? false : true;
    const department = normalizeDepartment(req.body?.department);
    const actor = req.session || {};

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: maxRows } = await client.query(
            `SELECT COALESCE(MAX(axis_no), 0) AS max_axis
               FROM public.pentagon_axes
              WHERE org_id = $1 AND department = $2`,
            [orgId, department]
        );
        const nextAxisNo = (maxRows[0]?.max_axis || 0) + 1;
        const { rows: insertRows } = await client.query(
            `INSERT INTO public.pentagon_axes
               (org_id, department, axis_no, label, description, prompt_template,
                is_active, version, effective_from, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now(), now())
             RETURNING axis_no, label, description, prompt_template, is_active,
                       department, version, effective_from, deactivated_at, updated_at`,
            [orgId, department, nextAxisNo, label.trim(), description, promptTemplate, isActive]
        );
        const afterJson = {
            label: label.trim(),
            description,
            prompt_template: promptTemplate,
            is_active: isActive,
            version: 1,
        };
        await client.query(
            `INSERT INTO public.pentagon_axis_change_log
               (org_id, department, axis_no, label_snapshot, version, change_type,
                before_json, after_json,
                user_id, login_id, display_name)
             VALUES ($1, $2, $3, $4, 1, 'create', NULL, $5::jsonb, $6, $7, $8)`,
            [
                orgId, department, nextAxisNo, label.trim(),
                JSON.stringify(afterJson),
                actor.user_id ?? null,
                actor.login_id ?? null,
                actor.display_name ?? null,
            ]
        );
        await client.query('COMMIT');
        res.json({ ok: true, axis: insertRows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('POST /api/admin/pentagon-axes error:', error);
        res.status(500).json({ message: 'Failed to create pentagon axis.' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/pentagon-axes/:axisNo
// body: { label?, description?, prompt_template?, is_active?, department? }
// 활성 행 in-place UPDATE + 변경 이력 적재. is_meaning_change 옵션 없음 (PoC 단순화).
app.put('/api/admin/pentagon-axes/:axisNo', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    const axisNo = Number(req.params.axisNo);
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    if (!Number.isFinite(axisNo)) {
        res.status(400).json({ message: 'axisNo must be a number' });
        return;
    }
    const department = normalizeDepartment(req.body?.department);
    const labelRaw = req.body?.label;
    const descriptionRaw = req.body?.description;
    const promptRaw = req.body?.prompt_template;
    const isActiveRaw = req.body?.is_active;
    const actor = req.session || {};

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: activeRows } = await client.query(
            `SELECT id, version, label, description, prompt_template, is_active
               FROM public.pentagon_axes
              WHERE org_id = $1 AND department = $2 AND axis_no = $3
                AND deactivated_at IS NULL
              ORDER BY version DESC
              LIMIT 1`,
            [orgId, department, axisNo]
        );
        const activeRow = activeRows[0];

        const nextLabel = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : (activeRow?.label ?? null);
        const nextDesc = descriptionRaw === undefined ? (activeRow?.description ?? null) : (descriptionRaw || null);
        const nextPrompt = promptRaw === undefined ? (activeRow?.prompt_template ?? null) : (promptRaw || null);
        const nextActive = isActiveRaw === undefined ? (activeRow?.is_active ?? true) : (isActiveRaw === false ? false : true);

        if (!nextLabel) {
            res.status(400).json({ message: 'label is required (no existing row)' });
            await client.query('ROLLBACK');
            return;
        }

        let resultRow;
        let logChangeType = null;
        let logBefore = null;
        let logAfter = null;
        let logVersion = null;

        if (!activeRow) {
            // 활성 행 없음 → 신규 발행 (eval_item_defs 와 동일 패턴)
            const { rows: vRows } = await client.query(
                `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM public.pentagon_axes
                  WHERE org_id = $1 AND department = $2 AND axis_no = $3`,
                [orgId, department, axisNo]
            );
            const nextVersion = (vRows[0]?.max_version || 0) + 1;
            const { rows: insertRows } = await client.query(
                `INSERT INTO public.pentagon_axes
                   (org_id, department, axis_no, label, description, prompt_template,
                    is_active, version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
                 RETURNING axis_no, label, description, prompt_template, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [orgId, department, axisNo, nextLabel, nextDesc, nextPrompt, nextActive, nextVersion]
            );
            resultRow = insertRows[0];
            logChangeType = 'create';
            logAfter = {
                label: nextLabel, description: nextDesc,
                prompt_template: nextPrompt, is_active: nextActive,
                version: nextVersion,
            };
            logVersion = nextVersion;
        } else {
            const { rows: updateRows } = await client.query(
                `UPDATE public.pentagon_axes
                    SET label           = $1,
                        description     = $2,
                        prompt_template = $3,
                        is_active       = $4,
                        updated_at      = now()
                  WHERE id = $5
                 RETURNING axis_no, label, description, prompt_template, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                [nextLabel, nextDesc, nextPrompt, nextActive, activeRow.id]
            );
            resultRow = updateRows[0];

            const changedFields = {};
            const fieldMap = {
                label: nextLabel,
                description: nextDesc,
                prompt_template: nextPrompt,
                is_active: nextActive,
            };
            for (const [key, newVal] of Object.entries(fieldMap)) {
                const oldVal = activeRow[key] ?? null;
                if ((oldVal ?? null) !== (newVal ?? null)) {
                    changedFields[key] = { before: oldVal, after: newVal };
                }
            }
            if (Object.keys(changedFields).length > 0) {
                const before = {};
                const after = {};
                for (const [k, v] of Object.entries(changedFields)) {
                    before[k] = v.before;
                    after[k] = v.after;
                }
                if (changedFields.is_active !== undefined && Object.keys(changedFields).length === 1) {
                    logChangeType = nextActive ? 'reactivate' : 'deactivate';
                } else if (changedFields.label) logChangeType = 'label_rename';
                else if (changedFields.prompt_template) logChangeType = 'prompt_update';
                else logChangeType = 'description_update';
                logBefore = before;
                logAfter = after;
                logVersion = activeRow.version;
            }
        }

        if (logChangeType) {
            await client.query(
                `INSERT INTO public.pentagon_axis_change_log
                   (org_id, department, axis_no, label_snapshot, version, change_type,
                    before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
                [
                    orgId, department, axisNo, nextLabel,
                    logVersion, logChangeType,
                    logBefore ? JSON.stringify(logBefore) : null,
                    logAfter ? JSON.stringify(logAfter) : null,
                    actor.user_id ?? null,
                    actor.login_id ?? null,
                    actor.display_name ?? null,
                ]
            );
        }

        await client.query('COMMIT');
        res.json({ ok: true, axis: resultRow });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('PUT /api/admin/pentagon-axes/:axisNo error:', error);
        res.status(500).json({ message: 'Failed to save pentagon axis.' });
    } finally {
        client.release();
    }
});

// GET /api/admin/eval-item-history
// query: ?department=...&change_type=...&limit=...  (모두 옵션)
// 활성 브랜드의 전체 평가항목 변경 이력 (시간순 DESC). 항목 한정 X.
// item_name / category_name 은 변경 시점의 스냅샷이라 항목 삭제 후에도 표시 가능.
app.get('/api/admin/eval-item-history', async (req, res) => {
    const orgId = resolveActiveOrgId(req);
    if (orgId === null || orgId === undefined) {
        res.json({ ok: true, entries: [] });
        return;
    }
    const department = req.query.department ? normalizeDepartment(req.query.department) : null;
    const changeType = typeof req.query.change_type === 'string' ? req.query.change_type : null;
    const limit = Number(req.query.limit);
    const effectiveLimit = Number.isFinite(limit) && limit > 0 && limit <= 500 ? limit : 200;
    try {
        const params = [orgId];
        const where = ['org_id = $1'];
        if (department) {
            params.push(department);
            where.push(`department = $${params.length}`);
        }
        if (changeType) {
            params.push(changeType);
            where.push(`change_type = $${params.length}`);
        }
        params.push(effectiveLimit);
        const { rows } = await pool.query(
            `SELECT id, department, order_no, item_name, category_name,
                    change_type, version, before_json, after_json,
                    user_id, login_id, display_name, changed_at
               FROM public.eval_item_change_log
              WHERE ${where.join(' AND ')}
              ORDER BY changed_at DESC
              LIMIT $${params.length}`,
            params
        );
        res.json({ ok: true, entries: rows });
    } catch (error) {
        console.error('GET /api/admin/eval-item-history error:', error);
        res.status(500).json({ message: 'Failed to load eval item history.' });
    }
});

/* SAMPLE_UPLOAD_FEATURE — 임시 기능. 제거 시 본 블록 전체 삭제 + import 라인 삭제 */
app.post('/api/sample-ingest', async (req, res) => {
    const input = req.body?.input;
    const output = req.body?.output;
    if (!input || typeof input !== 'object' || !output || typeof output !== 'object') {
        res.status(400).json({ message: 'input/output JSON 두 개가 모두 필요합니다.' });
        return;
    }
    try {
        const result = await ingestSampleToDb(pool, input, output);
        if (!result.ok) {
            res.status(400).json({ message: result.message });
            return;
        }
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.SAMPLE_INGEST,
            resource_type: 'qa_call',
            resource_id: String(result.qa_id ?? result.call_seq ?? '(new)').slice(0, 256),
            http_method: 'POST',
            http_path: '/api/sample-ingest',
            detail_json: JSON.stringify({ inserted: result.inserted ?? null }),
            success: true,
        });
        res.json(result);
    } catch (error) {
        console.error('POST /api/sample-ingest error:', error);
        res.status(500).json({ message: String(error?.message || error) });
    }
});

app.delete('/api/sample-ingest', async (req, res) => {
    try {
        const result = await clearSamplesFromDb(pool);
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.SAMPLE_CLEAR,
            resource_type: 'qa_call',
            resource_id: 'sample-bulk',
            http_method: 'DELETE',
            http_path: '/api/sample-ingest',
            detail_json: JSON.stringify({ deleted: result.deleted ?? null }),
            success: true,
        });
        res.json(result);
    } catch (error) {
        console.error('DELETE /api/sample-ingest error:', error);
        res.status(500).json({ message: String(error?.message || error) });
    }
});

// AI Canvas pull 동기화 — body 의 url + api_key (또는 환경변수) 로 외부 데이터셋을 GET 한 뒤
// 각 행의 payload(JSON 문자열) 를 풀어 컬렉션관리부 콜로 적재.
app.post('/api/ingest/from-ai-canvas', async (req, res) => {
    const url = String(req.body?.url || process.env.AI_CANVAS_DATASET_URL || '').trim();
    const apiKey = (String(req.body?.api_key || process.env.AI_CANVAS_API_KEY || '').trim()) || null;
    if (!url) {
        res.status(400).json({
            ok: false,
            message: 'url 이 필요합니다. body 의 url 또는 AI_CANVAS_DATASET_URL 환경변수.',
        });
        return;
    }
    try {
        const result = await fetchAndIngestFromAiCanvas(pool, { url, apiKey });
        if (!result.ok) {
            res.status(502).json(result);
            return;
        }
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.INGEST_AI_CANVAS,
            resource_type: 'qa_call',
            resource_id: String(result.inserted ?? result.count ?? 'bulk').slice(0, 256),
            http_method: 'POST',
            http_path: '/api/ingest/from-ai-canvas',
            detail_json: JSON.stringify({ url, inserted: result.inserted ?? null }).slice(0, 8000),
            success: true,
        });
        res.json(result);
    } catch (error) {
        console.error('POST /api/ingest/from-ai-canvas error:', error);
        res.status(500).json({ ok: false, message: String(error?.message || error) });
    }
});

// 외부 API 연동용 ingest — 컬렉션관리부 1콜.
// 명세: docs/EXTERNAL_API_GUIDE.md (JSON / CSV 형식, 직무별 만점 매트릭스, 화면 반영 흐름).
app.post('/api/ingest/collection-call', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
        res.status(400).json({ ok: false, message: 'JSON body 가 필요합니다.' });
        return;
    }
    try {
        const result = await ingestCollectionCallToDb(pool, body);
        if (!result.ok) {
            res.status(400).json(result);
            return;
        }
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.INGEST_COLLECTION_CALL,
            resource_type: 'qa_call',
            resource_id: String(result.qa_id ?? result.call_seq ?? '(new)').slice(0, 256),
            http_method: 'POST',
            http_path: '/api/ingest/collection-call',
            success: true,
        });
        res.json(result);
    } catch (error) {
        console.error('POST /api/ingest/collection-call error:', error);
        res.status(500).json({ ok: false, message: String(error?.message || error) });
    }
});

// qa-pipeline (/evaluate) 연동 ingest — body.calls[] 각 콜을 순차로 평가→환산→적재.
// 각 call: { qa_id|consultation_id|id, transcript, cdate, department, role, org_id, call_seq, uid }.
// QA_PIPELINE_BASE_URL 환경변수(기본 http://localhost:8081) 의 POST /evaluate 호출.
app.post('/api/ingest/from-qa-pipeline', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
        res.status(400).json({ ok: false, message: 'JSON body 가 필요합니다.' });
        return;
    }
    const calls = Array.isArray(body.calls) ? body.calls : body.call ? [body.call] : [];
    if (!calls.length) {
        res.status(400).json({ ok: false, message: 'calls 배열(또는 call 객체)이 필요합니다.' });
        return;
    }
    // base_url 은 명시적 body override 일 때만 전달 — env/call.pipeline_target(로컬/EC2) 해석은
    // qaPipelineIngest.resolvePipelineBaseUrl 담당 (여기서 env 를 주입하면 EC2 분기가 무력화됨).
    const baseUrl = String(body.base_url || '').trim() || undefined;
    // track: 'standard'(기본, 표준 18항목 직결 적재) | 'collection'(9-order 환산, 기존 동작).
    const track = String(body.track || 'standard').trim().toLowerCase();

    const failed = [];
    const skipped = [];
    const details = [];
    let ingested = 0;
    for (const call of calls) {
        const qaIdHint = String(call?.qa_id ?? call?.consultation_id ?? call?.id ?? '').trim();
        try {
            const result =
                track === 'collection'
                    ? await ingestCallFromQaPipeline(pool, call, { baseUrl })
                    : await ingestStandardCallFromQaPipeline(pool, call, { baseUrl });
            if (!result.ok) {
                failed.push({ qa_id: qaIdHint, reason: result.message, warnings: result.warnings });
                continue;
            }
            // 포기호/미응대 — 적재 안 됨(qa_calls 미생성). 실패가 아니라 건너뜀으로 분류.
            if (result.skipped) {
                skipped.push({ qa_id: result.qa_id || qaIdHint, reason: result.reason });
                continue;
            }
            ingested += 1;
            details.push({
                qa_id: result.qa_id,
                role: result.role,
                ai_score: result.ai_score,
                total_score: result.total_score,
                elapsed_sec: result.elapsed_sec,
                warnings: result.warnings,
                // 루브릭 트랙(standard) 부가: 원점수 합/만점 합. collection 트랙은 undefined → 생략.
                raw_total: result.raw_total,
                max_total: result.max_total,
            });
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.INGEST_QA_PIPELINE,
                resource_type: 'qa_call',
                resource_id: String(result.qa_id ?? '(new)').slice(0, 256),
                http_method: 'POST',
                http_path: '/api/ingest/from-qa-pipeline',
                detail_json: JSON.stringify({
                    elapsed_sec: result.elapsed_sec ?? null,
                    warnings: result.warnings ?? [],
                    source: result.source ?? null,
                }).slice(0, 8000),
                success: true,
            });
        } catch (error) {
            failed.push({ qa_id: qaIdHint, reason: String(error?.message || error) });
        }
    }

    res.json({ ok: failed.length === 0, ingested, skipped, failed, details });
});

// ── qa-pipeline 평가 비동기 잡 — SSE 노드 진행상황 중계 ──
// POST 가 즉시 job_id 를 반환하고, 서버가 /evaluate/stream 을 소비하며 진행상황을 메모리에 보관.
// FE(SampleUploadModal)가 GET /:jobId 를 폴링해 노드 단위 진행을 표시. 완료 시 적재 결과 포함.
// 잡은 인메모리(컨테이너 재시작 시 소실) + 1시간 TTL 정리.
const qaPipelineJobs = new Map();
const QA_PIPELINE_JOB_TTL_MS = 60 * 60 * 1000;

function sweepQaPipelineJobs() {
    const now = Date.now();
    for (const [id, job] of qaPipelineJobs) {
        if (now - job.created_at > QA_PIPELINE_JOB_TTL_MS) qaPipelineJobs.delete(id);
    }
}

app.post('/api/ingest/qa-pipeline-jobs', async (req, res) => {
    sweepQaPipelineJobs();
    const body = req.body;
    const call =
        body && typeof body === 'object' ? body.call || (Array.isArray(body.calls) ? body.calls[0] : null) : null;
    if (!call || typeof call !== 'object') {
        res.status(400).json({ ok: false, message: 'call 객체가 필요합니다.' });
        return;
    }
    const track = String(body.track || 'standard').trim().toLowerCase();
    const jobId = randomUUID();
    const job = {
        job_id: jobId,
        status: 'running',
        qa_id: String(call?.qa_id ?? call?.consultation_id ?? call?.id ?? '').trim(),
        pipeline_target: String(call?.pipeline_target || 'local').trim().toLowerCase(),
        track,
        created_at: Date.now(),
        finished_at: null,
        progress: { nodes_done: 0, running_nodes: [], recent_done: [], last_event_at: null },
        result: null,
        error: null,
    };
    qaPipelineJobs.set(jobId, job);

    const doneNodes = new Set();
    // 진행 표시 제외 노드 — 대시보드 경량 모드에서 스킵되는 기능(ksqi/debate/kms/narrator/GT)과
    // 내부 플럼빙(barrier 등). 0초 완료 이벤트가 단계 수를 부풀리고 "KSQI 평가" 같은
    // 꺼진 기능명이 노출되는 것을 방지.
    const PROGRESS_HIDDEN_NODE = /^(ksqi|gt_)|_barrier$|^(debate|kms|consumer_detect|hitl_queue_populator|combined_report|report_narrator)$/;
    const onProgress = (ev) => {
        const node = String(ev?.node || '').trim();
        if (!node) return;
        if (PROGRESS_HIDDEN_NODE.test(node)) return;
        const p = job.progress;
        p.last_event_at = Date.now();
        if (ev?.status === 'started') {
            if (!p.running_nodes.includes(node)) p.running_nodes.push(node);
        } else if (ev?.status === 'completed') {
            p.running_nodes = p.running_nodes.filter((n) => n !== node);
            if (!doneNodes.has(node)) {
                doneNodes.add(node);
                p.nodes_done += 1;
                p.recent_done.push(node);
                if (p.recent_done.length > 8) p.recent_done = p.recent_done.slice(-8);
            }
        }
    };

    (async () => {
        try {
            const result =
                track === 'collection'
                    ? await ingestCallFromQaPipeline(pool, call, { onProgress })
                    : await ingestStandardCallFromQaPipeline(pool, call, { onProgress });
            if (!result.ok) {
                job.status = 'error';
                job.error = result.message || '적재 실패';
                return;
            }
            // 포기호/미응대 — 적재 안 됨. 에러가 아니라 건너뜀으로 완료 처리.
            if (result.skipped) {
                job.status = 'done';
                job.result = { qa_id: result.qa_id, skipped: true, reason: result.reason };
                return;
            }
            job.status = 'done';
            job.result = {
                qa_id: result.qa_id,
                role: result.role,
                ai_score: result.ai_score,
                total_score: result.total_score,
                elapsed_sec: result.elapsed_sec,
                warnings: result.warnings,
                raw_total: result.raw_total,
                max_total: result.max_total,
            };
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.INGEST_QA_PIPELINE,
                resource_type: 'qa_call',
                resource_id: String(result.qa_id ?? '(new)').slice(0, 256),
                http_method: 'POST',
                http_path: '/api/ingest/qa-pipeline-jobs',
                detail_json: JSON.stringify({
                    elapsed_sec: result.elapsed_sec ?? null,
                    warnings: result.warnings ?? [],
                    source: result.source ?? null,
                }).slice(0, 8000),
                success: true,
            });
        } catch (error) {
            job.status = 'error';
            job.error = String(error?.message || error);
        } finally {
            job.finished_at = Date.now();
        }
    })();

    res.json({ ok: true, job_id: jobId });
});

app.get('/api/ingest/qa-pipeline-jobs/:jobId', (req, res) => {
    const job = qaPipelineJobs.get(String(req.params.jobId || ''));
    if (!job) {
        res.status(404).json({ ok: false, message: '잡을 찾을 수 없습니다 (만료/서버 재시작 가능성).' });
        return;
    }
    res.json({
        ok: true,
        job: {
            job_id: job.job_id,
            status: job.status,
            qa_id: job.qa_id,
            pipeline_target: job.pipeline_target,
            track: job.track,
            progress: job.progress,
            result: job.result,
            error: job.error,
            created_at: job.created_at,
            finished_at: job.finished_at,
        },
    });
});

async function bootstrap() {
    // 스키마·관리자 계정·시드 데이터는 docker/init/postgres/01_init.sql 이 PostgreSQL 첫 부팅 시 단일 책임으로 import.
    // 기존 볼륨용 idempotent 마이그레이션 — qa_calls.is_sandbox 컬럼.
    // 운영 행과 sandbox 행을 컬럼 단위로 분리해, sandbox 정리(DELETE WHERE is_sandbox=true)가 운영 데이터를 절대 건드리지 못하게 한다.
    await pool.query(`
        ALTER TABLE qa_calls ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS idx_qa_calls_is_sandbox ON qa_calls(is_sandbox) WHERE is_sandbox = true;
    `);

    // 운영 행이 0건이면 부팅을 시끄럽게 — 빈 DB 로 컨테이너만 살아 있는 사고를 콘솔에서 즉시 인지.
    try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM qa_calls WHERE is_sandbox = false`);
        const prodCount = rows[0]?.n ?? 0;
        if (prodCount === 0) {
            console.warn('[qa-api] ⚠ qa_calls 의 운영 행(is_sandbox=false)이 0건입니다. 신규 볼륨/시드 미적용/대량 삭제 사고 가능성 확인 필요.');
        } else {
            console.log(`[qa-api] qa_calls production rows: ${prodCount}`);
        }
    } catch (err) {
        console.error('[qa-api] qa_calls production-row 카운트 점검 실패:', err);
    }
}

/* ── [MERGE from old2-05, additive] 코칭 배정 / 알림 / TA 지표 ─────────────────
 *   coaching_assignments(mig 26) · notifications(mig 28) · qa_call_recovery(mig 31) + taSource.
 *   우리 기존 라우트/로직 불변. admin_users(테이블) 만 참조 — users/trainee(mig 29/30) 미의존. */

/* ── Tutor 시나리오 카탈로그(코칭 배정용) ───────────────────────
 * GET /api/tutor/scenarios
 * 평가항목 공유의 거울: SSOT(시나리오)=Tutor, QA 가 읽어옴.
 * 활성 org_id → Tutor `GET /svc/scenarios?qa_org_id=` 호출(X-Service-Token=EVAL_SHARE_TOKEN).
 * 매핑 키는 평가항목과 동일한 organizations.qa_org_id. 미설정/미페어링 시 빈 카탈로그.
 * ────────────────────────────────────────────────────────── */
app.get('/api/tutor/scenarios', requireAdmin, async (req, res) => {
    const base = String(process.env.TUTOR_API_BASE_URL || '').trim().replace(/\/+$/, '');
    const token = String(process.env.EVAL_SHARE_TOKEN || '').trim();
    if (!base || !token) {
        // 연동 미설정 — 화면은 빈 카탈로그 + 안내로 폴백.
        res.json({ enabled: false, org_id: null, categories: [], scenarios: [] });
        return;
    }
    const orgId = resolveActiveOrgId(req);
    if (orgId == null) {
        res.json({ enabled: true, org_id: null, categories: [], scenarios: [] });
        return;
    }
    try {
        const url = `${base}/svc/scenarios?qa_org_id=${encodeURIComponent(orgId)}`;
        const r = await fetch(url, {
            headers: { 'X-Service-Token': token },
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
            console.error(`GET /api/tutor/scenarios upstream HTTP ${r.status}`);
            res.status(502).json({ enabled: true, message: 'tutor upstream error', categories: [], scenarios: [] });
            return;
        }
        const data = await r.json();
        res.json({
            enabled: true,
            org_id: data.org_id ?? null,
            categories: Array.isArray(data.categories) ? data.categories : [],
            scenarios: Array.isArray(data.scenarios) ? data.scenarios : [],
        });
    } catch (error) {
        console.error('GET /api/tutor/scenarios error:', error);
        res.status(500).json({ enabled: true, message: 'Failed to load tutor scenarios', categories: [], scenarios: [] });
    }
});

function toCoachingRow(row) {
    const dt = row.assigned_at ? new Date(row.assigned_at) : null;
    const valid = dt && !Number.isNaN(dt.getTime());
    const assignedAt = valid ? dt.toISOString().slice(0, 10) : null;
    return {
        key: String(row.id),
        id: row.id,
        title: row.title,
        targetType: row.target_type,
        members: Array.isArray(row.members) ? row.members : [],
        items: Array.isArray(row.action_items) ? row.action_items : [],
        scenarios: Array.isArray(row.scenario_codes) ? row.scenario_codes : [],
        channel: row.channel === 'chat' ? 'chat' : 'call',
        assigned: true,
        status: '배정됨',
        assignedBy: row.assigned_by_name || '관리자',
        assignedAt,
        assignedAtIso: valid ? dt.toISOString() : null,
    };
}

app.get('/api/coaching', requireAdmin, async (req, res) => {
    try {
        const orgId = resolveActiveOrgId(req);
        const params = [];
        const conds = ['g.archived_at IS NULL'];   // 보드에서 정리(X)한 코칭은 제외(코칭 이력엔 유지).
        if (orgId != null) {
            params.push(orgId);
            conds.push(`g.org_id = $${params.length}`);
        }
        const where = `WHERE ${conds.join(' AND ')}`;
        const { rows } = await pool.query(
            `SELECT g.*, au.display_name AS assigned_by_name,
                    (SELECT array_agg(mu.login_id) FROM public.admin_users mu WHERE mu.user_id = ANY(g.members)) AS member_logins
               FROM public.coaching_assignments g
               LEFT JOIN public.admin_users au ON au.user_id = g.assigned_by_user_id
               ${where}
              ORDER BY g.created_at DESC`,
            params
        );
        // 진행률 — 멤버별 튜터(02) 완료 조회 후 '전원 완료' 집계. 튜터 미연동/실패 시 진행률 미상(null) → X(정리) 미노출.
        const out = await Promise.all(rows.map(async (row) => {
            const base = toCoachingRow(row);
            const logins = Array.isArray(row.member_logins) ? row.member_logins.filter(Boolean) : [];
            const membersTotal = logins.length;
            let membersDone = 0;
            let measurable = membersTotal > 0 && base.scenarios.length > 0;
            if (measurable) {
                const comps = await Promise.all(logins.map((lid) =>
                    fetchTutorCompletion(lid, base.scenarios, base.channel, base.assignedAtIso)));
                if (comps.some((c) => c == null)) measurable = false;       // 일부라도 조회 실패면 미상 처리
                else membersDone = comps.filter((c) => c.total > 0 && c.done >= c.total).length;
            }
            return {
                ...base,
                membersTotal,
                membersDone: measurable ? membersDone : null,
                allDone: measurable && membersTotal > 0 && membersDone === membersTotal,
            };
        }));
        res.json(out);
    } catch (error) {
        console.error('GET /api/coaching error:', error);
        res.status(500).json({ message: 'Failed to load coaching.' });
    }
});

// 튜터(02) 서비스 API 로 한 멤버의 코칭 시나리오 완료수 조회. 미연동/실패 시 null.
async function fetchTutorCompletion(loginId, codes, channel, sinceIso) {
    const base = String(process.env.TUTOR_API_BASE_URL || '').trim().replace(/\/+$/, '');
    const token = String(process.env.EVAL_SHARE_TOKEN || '').trim();
    if (!base || !token || !loginId || !Array.isArray(codes) || codes.length === 0) return null;
    try {
        const qs = new URLSearchParams({ user_id: String(loginId), codes: codes.join(','), channel: channel || 'call' });
        if (sinceIso) qs.set('since', sinceIso);
        const r = await fetch(`${base}/svc/coaching-completion?${qs.toString()}`, {
            headers: { 'X-Service-Token': token },
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        return { done: Number(d.done) || 0, total: Number(d.total) || codes.length, completed: Array.isArray(d.completed) ? d.completed : [] };
    } catch {
        return null;  // 튜터 미가동/타임아웃 — 이력은 완료수 없이 점수만 표시
    }
}

// 코칭 이력 — 코칭배정 × 멤버. 멤버의 배정 전/후 평균점수(qa_calls) + 튜터 시나리오 완료수(02 연동).
app.get('/api/coaching/history', requireAdmin, async (req, res) => {
    try {
        const orgId = resolveActiveOrgId(req);
        const params = [];
        let where = '';
        if (orgId != null) {
            params.push(orgId);
            where = `WHERE g.org_id = $${params.length}`;
        }
        const { rows } = await pool.query(
            `SELECT
                 g.id          AS coaching_id,
                 g.title       AS title,
                 g.assigned_at AS assigned_at,
                 g.channel     AS channel,
                 g.scenario_codes AS scenario_codes,
                 COALESCE(cardinality(g.scenario_codes), 0) AS scenarios,
                 ab.display_name AS by_name,
                 m.member_uid  AS member_uid,
                 mu.display_name AS member_name,
                 mu.login_id   AS member_login,
                 mu.department   AS member_team,
                 sc.before_avg AS before_avg,
                 sc.after_avg  AS after_avg
               FROM public.coaching_assignments g
               CROSS JOIN LATERAL unnest(g.members) AS m(member_uid)
               LEFT JOIN public.admin_users ab ON ab.user_id = g.assigned_by_user_id
               LEFT JOIN public.admin_users mu ON mu.user_id = m.member_uid
               LEFT JOIN LATERAL (
                   SELECT
                       round(avg(qc."TOTAL_SCORE") FILTER (WHERE qc."CDATE"::timestamptz <  g.assigned_at))::int AS before_avg,
                       round(avg(qc."TOTAL_SCORE") FILTER (WHERE qc."CDATE"::timestamptz >= g.assigned_at))::int AS after_avg
                     FROM public.qa_calls qc
                    WHERE qc.agent_user_id = m.member_uid
                      AND qc."CDATE" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'   -- 캐스팅 안전(형식 보장)
                      AND qc."TOTAL_SCORE" IS NOT NULL
               ) sc ON TRUE
               ${where}
              ORDER BY g.assigned_at DESC, g.id DESC`,
            params
        );
        const out = await Promise.all(rows.map(async (r) => {
            const dt = r.assigned_at ? new Date(r.assigned_at) : null;
            const valid = dt && !Number.isNaN(dt.getTime());
            const date = valid ? dt.toISOString().slice(0, 10) : '';
            const before = r.before_avg == null ? null : Number(r.before_avg);
            const after = r.after_avg == null ? null : Number(r.after_avg);
            const channel = r.channel === 'chat' ? 'chat' : 'call';
            const codes = Array.isArray(r.scenario_codes) ? r.scenario_codes : [];
            // 튜터(02)에서 이 멤버의 시나리오 완료수 조회(해당 채널·배정 이후). 미연동 시 null.
            const comp = await fetchTutorCompletion(r.member_login, codes, channel, valid ? dt.toISOString() : null);
            return {
                id: `${r.coaching_id}-${r.member_uid}`,
                counselorId: r.member_uid,
                counselorName: r.member_name || String(r.member_uid),
                team: r.member_team || '-',
                area: r.title,
                date,
                by: r.by_name || '관리자',
                channel,
                scenarios: Number(r.scenarios) || 0,
                done: comp ? comp.done : null,          // 완료 시나리오 수(튜터). null=미연동/조회불가
                scoreBefore: before,
                scoreAfter: after,
                hasAfter: after != null,  // 배정 후 콜 존재(효과측정 가능) 여부
            };
        }));
        res.json(out);
    } catch (error) {
        console.error('GET /api/coaching/history error:', error);
        res.status(500).json({ message: 'Failed to load coaching history.' });
    }
});

app.post('/api/coaching', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const title = String(b.title || '').trim();
        const targetType = b.targetType === 'individual' ? 'individual' : 'group';
        const members = Array.isArray(b.members) ? b.members.map((x) => Number(x)).filter(Number.isFinite) : [];
        const items = Array.isArray(b.items) ? b.items.map((x) => String(x)).filter((x) => x.trim()) : [];
        // 배정 시나리오는 개수 제한 없음(관리자가 많이 줄 수 있음). 튜터가 한 번에 3개씩 소거하며 진행.
        const scenarios = Array.isArray(b.scenarios) ? b.scenarios.map((x) => String(x)).filter(Boolean) : [];
        const channel = b.channel === 'chat' ? 'chat' : 'call';
        if (!title) {
            res.status(400).json({ message: 'title is required' });
            return;
        }
        if (!members.length) {
            res.status(400).json({ message: '대상 상담사를 1명 이상 선택하세요.' });
            return;
        }
        const orgId = resolveActiveOrgId(req);
        const { rows } = await pool.query(
            `INSERT INTO public.coaching_assignments
                 (org_id, title, target_type, members, action_items, scenario_codes, channel, assigned_by_user_id)
             VALUES ($1, $2, $3, $4::int[], $5::text[], $6::text[], $7, $8)
             RETURNING *`,
            [orgId, title, targetType, members, items, scenarios, channel, req.session?.user_id ?? null]
        );
        const created = rows[0];
        // 배정 대상 상담사에게 코칭 배정 알림.
        for (const memberId of members) {
            await createNotification(pool, {
                recipientUserId: memberId,
                type: 'coaching_assigned',
                title: '새 코칭이 배정되었습니다',
                body: scenarios.length ? `'${title}' · 시나리오 ${scenarios.length}개` : `'${title}'`,
                resourceType: 'coaching',
                resourceId: String(created.id),
                actorUserId: req.session?.user_id ?? null,
                actorName: req.session?.display_name || req.session?.login_id || null,
                orgId,
            });
        }
        res.status(201).json(toCoachingRow({ ...created, assigned_by_name: req.session?.display_name || null }));
    } catch (error) {
        console.error('POST /api/coaching error:', error);
        res.status(500).json({ message: 'Failed to create coaching.' });
    }
});

app.delete('/api/coaching/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const orgId = resolveActiveOrgId(req);
        const params = [id];
        let scope = '';
        if (orgId != null) {
            params.push(orgId);
            scope = ` AND org_id = $${params.length}`;
        }
        const { rowCount } = await pool.query(
            `DELETE FROM public.coaching_assignments WHERE id = $1${scope}`,
            params
        );
        res.json({ ok: true, deleted: rowCount });
    } catch (error) {
        console.error('DELETE /api/coaching error:', error);
        res.status(500).json({ message: 'Failed to delete coaching.' });
    }
});

// 코칭 보드에서 정리(숨김) — archived_at 세팅. 레코드는 보존(코칭 이력엔 계속 노출). 전원 학습완료 카드의 'X'.
app.post('/api/coaching/:id/archive', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const orgId = resolveActiveOrgId(req);
        const params = [id];
        let scope = '';
        if (orgId != null) {
            params.push(orgId);
            scope = ` AND org_id = $${params.length}`;
        }
        const { rowCount } = await pool.query(
            `UPDATE public.coaching_assignments SET archived_at = now() WHERE id = $1${scope}`,
            params
        );
        if (!rowCount) {
            res.status(404).json({ message: 'not found' });
            return;
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('POST /api/coaching/:id/archive error:', error);
        res.status(500).json({ message: 'Failed to archive coaching.' });
    }
});

// 상담사 본인 보드에서 정리(숨김) — member_archived 에 본인 user_id 추가. 그룹의 다른 멤버·관리자엔 영향 없음. 코칭 이력엔 유지.
app.post('/api/coaching/:id/archive-mine', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) {
            res.status(401).json({ message: 'authentication required' });
            return;
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        // 본인이 멤버인 코칭만 — array_append(중복 방지).
        const { rowCount } = await pool.query(
            `UPDATE public.coaching_assignments
                SET member_archived = (
                    SELECT array_agg(DISTINCT x) FROM unnest(array_append(member_archived, $2)) AS x
                )
              WHERE id = $1 AND $2 = ANY(members)`,
            [id, uid]
        );
        if (!rowCount) {
            res.status(404).json({ message: 'not found' });
            return;
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('POST /api/coaching/:id/archive-mine error:', error);
        res.status(500).json({ message: 'Failed to archive coaching.' });
    }
});

app.get('/api/coaching/mine', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) {
            res.json([]);
            return;
        }
        const { rows } = await pool.query(
            `SELECT g.*, au.display_name AS assigned_by_name,
                    sc.before_avg, sc.after_avg
               FROM public.coaching_assignments g
               LEFT JOIN public.admin_users au ON au.user_id = g.assigned_by_user_id
               LEFT JOIN LATERAL (
                   SELECT
                       round(avg(qc."TOTAL_SCORE") FILTER (WHERE qc."CDATE"::timestamptz <  g.assigned_at))::int AS before_avg,
                       round(avg(qc."TOTAL_SCORE") FILTER (WHERE qc."CDATE"::timestamptz >= g.assigned_at))::int AS after_avg
                     FROM public.qa_calls qc
                    WHERE qc.agent_user_id = $1
                      AND qc."CDATE" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                      AND qc."TOTAL_SCORE" IS NOT NULL
               ) sc ON TRUE
              WHERE $1 = ANY(g.members)
              ORDER BY g.created_at DESC`,
            [uid]
        );
        // 카드 진행률/완료(취소선)용 — 본인이 그 채널로 배정 이후 완료한 시나리오 코드(튜터 02 연동, 미연동/실패 시 빈 배열).
        const loginId = req.session?.login_id || null;
        const out = await Promise.all(rows.map(async (row) => {
            const base = toCoachingRow(row);
            const comp = await fetchTutorCompletion(loginId, base.scenarios, base.channel, base.assignedAtIso);
            const before = row.before_avg == null ? null : Number(row.before_avg);
            const after = row.after_avg == null ? null : Number(row.after_avg);
            const done = comp?.done ?? 0;
            const total = comp?.total ?? base.scenarios.length;
            // 완료 최초 감지 시 배정자(관리자)에게 1회 알림. 기존 notifications 로 (코칭,완료자) 중복 방지.
            if (total > 0 && done >= total && row.assigned_by_user_id != null && row.assigned_by_user_id !== uid) {
                try {
                    const { rows: exist } = await pool.query(
                        `SELECT 1 FROM public.notifications
                          WHERE type = 'coaching_completed' AND resource_id = $1 AND actor_user_id = $2 LIMIT 1`,
                        [String(row.id), uid]
                    );
                    if (!exist.length) {
                        await createNotification(pool, {
                            recipientUserId: row.assigned_by_user_id,
                            type: 'coaching_completed',
                            title: '코칭이 완료되었습니다',
                            body: `${req.session?.display_name || '상담사'}님이 '${base.title}' 코칭을 완료했습니다 (${done}/${total})`,
                            resourceType: 'coaching',
                            resourceId: String(row.id),
                            actorUserId: uid,
                            actorName: req.session?.display_name || req.session?.login_id || null,
                            orgId: row.org_id ?? null,
                        });
                    }
                } catch (e) {
                    console.error('coaching_completed notify error:', e);
                }
            }
            const memberArchived = Array.isArray(row.member_archived) && row.member_archived.includes(uid);
            return {
                ...base,
                completed: comp?.completed || [], done, total,
                scoreBefore: before, scoreAfter: after, hasAfter: after != null,
                memberArchived,  // 본인이 보드에서 치움 → 보드 제외, 코칭 이력엔 유지
            };
        }));
        res.json(out);
    } catch (error) {
        console.error('GET /api/coaching/mine error:', error);
        res.status(500).json({ message: 'Failed to load my coaching.' });
    }
});

const NOTIF_WINDOW_DAYS = 30;

function toNotificationRow(r) {
    return {
        id: Number(r.id),
        type: r.type,
        title: r.title,
        body: r.body ?? null,
        resource_type: r.resource_type ?? null,
        resource_id: r.resource_id ?? null,
        actor_name: r.actor_name ?? null,
        read: r.read_at != null,
        created_at: r.created_at,
    };
}

app.get('/api/notifications', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) { res.json([]); return; }
        const scope = String(req.query.scope || 'all');
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const params = [uid, `${NOTIF_WINDOW_DAYS} days`];
        let where = `recipient_user_id = $1 AND created_at >= now() - $2::interval`;
        if (scope === 'current') where += ` AND read_at IS NULL`;
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT * FROM public.notifications WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
            params
        );
        res.json(rows.map(toNotificationRow));
    } catch (error) {
        console.error('GET /api/notifications error:', error);
        res.status(500).json({ message: 'Failed to load notifications.' });
    }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) { res.json({ count: 0 }); return; }
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS count FROM public.notifications WHERE recipient_user_id = $1 AND read_at IS NULL`,
            [uid]
        );
        res.json({ count: rows[0]?.count ?? 0 });
    } catch (error) {
        console.error('GET /api/notifications/unread-count error:', error);
        res.status(500).json({ count: 0 });
    }
});

app.post('/api/notifications/read', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
        await pool.query(
            `UPDATE public.notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL`,
            [uid]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error('POST /api/notifications/read error:', error);
        res.status(500).json({ message: 'failed' });
    }
});

app.post('/api/notifications/:id/read', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        const id = Number(req.params.id);
        if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
        if (!Number.isFinite(id)) { res.status(400).json({ message: 'invalid id' }); return; }
        await pool.query(
            `UPDATE public.notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_user_id = $2`,
            [id, uid]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error('POST /api/notifications/:id/read error:', error);
        res.status(500).json({ message: 'failed' });
    }
});

app.delete('/api/notifications/:id', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        const id = Number(req.params.id);
        if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
        if (!Number.isFinite(id)) { res.status(400).json({ message: 'invalid id' }); return; }
        const { rowCount } = await pool.query(
            `DELETE FROM public.notifications WHERE id = $1 AND recipient_user_id = $2`,
            [id, uid]
        );
        res.json({ ok: true, deleted: rowCount });
    } catch (error) {
        console.error('DELETE /api/notifications/:id error:', error);
        res.status(500).json({ message: 'failed' });
    }
});

app.delete('/api/notifications', async (req, res) => {
    try {
        const uid = req.session?.user_id;
        if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
        const { rowCount } = await pool.query(
            `DELETE FROM public.notifications WHERE recipient_user_id = $1`,
            [uid]
        );
        res.json({ ok: true, deleted: rowCount });
    } catch (error) {
        console.error('DELETE /api/notifications error:', error);
        res.status(500).json({ message: 'failed' });
    }
});

app.get('/api/me/ta-metrics', async (req, res) => {
    if (!req.session?.user_id) {
        res.status(401).json({ message: 'unauthenticated' });
        return;
    }
    if (!taEnabled()) {
        res.json({ enabled: false, total: 0, negative_count: 0, negative_rate: null, banned_count: 0, banned_rate: null,
                   recovery_denom: 0, recovery_count: 0, recovery_rate: null });
        return;
    }
    try {
        const me = req.session.user_id;
        const { rows: grp } = await pool.query(
            `SELECT proj_cd, array_agg("UID") AS uids
               FROM qa_calls
              WHERE agent_user_id = $1 AND "UID" IS NOT NULL AND proj_cd IS NOT NULL
              GROUP BY proj_cd`,
            [me]
        );
        let total = 0, negative = 0, banned = 0;
        for (const g of grp) {
            const m = await fetchTaMetricsByUids(g.proj_cd, g.uids || []);
            total += m.total; negative += m.negative; banned += m.banned;

            const segRows = await fetchSegmentSentimentsByUids(g.proj_cd, g.uids || []);
            for (const sr of segRows) {
                const sents = sr.sentiments || [];
                const segCount = sents.length;
                const negCount = sents.filter((s) => s === '부정').length;
                const firstNeg = sents.findIndex((s) => s === '부정');
                const finalS = segCount ? sents[segCount - 1] : null;
                const hadNeg = negCount > 0;
                const recovered = hadNeg && (finalS === '긍정' || finalS === '중립');
                await pool.query(
                    `INSERT INTO public.qa_call_recovery
                        (proj_cd, uid, agent_user_id, segment_count, neg_seg_count, first_neg_idx,
                         final_sentiment, had_negative, recovered, analyzed_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
                     ON CONFLICT (proj_cd, uid) DO UPDATE SET
                        agent_user_id = EXCLUDED.agent_user_id,
                        segment_count = EXCLUDED.segment_count,
                        neg_seg_count = EXCLUDED.neg_seg_count,
                        first_neg_idx = EXCLUDED.first_neg_idx,
                        final_sentiment = EXCLUDED.final_sentiment,
                        had_negative = EXCLUDED.had_negative,
                        recovered = EXCLUDED.recovered,
                        analyzed_at = now()`,
                    [g.proj_cd, sr.uid, me, segCount, negCount, firstNeg >= 0 ? firstNeg + 1 : null, finalS, hadNeg, recovered]
                );
            }
        }
        const { rows: rec } = await pool.query(
            `SELECT count(*) FILTER (WHERE had_negative)::int AS denom,
                    count(*) FILTER (WHERE recovered)::int    AS recovered
               FROM public.qa_call_recovery WHERE agent_user_id = $1`,
            [me]
        );
        const rDenom = rec[0]?.denom || 0;
        const rRec = rec[0]?.recovered || 0;

        const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);
        res.json({
            enabled: true,
            total,
            negative_count: negative,
            negative_rate: pct(negative),
            banned_count: banned,
            banned_rate: pct(banned),
            recovery_denom: rDenom,
            recovery_count: rRec,
            recovery_rate: rDenom > 0 ? Math.round((rRec / rDenom) * 1000) / 10 : null,
        });
    } catch (e) {
        console.error('GET /api/me/ta-metrics error:', e?.message || e);
        res.status(502).json({ enabled: true, error: 'TA 지표 조회 실패' });
    }
});

// ───────────────────────────────────────────────────────────────────────────
// AI 평가 배치관리 (BatchManage)
//   조건 세트(5개 카드 + 공통 통화시간/스케줄)를 브랜드별로 저장하고,
//   "예상 대상" 을 우리 DB(qa_calls)로 실제 산출한다.
//   현재 산출 가능(우리 데이터): ① 저품질 평균점수 미달 / 공통 통화시간 / ⑤ 고점·무작위표본.
//   미지원(데이터·정의 대기): ② AI 신뢰도(엔진 confidence), ③ 리스크(기준 미정),
//                              ④ 근속(상담사 입사일 없음), ① 필수항목/업무지식(기준 미정).
// ───────────────────────────────────────────────────────────────────────────
function batchOrgKey(req) {
    // 브랜드별 1행. super_admin '전체'(null)는 0 버킷에 보관.
    const a = resolveActiveOrgId(req);
    return a == null ? 0 : a;
}

// GET /api/batch/config — 현재 브랜드의 저장된 조건. 없으면 config:null (프론트 기본값 사용).
app.get('/api/batch/config', requireAdmin, async (req, res) => {
    try {
        const orgId = batchOrgKey(req);
        const { rows } = await pool.query(
            `SELECT config, updated_at, updated_by FROM public.qa_batch_configs WHERE org_id = $1`,
            [orgId]
        );
        res.json({
            ok: true,
            org_id: orgId,
            config: rows[0]?.config ?? null,
            updated_at: rows[0]?.updated_at ?? null,
        });
    } catch (e) {
        console.error('GET /api/batch/config error:', e?.message || e);
        res.status(500).json({ ok: false, message: '배치 설정 조회 실패' });
    }
});

// PUT /api/batch/config — 조건 세트 저장(upsert). body: { config: {...} }
app.put('/api/batch/config', requireAdmin, async (req, res) => {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ ok: false, message: 'config(object) 가 필요합니다.' });
    }
    try {
        const orgId = batchOrgKey(req);
        const updatedBy = req.session?.user_id ?? null;
        await pool.query(
            `INSERT INTO public.qa_batch_configs (org_id, config, updated_at, updated_by)
             VALUES ($1, $2::jsonb, now(), $3)
             ON CONFLICT (org_id) DO UPDATE SET
               config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by`,
            [orgId, JSON.stringify(config), updatedBy]
        );
        res.json({ ok: true, org_id: orgId });
    } catch (e) {
        console.error('PUT /api/batch/config error:', e?.message || e);
        res.status(500).json({ ok: false, message: '배치 설정 저장 실패' });
    }
});

// GET /api/batch/eval-items — ② '적용 평가 항목' 칩용. 실제 평가된 항목(order_no+item) 집합.
//   eval_item_defs(부서·버전 엉킴) 대신, 그 org 콜이 실제 평가받은 항목으로 — ② 판정 order_no 와 정확히 일치.
app.get('/api/batch/eval-items', requireAdmin, async (req, res) => {
    try {
        const orgId = batchOrgKey(req);
        const params = [];
        let orgClause = '';
        if (orgId !== 0) { params.push(orgId); orgClause = `AND c.org_id = $${params.length}`; }
        const { rows } = await pool.query(
            `SELECT er.order_no, max(er.item) AS item, count(DISTINCT er."ID")::int AS calls
               FROM qa_evaluation_rows er
               JOIN qa_calls c ON c."ID" = er."ID"
              WHERE c.is_sandbox = false ${orgClause}
              GROUP BY er.order_no
              ORDER BY er.order_no`,
            params
        );
        res.json({ ok: true, org_id: orgId, items: rows });
    } catch (e) {
        console.error('GET /api/batch/eval-items error:', e?.message || e);
        res.status(500).json({ ok: false, message: '평가 항목 조회 실패' });
    }
});

// POST /api/batch/preview — 조건 → 예상 대상 콜 수(실데이터). body: { config }
app.post('/api/batch/preview', requireAdmin, async (req, res) => {
    const cfg = req.body?.config || {};
    try {
        const orgId = batchOrgKey(req);
        const on = cfg.on || {};
        const q = cfg.quality || {};
        const bias = cfg.bias || {};
        const scope = cfg.scope || {};

        const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
        // 통화시간(분) → 초. max<=0 또는 max<=min 이면 상한 없음(매우 큰 값).
        const minSec = Math.max(0, Math.round(num(scope.minMin, 0) * 60));
        let maxMin = num(scope.maxMin, 0);
        const maxSec = maxMin > 0 && maxMin * 60 > minSec ? Math.round(maxMin * 60) : 2147483647;

        const conf = cfg.confidence || {};

        // 지원 조건 플래그 (우리 데이터로 산출 가능한 것만)
        const qOn = !!(on.quality && q.avgBelow);
        const qRel = q.avgMode === 'rel';
        const qRelPts = num(q.avgRel, 0);
        const qAbs = num(q.avgAbs, 0);
        const bHighOn = !!(on.bias && bias.highScore);
        const bHigh = num(bias.highThreshold, 101);
        // ② 신뢰도 — 저장된 LLM 판정(qa_confidence_judgments)을 선택 항목으로 스코프해서 필터.
        const uncOn = !!conf.uncertain;
        const conOn = !!conf.contradiction;
        const confOn = !!(on.confidence && (uncOn || conOn));
        // 적용 평가 항목: excluded(order_no 배열) 제외 = 나머지만 검사. 빈 배열이면 전 항목.
        const excluded = Array.isArray(conf.excluded)
            ? conf.excluded.map((x) => Number(x)).filter((n) => Number.isInteger(n))
            : [];

        const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, confOn, uncOn, conOn, excluded];
        let orgClause = '';
        if (orgId !== 0) { params.push(orgId); orgClause = `AND c.org_id = $${params.length}`; }

        const sql = `
            WITH scoped AS (
                SELECT c."TOTAL_SCORE"::numeric AS score, c.duration_sec, cj.judgments
                  FROM qa_calls c
                  LEFT JOIN qa_confidence_judgments cj ON cj.qa_id = c."ID"
                 WHERE c.is_sandbox = false ${orgClause}
            ), in_scope AS (
                SELECT score, duration_sec, judgments FROM scoped
                 WHERE duration_sec IS NOT NULL AND duration_sec >= $1 AND duration_sec < $2
            ), agg AS (
                SELECT avg(score) AS org_avg FROM in_scope
            ), flagged AS (
                SELECT
                    ($3 AND ( ($4 AND a.org_avg IS NOT NULL AND i.score <= a.org_avg - $5) OR (NOT $4 AND i.score < $6) )) AS q_match,
                    ($7 AND i.score >= $8) AS b_match,
                    ($9 AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(coalesce(i.judgments, '[]'::jsonb)) e
                         WHERE NOT ((e->>'order_no')::int = ANY($12::int[]))
                           AND ( ($10 AND (e->>'uncertain')::boolean) OR ($11 AND (e->>'contradiction')::boolean) )
                    )) AS c_match,
                    (i.judgments IS NOT NULL) AS judged
                  FROM in_scope i CROSS JOIN agg a
            )
            SELECT
                (SELECT count(*) FROM scoped)::int   AS pool,
                (SELECT count(*) FROM in_scope)::int AS in_scope_cnt,
                (SELECT round(org_avg, 1) FROM agg)  AS org_avg,
                count(*) FILTER (WHERE q_match)::int  AS quality_cnt,
                count(*) FILTER (WHERE b_match)::int  AS bias_high_cnt,
                count(*) FILTER (WHERE c_match)::int  AS confidence_cnt,
                count(*) FILTER (WHERE judged)::int   AS judged_cnt,
                count(*) FILTER (WHERE q_match OR b_match OR c_match)::int AS union_cnt
            FROM flagged`;

        const { rows } = await pool.query(sql, params);
        const r = rows[0] || { pool: 0, in_scope_cnt: 0, org_avg: null, quality_cnt: 0, bias_high_cnt: 0, confidence_cnt: 0, judged_cnt: 0, union_cnt: 0 };

        // ⑤ 무작위 표본 — 필터가 아닌 표본 추출이라 추정(범위 내 콜 × %).
        const randomOn = !!(on.bias && bias.random);
        const randomPct = num(bias.randomPct, 0);
        const biasRandomEst = randomOn ? Math.round((r.in_scope_cnt * randomPct) / 100) : 0;

        const totalTargets = Math.min(r.in_scope_cnt, (r.union_cnt || 0) + biasRandomEst);

        res.json({
            ok: true,
            org_id: orgId,
            pool: r.pool,
            in_scope: r.in_scope_cnt,
            org_avg: r.org_avg != null ? Number(r.org_avg) : null,
            total_targets: totalTargets,
            scope: { min_sec: minSec, max_sec: maxSec === 2147483647 ? null : maxSec },
            conditions: {
                quality: on.quality
                    ? { supported: true, count: r.quality_cnt,
                        note: '평균점수 미달만 반영 — 필수항목 기준 미정' }
                    : { supported: true, count: 0, note: '비활성' },
                confidence: on.confidence
                    ? { supported: true, count: r.confidence_cnt, judged: r.judged_cnt,
                        note: r.judged_cnt < r.in_scope_cnt ? `LLM 판정 ${r.judged_cnt}/${r.in_scope_cnt}콜 (미판정분 재판정 필요)` : null }
                    : { supported: true, count: 0, note: '비활성' },
                risk:       { supported: false, count: 0, note: '리스크 기준(금칙어·고객신호) 정의 대기' },
                tenure:     { supported: false, count: 0, note: '상담사 입사일 데이터 보강 대기' },
                bias: on.bias
                    ? { supported: true, count: (r.bias_high_cnt || 0) + biasRandomEst,
                        high_count: r.bias_high_cnt, random_est: biasRandomEst,
                        note: randomOn ? '무작위 표본은 추정치' : null }
                    : { supported: true, count: 0, note: '비활성' },
            },
        });
    } catch (e) {
        console.error('POST /api/batch/preview error:', e?.message || e);
        res.status(500).json({ ok: false, message: '배치 미리보기 산출 실패' });
    }
});

// ── AI 신뢰도 검증 ② 판정 프롬프트(B안) — 두 정의문 편집 + 재판정 ──────────────
// v1: 단일 전역 판정 프롬프트(org 0). 브랜드별 프롬프트는 후속(runJudgeBackfill orgId 인자화 동반).
const PROMPT_ORG = 0;

// 재판정 잡 상태(인프로세스 1개). 프롬프트가 전역(org 0)이라 잡도 전역 1개로 충분.
// API 재기동 시 중단돼도 멱등(재실행이 남은 콜만 다시 처리).
let rejudgeJob = { running: false, started_at: null, finished_at: null, done: 0, total: null, result: null, error: null };

// GET /api/batch/prompt — 편집 UI 용. 두 정의문(불확실/모순) + 메타 + 판정 가용 여부.
app.get('/api/batch/prompt', requireAdmin, async (req, res) => {
    try {
        const p = await resolvePromptParts(pool, PROMPT_ORG);
        res.json({
            ok: true,
            uncertain_def: p.uncertainDef,
            contradiction_def: p.contradictionDef,
            default_uncertain_def: DEFAULT_UNCERTAIN_DEF,
            default_contradiction_def: DEFAULT_CONTRADICTION_DEF,
            version: p.version,
            is_default: p.isDefault,
            updated_at: p.updatedAt,
            judge_enabled: judgeEnabled(),
            model: judgeModel(),
        });
    } catch (e) {
        console.error('GET /api/batch/prompt error:', e?.message || e);
        res.status(500).json({ ok: false, message: '판정 프롬프트 조회 실패' });
    }
});

// PUT /api/batch/prompt — 두 정의문 저장(변경 시 version 증가 → 기존 판정 stale → 재판정 대상).
// body: { uncertain_def, contradiction_def }. 빈 값/기본값과 동일하면 NULL 저장(기본값 폴백).
app.put('/api/batch/prompt', requireAdmin, async (req, res) => {
    const inU = String(req.body?.uncertain_def ?? '').trim();
    const inC = String(req.body?.contradiction_def ?? '').trim();
    try {
        const cur = await resolvePromptParts(pool, PROMPT_ORG);
        const newU = inU || DEFAULT_UNCERTAIN_DEF;
        const newC = inC || DEFAULT_CONTRADICTION_DEF;
        // 변경 없음 → 불필요한 version 증가/재판정 방지.
        if (newU === cur.uncertainDef.trim() && newC === cur.contradictionDef.trim()) {
            return res.json({ ok: true, version: cur.version, unchanged: true, stale_count: 0 });
        }
        const storeU = newU === DEFAULT_UNCERTAIN_DEF ? null : newU;
        const storeC = newC === DEFAULT_CONTRADICTION_DEF ? null : newC;
        const systemPrompt = buildSystemPrompt({ uncertainDef: newU, contradictionDef: newC });
        const updatedBy = req.session?.user_id ?? null;
        const { rows } = await pool.query(
            `INSERT INTO public.qa_batch_prompts
                 (org_id, version, system_prompt, uncertain_def, contradiction_def, updated_at, updated_by)
             VALUES ($1, 1, $2, $3, $4, now(), $5)
             ON CONFLICT (org_id) DO UPDATE SET
                 version = qa_batch_prompts.version + 1,
                 system_prompt = EXCLUDED.system_prompt,
                 uncertain_def = EXCLUDED.uncertain_def,
                 contradiction_def = EXCLUDED.contradiction_def,
                 updated_at = now(), updated_by = EXCLUDED.updated_by
             RETURNING version`,
            [PROMPT_ORG, systemPrompt, storeU, storeC, updatedBy]
        );
        const version = rows[0]?.version ?? 1;
        const { rows: sc } = await pool.query(
            `SELECT count(*)::int AS n FROM qa_calls c
              WHERE c.is_sandbox = false
                AND EXISTS (SELECT 1 FROM qa_evaluation_rows er WHERE er."ID" = c."ID")
                AND NOT EXISTS (SELECT 1 FROM qa_confidence_judgments j
                                 WHERE j.qa_id = c."ID" AND j.prompt_version = $1)`,
            [version]
        );
        res.json({ ok: true, version, unchanged: false, stale_count: sc[0]?.n ?? 0 });
    } catch (e) {
        console.error('PUT /api/batch/prompt error:', e?.message || e);
        res.status(500).json({ ok: false, message: '판정 프롬프트 저장 실패' });
    }
});

// POST /api/batch/rejudge — 현재 프롬프트 버전으로 미판정 콜 재판정(백그라운드 비동기).
// 즉시 반환하고 진행상황은 GET /api/batch/rejudge/status 로 폴링.
app.post('/api/batch/rejudge', requireAdmin, async (req, res) => {
    if (!judgeEnabled()) {
        return res.status(400).json({ ok: false, message: 'GEMINI_API_KEY 미설정 — 재판정 불가' });
    }
    if (rejudgeJob.running) {
        return res.json({ ok: true, running: true, already: true, done: rejudgeJob.done, total: rejudgeJob.total });
    }
    rejudgeJob = { running: true, started_at: new Date().toISOString(), finished_at: null, done: 0, total: null, result: null, error: null };
    // fire-and-forget. 예외는 잡 상태에 기록(프로세스 안 죽게).
    runJudgeBackfill(pool, {
        limit: 1000,
        orgId: PROMPT_ORG,
        onProgress: ({ done, total }) => { rejudgeJob.done = done; rejudgeJob.total = total; },
    })
        .then((r) => {
            rejudgeJob.running = false;
            rejudgeJob.finished_at = new Date().toISOString();
            rejudgeJob.total = r.total;
            rejudgeJob.done = r.done;
            rejudgeJob.result = r;
        })
        .catch((e) => {
            rejudgeJob.running = false;
            rejudgeJob.finished_at = new Date().toISOString();
            rejudgeJob.error = e?.message || String(e);
            logger.warn(`[rejudge] 실패: ${rejudgeJob.error}`);
        });
    res.json({ ok: true, started: true });
});

// GET /api/batch/rejudge/status — 재판정 진행상황 폴링.
app.get('/api/batch/rejudge/status', requireAdmin, (req, res) => {
    res.json({ ok: true, ...rejudgeJob });
});

bootstrap()
    .then(() => {
        app.listen(PORT, () => {
            const msg1 = `listening on port ${PORT}`;
            const msg2 = `DATABASE_URL=${databaseUrl.replace(/:[^:@/]+@/, ':****@')}`;
            console.log(`[qa-api] ${msg1}`);
            console.log(`[qa-api] ${msg2}`);
            logger.info(msg1, { module: 'qa-api' });
            logger.info(msg2, { module: 'qa-api' });
            // ICS(mtm30) → 09 QA 폴러 기동. env-gated(MARIA_DB_* + ICS_QA_POLL_ENABLED=true) — 미설정 시 no-op.
            startIcsQaPoller(pool, { ingestStandardCallFromQaPipeline });
            // AICC MQTT 실시간 STT 스트림 — finish 시 그 콜 즉시 QA 적재(폴러 안전망 병행). MQTT_HOST 미설정 시 no-op.
            startMqttListener(pool, { ingestStandardCallFromQaPipeline });
        });
    })
    .catch((err) => {
        console.error('[qa-api] startup DB init failed:', err);
        logger.error(`startup DB init failed: ${err?.stack || err}`, { module: 'qa-api' });
        process.exit(1);
    });
