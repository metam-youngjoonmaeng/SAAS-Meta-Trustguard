import crypto from 'crypto';
import bcrypt from 'bcryptjs';
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
import { buildChecklistYnKorFromDbRows, checklistKeysForDepartment, effectiveChecklistKeys, LEGACY_STANDARD_ORG_IDS } from './checklistCategorySummary.mjs';
/* SAMPLE_UPLOAD_FEATURE */ import { ingestSampleToDb, clearSamplesFromDb } from './sampleIngest.mjs';
import { ingestCollectionCallToDb } from './collectionCallIngest.mjs';
import { fetchAndIngestFromAiCanvas } from './aiCanvasIngest.mjs';
import { ingestCallFromQaPipeline, ingestStandardCallFromQaPipeline, evaluateStandardCall, evaluateDomainCall, extractForbiddenFromResult, fetchGoldenIndexCoverage } from './qaPipelineIngest.mjs';
import { loadRagFewshotConfig, saveRagFewshotConfig } from './ragFewshotConfig.mjs';
import { startIcsQaPoller, startGoldenLearnScheduler, triggerGoldenLearn, startSkillLearnScheduler, triggerSkillLearn } from './icsQaPoller.mjs';
import { fetchSkillVersions, fetchSkillVersionDetail, activateSkillVersion, pushSkillSettings, fetchSkillGenProgress } from './skillLearn.mjs';
import { startMqttListener, getActiveCalls } from './mqttListener.mjs';
import { callAnswerStats, ipccEnabled } from './xhubSource.mjs';
import { taEnabled, fetchTaMetricsByUids, fetchSegmentSentimentsByUids } from './taSource.mjs';
import {
    buildSystemPrompt, resolvePromptParts, judgeEnabled, judgeModel,
    DEFAULT_UNCERTAIN_DEF, DEFAULT_CONTRADICTION_DEF,
} from './geminiJudge.mjs';
import { runJudgeBackfill } from './judgeConfidence.mjs';
import { applyManualReviewStamps } from './manualReview.mjs';
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
function pushRagLog(entry) {
    if (!entry || typeof entry !== 'object') return;
    RAG_LOG.push({ ts: Date.now(), ...entry });
    if (RAG_LOG.length > RAG_LOG_MAX) RAG_LOG.shift();
}

/* ── [LLM 스킬 로그, additive] 스킬 학습 체인(수집→생성→활성화) 인메모리 링버퍼 — RAG_LOG 미러 ──
 * DB 미적재(스키마 불변). 레코드 계약:
 *   { ts, org_id, source, stage, message,
 *     rubric_id?, version_id?, case_count?, items_changed?, error? }
 *   stage ∈ collect|generate|activate|done|error · org_id 필수(로그 탭 브랜드 필터용).
 * 상한 500(초과분 shift). GET /api/skill-log/recent 가 최신순 반환. */
const SKILL_LOG = [];
const SKILL_LOG_MAX = 500;
function pushSkillLog(entry) {
    if (!entry || typeof entry !== 'object') return;
    SKILL_LOG.push({ ts: Date.now(), ...entry });
    if (SKILL_LOG.length > SKILL_LOG_MAX) SKILL_LOG.shift();
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
// 정규화 키 → 정본 라벨 역참조(정본 5축 중 매칭되면 정본 표기로 환원).
const CANONICAL_AXIS_BY_NORM = new Map(
    CANONICAL_PENTAGON_AXES.map((label) => [normalizeAxisLabel(label), label])
);
/** DB axis 값을 정본 5축 라벨로 환원(매칭 시), 아니면 원본 trim 값 유지(커스텀 축). 빈 값은 ''. */
function canonicalizeAxis(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return CANONICAL_AXIS_BY_NORM.get(normalizeAxisLabel(raw)) || raw;
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

/** 저장 해시를 소문자화 없이 원본 문자열로만 추출(bcrypt 는 대소문자 유의 — Base64). */
function rawPasswordHash(value) {
    if (value === null || value === undefined) return '';
    if (Buffer.isBuffer(value)) {
        if (value.length === 32) return value.toString('hex'); // 32바이트면 sha256 바이너리 → hex
        return value.toString('utf8').trim();
    }
    return String(value).trim();
}

/** 비밀번호 검증 — 저장 해시 방식 자동 판별.
 *  - bcrypt($2a/$2b/$2y$…, 60자): 쌍둥이 스키마(users) 적재분. bcrypt.compare.
 *  - 그 외(64자 hex): 레거시 SHA-256. sha256Hex 일치.
 *  두 방식 혼재(계정별로 다름) → 한쪽만 보면 한쪽 계정군이 영원히 로그인 불가. */
function verifyPassword(password, storedRaw) {
    const raw = rawPasswordHash(storedRaw);
    if (!raw) return false;
    if (/^\$2[aby]\$/.test(raw)) {
        try {
            return bcrypt.compareSync(String(password), raw);
        } catch {
            return false;
        }
    }
    return sha256Hex(password).toLowerCase() === raw.toLowerCase();
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
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/ics-sso', '/api/svc/eval-items', '/api/svc/deep-eval', '/api/svc/brand-qa-scores']);

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessionStore.set(token, {
        user_id: user.user_id,
        login_id: user.login_id,
        display_name: user.display_name,
        role: user.role,
        org_id: user.org_id ?? null,
        trainee_id: user.trainee_id ?? null,   // 활성 멤버십 id(다중소속 전환용). 미상이면 null → org_id 로 대체 매칭.
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
function resolveActiveOrgId(req, { strict = false } = {}) {
    if (!req.session) return null;
    if (req.session.role === 'super_admin') {
        const raw = String(req.headers['x-active-brand-id'] || '').trim();
        if (raw && raw.toLowerCase() !== 'all') {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) return parsed;
        }
        if (raw.toLowerCase() === 'all') return null; // 전체 조회
        // strict(쓰기 라우트): 헤더 없으면 본인 홈 org 자동 폴백 금지 → null 반환 → 핸들러 가드가 400.
        // (super_admin 이 활성 브랜드 미선택 상태로 쓰면 홈 브랜드 org1(신한카드)을 무단 변조하던 문제 방지)
        if (strict) return null;
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
    const domainId = Number(req.query.domain_id);
    const orgId = Number(req.query.org_id);
    if (!Number.isFinite(domainId) && !Number.isFinite(orgId)) {
        res.status(400).json({ message: 'domain_id 또는 org_id (number) 가 필요합니다' });
        return;
    }
    try {
        if (Number.isFinite(domainId)) {
            // 도메인(업종) 기준 — domain_default_eval_items + domain_default_pentagon_axes (표시·설정용).
            const { rows: items } = await pool.query(
                `SELECT order_no, category, item, criterion, pentagon_axis, scoring_type, max_score
                   FROM public.domain_default_eval_items
                  WHERE domain_id = $1 AND is_active = true
                  ORDER BY order_no ASC, id ASC`,
                [domainId]
            );
            const { rows: axes } = await pool.query(
                `SELECT axis_no, label, description, prompt_template
                   FROM public.domain_default_pentagon_axes
                  WHERE domain_id = $1 AND is_active = true
                  ORDER BY axis_no ASC`,
                [domainId]
            );
            res.json({ ok: true, domain_id: domainId, count: items.length, items, pentagon_axes: axes });
            return;
        }
        const department = req.query.department ? normalizeDepartment(req.query.department) : null;
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
        // 펜타곤 축(라벨·설명·평가 프롬프트) 동봉 — 도메인 분기와 동일. 엔진이 축별 평가기준 판단에 사용.
        const { rows: axes } = await pool.query(
            `SELECT axis_no, label, description, prompt_template
               FROM public.pentagon_axes
              WHERE ${where.join(' AND ')}
              ORDER BY department ASC, axis_no ASC`,
            params
        );
        res.json({ ok: true, org_id: orgId, count: rows.length, items: rows, pentagon_axes: axes });
    } catch (error) {
        console.error('GET /api/svc/eval-items error:', error);
        res.status(500).json({ message: 'Failed to load eval items.' });
    }
});

/* ── 서비스 간 브랜드 평균 QA 점수 (03-Meta_Summary SLA 'QA 평가' 행 연동) ──
 * GET /api/svc/brand-qa-scores?proj_cd=<code>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>
 * 인증: X-Service-Token === env EVAL_SHARE_TOKEN (세션 아님). 토큰 미설정 시 비활성(503).
 *
 * 브랜드 매칭키 = organizations.proj_cd (03 도 동일 키 보유 — 사용자 테이블은 비통일이라
 *   브랜드 평균만 끌어가는 구조). start/end 미지정 시 전체 기간.
 * 점수 환산(avg_score) = 콜별 만점(체크리스트 배점합) 대비 비율의 평균을 100점 환산 —
 *   AVG(TOTAL_SCORE / total_max) * 100. Trustguard 콜은 80/100 만점이 혼재하므로 100점
 *   기준으로 통일해 03 SLA 목표(85~90점)와 직접 비교 가능하게 한다. avg_raw 는 원점수 평균(참고).
 */
app.get('/api/svc/brand-qa-scores', async (req, res) => {
    const expected = String(process.env.EVAL_SHARE_TOKEN || '').trim();
    if (!expected) {
        res.status(503).json({ message: 'QA 점수 공유 비활성 (EVAL_SHARE_TOKEN 미설정)' });
        return;
    }
    const provided = String(req.headers['x-service-token'] || '').trim();
    if (provided !== expected) {
        res.status(401).json({ message: 'invalid service token' });
        return;
    }
    const projCd = String(req.query.proj_cd || '').trim();
    if (!projCd) {
        res.status(400).json({ message: 'proj_cd required' });
        return;
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const start = String(req.query.start || '').trim();
    const end = String(req.query.end || '').trim();
    try {
        const params = [projCd];
        const where = ['o.proj_cd = $1', 'c.is_sandbox = false', 'c."TOTAL_SCORE" IS NOT NULL'];
        if (dateRe.test(start)) { params.push(start); where.push(`c."CDATE"::date >= $${params.length}::date`); }
        if (dateRe.test(end)) { params.push(end); where.push(`c."CDATE"::date <= $${params.length}::date`); }
        const { rows } = await pool.query(
            `SELECT o.id AS org_id, o.name AS brand_name, o.proj_cd,
                    COUNT(*) AS call_count,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS avg_raw,
                    ROUND(AVG(CASE WHEN tm.total_max > 0 THEN c."TOTAL_SCORE" / tm.total_max * 100 END)::numeric, 1) AS avg_score_100
               FROM qa_calls c
               JOIN organizations o ON c.org_id = o.id
               LEFT JOIN LATERAL (
                   SELECT COALESCE(SUM(CASE WHEN ch.validation_time LIKE '배점%'
                       THEN COALESCE(NULLIF(regexp_replace(ch.validation_time, '[^0-9.]', '', 'g'), '')::numeric, 5)
                       ELSE 5 END), 0) AS total_max
                     FROM qa_checklist_rows ch WHERE ch."ID" = c."ID"
               ) tm ON true
              WHERE ${where.join(' AND ')}
              GROUP BY o.id, o.name, o.proj_cd`,
            params
        );
        const row = rows[0] || null;
        res.json({
            ok: true,
            proj_cd: projCd,
            start: dateRe.test(start) ? start : null,
            end: dateRe.test(end) ? end : null,
            found: !!row,
            org_id: row ? row.org_id : null,
            brand_name: row ? row.brand_name : null,
            call_count: row ? Number(row.call_count) : 0,
            avg_score: row && row.avg_score_100 != null ? Number(row.avg_score_100) : null,  // 100점 환산
            avg_raw: row && row.avg_raw != null ? Number(row.avg_raw) : null,                // 원점수 평균(참고)
        });
    } catch (error) {
        console.error('GET /api/svc/brand-qa-scores error:', error);
        res.status(500).json({ message: 'Failed to load brand QA scores.' });
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
    const { transcript, qa_org_id, domain_id, department, role, consultation_id } = req.body || {};
    if (!Array.isArray(transcript) || !transcript.length) {
        res.status(400).json({ message: 'transcript (non-empty array) required' });
        return;
    }
    const domainId = Number(domain_id);
    const orgId = Number(qa_org_id);
    const useDomain = Number.isFinite(domainId);
    if (!useDomain && !Number.isFinite(orgId)) {
        res.status(400).json({ message: 'domain_id 또는 qa_org_id (number) 가 필요합니다' });
        return;
    }
    const cid = String(consultation_id || `deep-${useDomain ? `d${domainId}` : orgId}-${transcript.length}`).trim();
    try {
        if (useDomain) {
            // 도메인(업종) 기준 — domain_default_eval_items 루브릭으로 채점 + domain_default_pentagon_axes 로 펜타곤.
            const call = {
                transcript, domain_id: domainId, role: role || undefined,
                consultation_id: cid, qa_id: cid, pipeline_target: 'ec2',
            };
            const mapped = await evaluateDomainCall(pool, call, {});
            // 펜타곤(05 Detail 과 동일 로직): rowMeta(order_no→pentagon_axis) + 도메인 표준 축.
            const axisByOrderNo = {};
            for (const m of mapped.rowMeta || []) {
                const ax = String(m?.pentagon_axis ?? '').trim();
                if (ax) axisByOrderNo[Number(m.order_no)] = ax;
            }
            let definedAxes = null;
            try {
                const { rows: axRows } = await pool.query(
                    `SELECT label FROM public.domain_default_pentagon_axes
                      WHERE domain_id = $1 AND is_active = true AND label IS NOT NULL AND btrim(label) <> ''
                      ORDER BY axis_no ASC`,
                    [domainId]
                );
                if (axRows.length) definedAxes = axRows.map((r) => String(r.label).trim());
            } catch (axErr) { console.error('svc/deep-eval pentagon axes lookup failed:', axErr); }
            // 펜타곤 입력 행: order_no + 만점(validation_time) + 획득(result) 병합.
            const aiByOrder = new Map((mapped.evaluations || []).map((e) => [Number(e.order_no), e.ai_eval]));
            const pentaRows = (mapped.checklist || []).map((c) => ({
                order_no: Number(c.order_no),
                item: c.item,
                validation_time: c.validation_time,
                result: String(aiByOrder.get(Number(c.order_no)) ?? ''),
            }));
            const pentagon = buildPentagonByAxisDefs(pentaRows, axisByOrderNo, definedAxes);
            // 항목별 pentagon_axis 동봉 — 소비측(02 등)이 축 기준으로 레이더를 그릴 수 있게.
            const evalsWithAxis = (mapped.evaluations || []).map((e) => ({
                ...e,
                pentagon_axis: axisByOrderNo[Number(e.order_no)] || null,
            }));
            res.json({
                ok: true,
                domain_id: domainId,
                source: mapped.source || null,
                raw_total: mapped.raw_total ?? null,
                max_total: mapped.max_total ?? null,
                ai_score: mapped.ai_score ?? null,
                evaluations: evalsWithAxis,
                checklist: mapped.checklist || [],
                pentagon,                                       // {team_avg, agent_score, overall_avg}: {축라벨: %}
                pentagon_axes: definedAxes || CANONICAL_PENTAGON_AXES,
                warnings: mapped.warnings || [],
            });
            return;
        }
        // (레거시) 브랜드 기준 — 기존 동작 유지.
        const call = {
            transcript, org_id: orgId, department: department || undefined, role: role || undefined,
            consultation_id: cid, qa_id: cid, pipeline_target: 'ec2',
        };
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
        if (!verifyPassword(password, row.password_hash)) {
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
        // 활성 멤버십 id 확정(다중소속 전환용) — admin_users VIEW 와 동일 우선순위.
        try {
            const { rows: tr } = await pool.query(
                `SELECT id FROM public.trainee_registrations
                  WHERE user_id = $1
                  ORDER BY (id = (SELECT last_active_trainee_id FROM public.users WHERE id = $1)) DESC NULLS LAST,
                           (status = 'active') DESC, id ASC
                  LIMIT 1`,
                [row.user_id]
            );
            row.trainee_id = tr[0]?.id ?? null;
            if (row.trainee_id != null) {
                await pool.query('UPDATE public.users SET last_active_trainee_id = $1 WHERE id = $2', [row.trainee_id, row.user_id]);
            }
        } catch (e) { console.error('active membership resolve error:', e); }
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

// ── 다중 소속(02/03 동일) — 내 멤버십 목록 + 조직 전환 ──────────
// GET /api/auth/memberships: 로그인 사용자의 active 멤버십(조직×역할) 목록. current=현재 활성.
app.get('/api/auth/memberships', async (req, res) => {
    const uid = req.session?.user_id;
    if (uid == null) { res.json([]); return; }
    try {
        const { rows } = await pool.query(
            `SELECT t.id AS trainee_id, t.org_id, o.name AS org_name,
                    t.role::text AS role, t.department
               FROM public.trainee_registrations t
               LEFT JOIN public.organizations o ON o.id = t.org_id
              WHERE t.user_id = $1 AND t.status = 'active'
              ORDER BY (t.id = (SELECT last_active_trainee_id FROM public.users WHERE id = $1)) DESC NULLS LAST,
                       t.id ASC`,
            [uid]
        );
        const activeTid = req.session.trainee_id ?? null;
        const activeOrg = req.session.org_id ?? null;
        res.json(rows.map((r) => ({
            ...r,
            // 현재 활성: 세션의 trainee_id 우선, 없으면 org_id 로 매칭(폴백).
            current: activeTid != null ? r.trainee_id === activeTid : r.org_id === activeOrg,
        })));
    } catch (error) {
        console.error('GET /api/auth/memberships error:', error);
        res.status(500).json({ message: 'Failed to load memberships.' });
    }
});

// POST /api/auth/switch-org { trainee_id }: 본인 소유 active 멤버십으로 활성 전환.
//   users.last_active_trainee_id 갱신 + 현재 세션의 org_id/role/trainee_id 교체(다음 로그인도 유지).
app.post('/api/auth/switch-org', async (req, res) => {
    const uid = req.session?.user_id;
    if (uid == null) { res.status(401).json({ message: 'not authenticated' }); return; }
    const traineeId = Number(req.body?.trainee_id);
    if (!Number.isFinite(traineeId)) { res.status(400).json({ message: 'trainee_id required' }); return; }
    try {
        const { rows } = await pool.query(
            `SELECT t.id, t.org_id, t.role::text AS role, t.department, o.name AS org_name
               FROM public.trainee_registrations t
               LEFT JOIN public.organizations o ON o.id = t.org_id
              WHERE t.id = $1 AND t.user_id = $2 AND t.status = 'active'`,
            [traineeId, uid]
        );
        if (!rows.length) { res.status(403).json({ message: '해당 조직 멤버십에 접근 권한이 없습니다.' }); return; }
        const m = rows[0];
        await pool.query('UPDATE public.users SET last_active_trainee_id = $1 WHERE id = $2', [traineeId, uid]);
        // 세션은 sessionStore 객체 참조 → 필드 갱신이 그대로 저장됨.
        if (req.session) {
            req.session.org_id = m.org_id;
            req.session.role = m.role;
            req.session.trainee_id = m.id;
        }
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.BRAND_SWITCH || 'BRAND_SWITCH',
            resource_type: 'trainee_registration',
            resource_id: String(traineeId),
            http_method: 'POST',
            http_path: '/api/auth/switch-org',
            detail_json: JSON.stringify({ org_id: m.org_id, role: m.role }),
            success: true,
        });
        res.json({ ok: true, trainee_id: m.id, org_id: m.org_id, org_name: m.org_name, role: m.role, department: m.department });
    } catch (error) {
        console.error('POST /api/auth/switch-org error:', error);
        res.status(500).json({ message: 'Failed to switch organization.' });
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
            // 사용자 생성 평가 트랙(표준 1/2/3 외)은 콜 자체 카테고리로 동적 집계 — 부서 고정 키셋 미적용.
            const keys = effectiveChecklistKeys(row.department, chRows, row.org_id);
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

        // 코칭대상 임계값 — 표준 org(1/2/3) 또는 전체뷰는 레거시 80점 절대값,
        // 사용자 생성 트랙(그 외 org)은 콜별 만점(체크리스트 배점합)의 75% 미만으로 상대화.
        const useRelativeCoaching =
            orgId != null && Number.isFinite(Number(orgId)) && !LEGACY_STANDARD_ORG_IDS.has(Number(orgId));
        const coachingCond = useRelativeCoaching
            ? `(tm.total_max > 0 AND c."TOTAL_SCORE" < tm.total_max * 0.75)`
            : `c."TOTAL_SCORE" < 80`;
        const coachingJoin = useRelativeCoaching
            ? `LEFT JOIN LATERAL (
                   SELECT COALESCE(SUM(CASE WHEN ch.validation_time LIKE '배점%'
                       THEN COALESCE(NULLIF(regexp_replace(ch.validation_time, '[^0-9.]', '', 'g'), '')::numeric, 5)
                       ELSE 5 END), 0) AS total_max
                     FROM qa_checklist_rows ch WHERE ch."ID" = c."ID"
               ) tm ON true`
            : '';

        // 2) 부서 카드(현재창, 모든 부서)
        const sc2 = buildScope();
        const deptRows = (await pool.query(
            `SELECT c.department,
                    ROUND(AVG(c."TOTAL_SCORE")::numeric, 1) AS avg,
                    COUNT(*) AS count,
                    COUNT(DISTINCT COALESCE(c.agent_user_id::text, c.agent_code)) AS agent_count,
                    COUNT(*) FILTER (WHERE ${coachingCond}) AS coaching
               FROM qa_calls c ${coachingJoin} ${sc2.where} AND ${bind(winCur, sc2.params)}
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
                    COUNT(*) FILTER (WHERE ${bind(winCur, sc3.params)} AND ${coachingCond}) AS coaching,
                    ROUND(AVG(c."TOTAL_SCORE") FILTER (WHERE ${bind(winPrev, sc3.params)})::numeric,1) AS prev_avg
               FROM qa_calls c ${coachingJoin} ${sc3.where}`,
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
            'SELECT "ID" AS qa_id, "AI_SCORE" AS ai_score, "TOTAL_SCORE" AS total_score, department, org_id FROM qa_calls WHERE "ID" = $1 LIMIT 1',
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
        // 펜타곤 빌더 선택은 ★브랜드(org_id) 기준★ — 신규 브랜드는 코오롱과 완전 독립.
        // 신규 브랜드(비레거시 org_id>=4)는 항상 pentagon_axis 기반(buildPentagonByAxisDefs):
        // 운영자가 평가항목관리에서 지정한 축(eval_item_defs.pentagon_axis)이 유일 SSOT 다.
        // 콜 category 가 코오롱 표준(인사 예절 등)과 겹쳐도 코오롱 category 자동매핑
        // (buildDefaultPentagonFromChecklistRows)으로 빠지지 않는다 — 안 그러면 첫인사(인사 예절)가
        // 오프닝에 자동연동되고 운영자가 직접 지정한 pentagon_axis(예: 발화 안정성)는 무시되는 문제 발생.
        // 레거시 신한(1)/한화(2)/코오롱(3)만 기존 category·카탈로그 빌더 유지(거동 byte-identical).
        const orgIdNum = Number(rows[0].org_id);
        const isLegacyPentagonOrg = [1, 2, 3].includes(orgIdNum);
        const isDynamicRubric = !isLegacyPentagonOrg;
        // 동적 루브릭 콜 — 코오롱 방식(축 고정 + 항목 자동 합산)을 적용.
        //  (1) definedAxes = 운영자가 프론트(pentagon_axes 테이블)에서 정의한 축 라벨. 비면 정본 5축 폴백.
        //  (2) axisByOrderNo = eval_item_defs.pentagon_axis ({ order_no: 축 }). 항목→축 매핑.
        //  축은 definedAxes 로 고정(평가항목 늘어도 불변), 항목은 그 축에 자동 합산.
        let axisByOrderNo = null;
        let definedAxes = null;
        if (isDynamicRubric && rows[0].org_id !== null && rows[0].org_id !== undefined) {
            try {
                const { rows: axisRows } = await pool.query(
                    `SELECT DISTINCT ON (order_no) order_no, pentagon_axis
                       FROM public.eval_item_defs
                      WHERE org_id = $1
                        AND is_active = true
                        AND deactivated_at IS NULL
                        AND pentagon_axis IS NOT NULL
                        AND btrim(pentagon_axis) <> ''
                        AND (scoring_type IS NULL OR scoring_type <> 'yes_no')
                      ORDER BY order_no ASC, version DESC`,
                    [rows[0].org_id]
                );
                if (axisRows.length) {
                    axisByOrderNo = {};
                    for (const r of axisRows) axisByOrderNo[Number(r.order_no)] = String(r.pentagon_axis).trim();
                }
            } catch (axisErr) {
                console.error('GET /api/analysis pentagon_axis lookup failed:', axisErr);
                axisByOrderNo = null;
            }
            try {
                // 운영자 정의 축(프론트 AxisModal CRUD) — 활성 행만. 비면 빌더가 정본 5축으로 폴백.
                const { rows: defAxisRows } = await pool.query(
                    `SELECT label
                       FROM public.pentagon_axes
                      WHERE org_id = $1
                        AND is_active = true
                        AND deactivated_at IS NULL
                        AND effective_from <= now()
                        AND label IS NOT NULL
                        AND btrim(label) <> ''
                      ORDER BY axis_no ASC`,
                    [rows[0].org_id]
                );
                if (defAxisRows.length) definedAxes = defAxisRows.map((r) => String(r.label).trim());
            } catch (defErr) {
                console.error('GET /api/analysis pentagon_axes lookup failed:', defErr);
                definedAxes = null;
            }
        }
        // 동적 루브릭은 항상 정의-축 기반(코오롱식 고정 축). category 폴백 빌더 미사용 — 축이 항목수에 따라
        // 늘어나던 현상 제거. axisByOrderNo 미지정이어도 definedAxes(또는 정본 5축)로 빈 다이어그램 표시.
        const pentagon = isHanwha
            ? buildHanwhaPentagonFromChecklistRows(checklistAugmented)
            : isDynamicRubric
                ? buildPentagonByAxisDefs(checklistAugmented, axisByOrderNo, definedAxes)
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
            `SELECT "ID" AS qa_id, department, role, org_id, ai_analysis_target, ai_analysis_reason, voc_code, promotion_code,
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
        // 항목별 채점방식 — 프론트가 Y/N(컴플라이언스 체크) 항목을 점수표에서 분리하는 데 사용.
        // 활성 eval_item_defs.scoring_type by order_no (펜타곤 axisByOrderNo 조회와 동일 패턴).
        const scoringTypeByOrderNo = new Map();
        if (callMeta.org_id !== null && callMeta.org_id !== undefined) {
            try {
                const { rows: stRows } = await pool.query(
                    `SELECT DISTINCT ON (order_no) order_no, scoring_type
                       FROM public.eval_item_defs
                      WHERE org_id = $1 AND is_active = true AND deactivated_at IS NULL
                      ORDER BY order_no ASC, version DESC`,
                    [callMeta.org_id]
                );
                for (const r of stRows) {
                    scoringTypeByOrderNo.set(Number(r.order_no), String(r.scoring_type || 'numeric').toLowerCase());
                }
            } catch (stErr) {
                console.error('GET /api/evaluations scoring_type lookup failed:', stErr);
            }
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
                scoring_type: scoringTypeByOrderNo.get(Number(r.order_no)) || 'numeric',
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

// 평가 콜 삭제 (관리자 전용, 벌크). body { ids:[qaId, ...] } 또는 { id:qaId } 단건 수용.
//   qa_calls 행 삭제 시 자식 9개 테이블(qa_evaluation_rows·qa_checklist_rows·qa_analysis_report·
//   qa_conversations·qa_golden_set·qa_review_events·qa_consumer_*)이 FK ON DELETE CASCADE 로
//   함께 제거된다 — 별도 자식 DELETE 불필요.
//   sandbox 계정은 운영 행(is_sandbox=false) 삭제 불가 — 배치에 운영행 포함 시 전체 거부(평가/검수 PUT 가드 일관).
//   SELECT(가드)→DELETE 를 한 트랜잭션으로 묶어 TOCTOU 방지.
app.delete('/api/calls', requireAdmin, async (req, res) => {
    // body.ids(배열) 우선, 없으면 body.id(단건) 수용. trim + 중복/공백 제거.
    const rawIds = Array.isArray(req.body?.ids)
        ? req.body.ids
        : req.body?.id != null
            ? [req.body.id]
            : [];
    const ids = [...new Set(rawIds.map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (!ids.length) {
        res.status(400).json({ message: 'ids is required' });
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: targets } = await client.query(
            `SELECT "ID" AS id, is_sandbox FROM qa_calls WHERE "ID" = ANY($1)`,
            [ids]
        );
        // sandbox 계정: 배치에 운영 행(is_sandbox=false) 포함 시 전체 거부.
        if (req.session?.login_id === SANDBOX_LOGIN_ID && targets.some((t) => t.is_sandbox === false)) {
            await client.query('ROLLBACK');
            res.status(403).json({ message: 'sandbox account cannot delete production calls' });
            return;
        }
        const { rowCount } = await client.query('DELETE FROM qa_calls WHERE "ID" = ANY($1)', [ids]);
        await client.query('COMMIT');
        await insertQaAuditLog(pool, {
            req,
            action: 'QA_CALL_DELETE',
            resource_type: 'qa_call',
            resource_id: ids.length === 1 ? ids[0] : `${ids.length} calls`,
            http_method: 'DELETE',
            http_path: '/api/calls',
            detail_json: JSON.stringify({ ids, requested: ids.length, deleted: rowCount }),
            success: rowCount > 0,
        });
        res.json({ ok: true, deleted: rowCount });
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* 이미 롤백/종료된 트랜잭션 */
        }
        console.error('DELETE /api/calls error:', error);
        res.status(500).json({ message: 'Failed to delete calls.' });
    } finally {
        client.release();
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
app.put('/api/admin/eval-items/:orderNo', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
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

// DELETE /api/admin/eval-items/:orderNo
// 소프트 삭제: 해당 order_no 의 활성 행(전 부서)을 deactivated_at=now() + is_active=false 로 비활성화.
// GET(deactivated_at IS NULL 필터)·평가에서 즉시 제외 → 목록에서 "삭제"로 보이며, 버전/변경 이력은 보존(감사 추적).
// 하드 삭제(row 제거) 아님 — 이력·과거 평가 무결성 유지를 위해 의도적으로 soft-delete.
app.delete('/api/admin/eval-items/:orderNo', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    const orderNo = Number(req.params.orderNo);
    // 부서 스코프(선택): 지정 시 해당 부서 행만 비활성화, 미지정 시 전 부서(하위호환).
    // 같은 order_no 가 부서별로 다른 항목인 경우(예: org3 '기본' 첫인사 vs 'KSQI' 맞이인사)
    // 한 부서 삭제가 타 부서 항목까지 소리 없이 비활성화하던 문제 방지.
    const deptRaw = req.query?.department ?? req.body?.department;
    const department = typeof deptRaw === 'string' && deptRaw.trim() ? deptRaw.trim() : null;
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    if (!Number.isFinite(orderNo)) {
        res.status(400).json({ message: 'orderNo must be a number' });
        return;
    }
    const actor = req.session || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 활성 행 스냅샷 (부서별 1행씩) — 변경 이력 before 용
        const { rows: activeRows } = await client.query(
            `SELECT id, department, version, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active
               FROM public.eval_item_defs
              WHERE org_id = $1 AND order_no = $2 AND deactivated_at IS NULL${department ? ' AND department = $3' : ''}`,
            department ? [orgId, orderNo, department] : [orgId, orderNo]
        );
        if (activeRows.length === 0) {
            await client.query('ROLLBACK').catch(() => {});
            res.status(404).json({ message: 'eval item not found or already deleted' });
            return;
        }

        // 활성 행 비활성화 (department 지정 시 해당 부서만, 미지정 시 전 부서)
        await client.query(
            `UPDATE public.eval_item_defs
                SET deactivated_at = now(), is_active = false, updated_at = now()
              WHERE org_id = $1 AND order_no = $2 AND deactivated_at IS NULL${department ? ' AND department = $3' : ''}`,
            department ? [orgId, orderNo, department] : [orgId, orderNo]
        );

        // 부서별 삭제 이력 (change_type='delete')
        for (const row of activeRows) {
            const beforeJson = {
                category: row.category, item: row.item,
                criterion: row.criterion, prompt_template: row.prompt_template,
                pentagon_axis: row.pentagon_axis, scoring_type: row.scoring_type,
                max_score: row.max_score, is_active: row.is_active, version: row.version,
            };
            await client.query(
                `INSERT INTO public.eval_item_change_log
                   (org_id, department, order_no, item_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, $2, $3, $4, $5, $6, 'delete', $7::jsonb, NULL, $8, $9, $10)`,
                [
                    orgId, row.department, orderNo,
                    row.item, row.category, row.version,
                    JSON.stringify(beforeJson),
                    actor.user_id ?? null, actor.login_id ?? null, actor.display_name ?? null,
                ]
            );
        }

        await client.query('COMMIT');
        res.json({ ok: true, order_no: orderNo, deleted: activeRows.length });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('DELETE /api/admin/eval-items/:orderNo error:', error);
        res.status(500).json({ message: 'Failed to delete eval item.' });
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
app.post('/api/admin/eval-items', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
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

        // order_no 발급: 활성 행 기준 사용 안 된 최소 양의 정수 (gap-fill).
        // soft-delete(deactivated_at) 로 비운 슬롯은 재사용 가능 — 전부 삭제 후 추가하면 #1 부터,
        // 부분 삭제 후 추가하면 빈 자리를 채운다. (version 카운터는 org+department 전역 단조라
        // 같은 order_no 재발급 시에도 versioned_uk 충돌 없음.)
        const { rows: usedRows } = await client.query(
            `SELECT DISTINCT order_no
               FROM public.eval_item_defs
              WHERE org_id = $1 AND deactivated_at IS NULL`,
            [orgId]
        );
        const usedSet = new Set(usedRows.map((r) => Number(r.order_no)));
        let nextOrderNo = 1;
        while (usedSet.has(nextOrderNo)) nextOrderNo++;

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
app.post('/api/admin/pentagon-axes', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
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
app.put('/api/admin/pentagon-axes/:axisNo', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
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
        const whereSql = where.join(' AND ');
        params.push(effectiveLimit);
        const limitParam = `$${params.length}`;
        // 평가항목(eval_item_change_log) + 펜타곤 축(pentagon_axis_change_log) 통합 이력.
        // 펜타곤 행은 axis_no→order_no, label_snapshot→item_name, category_name='펜타곤 축' 로 매핑하고
        // source 로 출처 구분(프론트가 행 key·diff 그룹핑에 사용 — 두 테이블 id 충돌 방지).
        // 두 WHERE 는 동일 placeholder($1..) 재사용. change_type 필터는 각 테이블 값에만 매칭(전체면 둘 다 표시).
        const { rows } = await pool.query(
            `SELECT id, department, order_no, item_name, category_name,
                    change_type, version, before_json, after_json,
                    user_id, login_id, display_name, changed_at, 'eval_item' AS source
               FROM public.eval_item_change_log
              WHERE ${whereSql}
            UNION ALL
             SELECT id, department, axis_no AS order_no, label_snapshot AS item_name,
                    '펜타곤 축' AS category_name,
                    change_type, version, before_json, after_json,
                    user_id, login_id, display_name, changed_at, 'pentagon_axis' AS source
               FROM public.pentagon_axis_change_log
              WHERE ${whereSql}
              ORDER BY changed_at DESC
              LIMIT ${limitParam}`,
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
    // [RAG·사전 로그, additive] 평가 잡 진행 중 흘러오는 RAG few-shot hit(라이브)을 인메모리 링버퍼에 적재.
    // 평가 결과의 금지어/사전 매칭은 잡 완료 후 extractForbiddenFromResult 로 별도 push.
    const callOrgId = Number(call?.org_id);
    const ragOrgId = Number.isFinite(callOrgId) ? callOrgId : undefined;
    // 파이프라인이 forward 한 원 resp(있으면) — 금지어 추출용. onProgress(type==='result') 로 도착.
    let capturedRawResp = null;
    // [LLM 스킬 로그, additive] 평가 중 항목별 스킬 overlay 적용 이벤트 집계 — 잡 완료 시 1건 요약 적재.
    const skillOverlayEvents = [];
    const onProgress = (ev) => {
        if (!ev || typeof ev !== 'object') return;
        // 신규: LLM 스킬 overlay 적용 라이브 이벤트 — 잡 단위 집계(개별 push 는 링버퍼 노이즈).
        if (ev.type === 'skill_overlay') {
            if (ev.data && typeof ev.data === 'object') skillOverlayEvents.push(ev.data);
            return;
        }
        // 신규: RAG few-shot hit 라이브 이벤트 → 계약 레코드(kind:'rag') 적재. (기존 status 흐름 불변)
        if (ev.type === 'rag_hits') {
            try {
                const d = ev.data || {};
                const hits = Array.isArray(d.fewshot) ? d.fewshot : [];
                // 0-hit(미적중) 도 "RAG 조회 활동"으로 적재 — 사용자가 RAG 가 돌았는지 확인 가능하게.
                //   잔존(stale) 노이즈는 GET /api/rag-log/recent 의 qa_id 스코프 + within_minutes 윈도우로 차단.
                //   (주의: PURE 평가 경로는 백엔드가 0-hit 시 rag_hits 이벤트 자체를 보내지 않으므로 — evaluator.py emit 가드 —
                //    이 적재만으로 PURE 0-hit 은 안 보임. 백엔드 검토안 적용 시 가시화됨. CUSTOM_RUBRIC·금지어·hit≥1 은 즉시 표시.)
                // STT 전체 원문(parsed_text)은 길 수 있어 인메모리 RAG_LOG 비대화 방지로 cap.
                const _capText = (v, n) => {
                    const s = String(v ?? '');
                    return s.length > n ? s.slice(0, n) + ' …' : s;
                };
                pushRagLog({
                    qa_id: job.qa_id,
                    org_id: ragOrgId,
                    item_number: Number(d.item_number),
                    // 항목명 — 백엔드 emit_rag_hits_ready 가 보내는 실제 평가항목명. intent(general_inquiry)로
                    //   폴백하지 않음(폴백 시 이름 자리에 intent 가 중복 표시되던 문제). 없으면 프론트가 #번호 표시.
                    item_name: d.item_name || undefined,
                    kind: 'rag',
                    // 검색어/intent — 리치 카드 상단 표시용(UnifiedRagPanel QueryDisplay 동형).
                    fewshot_query: d.fewshot_query ? _capText(d.fewshot_query, 4000) : undefined,
                    intent: d.intent || undefined,
                    // ★ 리치 골든셋 카드(프론트 RagGoldenCard)용 — 백엔드 emit_rag_hits_ready 가 보내는
                    //   전체 필드 보존(압축 금지). segment_text/rationale/parsed_text/index_summary/
                    //   score_bucket/cos·rrf·rerank/rater_meta 모두 카드 토글 섹션에서 소비.
                    hits: hits.map((h) => ({
                        example_id: String(h?.example_id ?? ''),
                        item_number: h?.item_number ?? Number(d.item_number),
                        // 평가 score 부재(루브릭 예시 스토어) 시 코사인 유사도를 표시값으로 폴백.
                        score:
                            h?.score ??
                            (typeof h?.cosine_score === 'number'
                                ? Math.round(h.cosine_score * 100) / 100
                                : typeof h?.similarity === 'number'
                                  ? Math.round(h.similarity * 100) / 100
                                  : null),
                        // 항목 만점 — 카드 "人 N/M" 분모 표시용(관측 전용).
                        max_score: typeof h?.max_score === 'number' ? h.max_score : undefined,
                        score_bucket: h?.score_bucket ?? undefined,
                        intent: h?.intent ?? undefined,
                        // 가져온 예시 내용: 골든 원문(segment_text) 우선, 없으면 색인요약/근거.
                        summary: h?.segment_text || h?.index_summary || h?.rationale || undefined,
                        // ── 리치 카드 섹션 본문 ──
                        segment_text: _capText(h?.segment_text, 8000) || undefined,
                        rationale: _capText(h?.rationale, 4000) || undefined,
                        rationale_tags: Array.isArray(h?.rationale_tags) ? h.rationale_tags : undefined,
                        parsed_text: _capText(h?.parsed_text, 16000) || undefined,
                        index_summary: _capText(h?.index_summary, 4000) || undefined,
                        // ── 유사도/리랭크 칩 ──
                        cosine_score: typeof h?.cosine_score === 'number' ? h.cosine_score : undefined,
                        rrf_score: typeof h?.rrf_score === 'number' ? h.rrf_score : undefined,
                        bm25_score: typeof h?.bm25_score === 'number' ? h.bm25_score : undefined,
                        similarity: typeof h?.similarity === 'number' ? h.similarity : undefined,
                        cohere_rerank_score:
                            typeof h?.cohere_rerank_score === 'number' ? h.cohere_rerank_score : undefined,
                        reranked: h?.reranked ?? undefined,
                        rerank_provider: h?.rerank_provider ?? undefined,
                        rerank_skipped_reason: h?.rerank_skipped_reason ?? undefined,
                        // ── 검수자 메타 ──
                        rater_type: h?.rater_type ?? undefined,
                        rater_source: h?.rater_source ?? undefined,
                    })),
                });
            } catch {
                /* 로그 적재 실패는 평가에 영향 없음 */
            }
            return;
        }
        // 신규: 파이프라인이 원 resp 를 forward 하면 캡처(금지어 추출용). 진행 표시에는 영향 없음.
        if (ev.type === 'result') {
            if (ev.data && typeof ev.data === 'object') capturedRawResp = ev.data;
            return;
        }
        // 기존: 노드 진행(status). 신규 래핑(type:'status') / 레거시 평면 모두 수용.
        const stat = ev.type === 'status' ? ev.data?.status : ev.status;
        const node = String((ev.type === 'status' ? ev.data?.node : ev.node) || '').trim();
        if (!node) return;
        if (PROGRESS_HIDDEN_NODE.test(node)) return;
        const p = job.progress;
        p.last_event_at = Date.now();
        if (stat === 'started') {
            if (!p.running_nodes.includes(node)) p.running_nodes.push(node);
        } else if (stat === 'completed') {
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
            // [RAG·사전 로그, additive] 평가 결과에서 금지어/사전·규칙 매칭 추출 → 계약 레코드(kind:'forbidden') 적재.
            // 파이프라인이 원 resp 를 forward(onProgress type:'result')했을 때만 동작. 실패는 무시(무회귀).
            try {
                if (capturedRawResp && typeof extractForbiddenFromResult === 'function') {
                    const forbidden = extractForbiddenFromResult(capturedRawResp) || [];
                    for (const f of forbidden) {
                        pushRagLog({
                            qa_id: result.qa_id ?? job.qa_id,
                            org_id: ragOrgId,
                            item_number: Number(f?.item_number),
                            item_name: f?.item_name || undefined,
                            kind: 'forbidden',
                            matches: Array.isArray(f?.matches)
                                ? f.matches.map((m) => ({
                                      term: m?.term ?? undefined,
                                      rule_ref: m?.rule_ref ?? undefined,
                                      verdict: m?.verdict ?? undefined,
                                      quote: m?.quote ?? m?.agent_quote ?? undefined,
                                  }))
                                : [],
                        });
                    }
                }
            } catch {
                /* 금지어 추출/적재 실패는 평가에 영향 없음 */
            }
            // [LLM 스킬 로그, additive] 평가 시 스킬 overlay 적용 요약 — 항목별 이벤트를 1건으로 집계.
            //   이벤트 자체가 없으면(스킬 게이트 비활성 콜) 적재하지 않음 — 허위 '미적용' 노이즈 방지.
            try {
                if (skillOverlayEvents.length) {
                    const applied = skillOverlayEvents.filter((e) => e && e.applied);
                    const vid = (skillOverlayEvents.find((e) => e && e.version_id) || {}).version_id || null;
                    pushSkillLog({
                        org_id: ragOrgId,
                        source: 'evaluate',
                        stage: 'apply',
                        message: `평가 ${result.qa_id ?? job.qa_id} — 스킬 overlay 주입 ${applied.length}/${skillOverlayEvents.length}개 항목${vid ? ` · 버전 ${vid}` : ''}${applied.length === 0 ? ' (활성 버전에 해당 항목 룰 없음)' : ''}`,
                        qa_id: result.qa_id ?? job.qa_id,
                        version_id: vid,
                        items_changed: applied.map((e) => Number(e.item_number)).filter(Number.isFinite),
                    });
                }
            } catch {
                /* 스킬 로그 적재 실패는 평가에 영향 없음 */
            }
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

// [RAG·사전 로그, additive] 백엔드 RAG few-shot hit / 금지어·사전 매칭 인메모리 로그 조회.
// limit(기본 100, 1~500) · qa_id(옵션 필터). 최신순으로 slice 반환. DB 미조회(인메모리 링버퍼).
// 평가 시 disable_rag=false 여야 RAG hit 이 발생(대시보드 기본 모드는 RAG OFF → 빈 결과).
app.get('/api/rag-log/recent', requireAdmin, (req, res) => {
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    limit = Math.min(Math.max(1, Math.trunc(limit)), RAG_LOG_MAX);
    const qaId = String(req.query.qa_id || '').trim();
    // 잔존 노이즈 차단: RAG_LOG 는 글로벌·평가간 미클리어라 0-hit 적재 후 과거 콜이 섞여 보일 수 있음.
    //   qa_id 지정 시 그 콜만(윈도우 무시). 미지정(탭 기본 폴링) 시 within_minutes(기본 60분) 밖은 컷.
    let withinMin = Number(req.query.within_minutes);
    if (!Number.isFinite(withinMin) || withinMin <= 0) withinMin = 60;
    let rows = RAG_LOG;
    if (qaId) {
        rows = rows.filter((e) => String(e.qa_id ?? '') === qaId);
    } else {
        const cutoff = Date.now() - withinMin * 60 * 1000;
        rows = rows.filter((e) => (e.ts || 0) >= cutoff);
    }
    // 최신순(ts 내림차순) — 원본 링버퍼는 변형하지 않도록 복사 후 정렬.
    const entries = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
    res.json({ entries });
});

// 루브릭 few-shot 항목 토글 설정 — UI 에서 "이 항목만 RAG" 를 켜고 끄는 영속 설정.
// shape: { "<org_id>": { rubric_id, item_names:[...] } }. DB(organizations) 영속, 평가 시
// evaluateStandardCall 이 getOrgFewshot 으로 읽음.
app.get('/api/rag-fewshot-config', requireAdmin, async (req, res) => {
    try {
        res.json({ config: await loadRagFewshotConfig(pool) });
    } catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
});

app.put('/api/rag-fewshot-config', requireAdmin, async (req, res) => {
    try {
        // body 가 {config:{...}} 또는 설정 객체 자체 둘 다 수용.
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const cfg = body.config && typeof body.config === 'object' ? body.config : body;
        const saved = await saveRagFewshotConfig(pool, cfg);
        res.json({ ok: true, config: saved });
    } catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
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

/* ── 코칭 배정 근거용: 특정 상담사의 콜 이력(페이징) ───────────────
 * GET /api/agents/:agentId/calls  (관리자 전용)
 * 배정 모달에서 "이 상담사의 어떤 콜이 문제였나"를 고르기 위한 경량 피커 소스.
 *   query: from,to(YYYY-MM-DD, CDATE 기준 포함) · io('I'|'O') · sort('score'|'date') · page · limit(기본15)
 *   기본 정렬 = 저점수(코칭구간) 우선. org 스코프. /api/calls 와 동일 유니버스(평가된 콜).
 * ────────────────────────────────────────────────────────── */
app.get('/api/agents/:agentId/calls', requireAdmin, async (req, res) => {
    try {
        const agentId = Number(req.params.agentId);
        if (!Number.isFinite(agentId)) {
            res.status(400).json({ message: 'invalid agentId' });
            return;
        }
        const orgId = resolveActiveOrgId(req);
        const params = [agentId];
        const conds = [`c.agent_user_id = $1`];
        if (orgId != null) { params.push(orgId); conds.push(`c.org_id = $${params.length}`); }
        const io = String(req.query.io || '').toUpperCase();
        if (io === 'I' || io === 'O') { params.push(io); conds.push(`c.io_divi = $${params.length}`); }
        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); conds.push(`left(c."CDATE",10) >= $${params.length}`); }
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); conds.push(`left(c."CDATE",10) <= $${params.length}`); }
        // 평가된 콜만(= /api/calls 유니버스). 포기호/미응대 제외.
        conds.push(`(
            EXISTS (SELECT 1 FROM qa_evaluation_rows er    WHERE er."ID" = c."ID")
         OR EXISTS (SELECT 1 FROM qa_consumer_eval_rows cr WHERE cr."ID" = c."ID")
         OR EXISTS (SELECT 1 FROM qa_checklist_rows kr     WHERE kr."ID" = c."ID")
        )`);
        conds.push(`EXISTS (SELECT 1 FROM qa_conversations q WHERE q."ID" = c."ID" AND q.speaker = '상담사')`);
        const where = `WHERE ${conds.join(' AND ')}`;
        const order = req.query.sort === 'date'
            ? `c."CDATE" DESC`
            : `c."TOTAL_SCORE" ASC NULLS LAST, c."CDATE" DESC`;   // 기본: 저점수 우선
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
        const page = Math.max(1, Number(req.query.page) || 1);
        const offset = (page - 1) * limit;

        const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM qa_calls c ${where}`, params);
        const total = cnt[0]?.n || 0;
        const itemsParams = params.slice();
        itemsParams.push(limit, offset);
        const { rows } = await pool.query(
            `SELECT c."ID" AS id, c."CDATE" AS date, c."TOTAL_SCORE" AS score,
                    c."UID" AS uid, c."CALL_SEQ" AS call_no, c.io_divi AS io_divi
               FROM qa_calls c ${where}
              ORDER BY ${order}
              LIMIT $${itemsParams.length - 1} OFFSET $${itemsParams.length}`,
            itemsParams
        );
        res.json({
            total, page, limit,
            items: rows.map((r) => ({
                id: r.id,
                date: r.date,
                score: r.score == null ? null : Number(r.score),
                uid: r.uid,
                callNo: r.call_no,
                ioDivi: r.io_divi,
                channel: r.io_divi === 'I' ? 'inbound' : r.io_divi === 'O' ? 'outbound' : null,
            })),
        });
    } catch (error) {
        console.error('GET /api/agents/:agentId/calls error:', error);
        res.status(500).json({ message: 'Failed to load agent calls.' });
    }
});

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
        // 배정 근거(문제 콜) — 관리자는 전 멤버 근거 열람. 멤버별로 묶어 상세 모달에서 표시.
        const reasonsByAssignment = new Map();
        const _rids = rows.map((r) => r.id);
        if (_rids.length) {
            const { rows: rrows } = await pool.query(
                `SELECT r.assignment_id, r.member_user_id, r.qa_call_id, r.note,
                        COALESCE(c."CDATE", r.call_date) AS date,
                        COALESCE(c."TOTAL_SCORE", r.score) AS score,
                        c."UID" AS uid, c."CALL_SEQ" AS call_no, c.io_divi
                   FROM public.coaching_assignment_reasons r
                   LEFT JOIN public.qa_calls c ON c."ID" = r.qa_call_id
                  WHERE r.assignment_id = ANY($1::bigint[])
                  ORDER BY score ASC NULLS LAST`,
                [_rids]
            );
            for (const rr of rrows) {
                if (!reasonsByAssignment.has(rr.assignment_id)) reasonsByAssignment.set(rr.assignment_id, []);
                reasonsByAssignment.get(rr.assignment_id).push({
                    memberUserId: rr.member_user_id,
                    callId: rr.qa_call_id,
                    date: rr.date,
                    score: rr.score == null ? null : Number(rr.score),
                    uid: rr.uid,
                    callNo: rr.call_no,
                    channel: rr.io_divi === 'I' ? 'inbound' : rr.io_divi === 'O' ? 'outbound' : null,
                    note: rr.note || null,
                });
            }
        }
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
                reasons: reasonsByAssignment.get(row.id) || [],  // 멤버별 배정 근거(콜)
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
        const reasons = Array.isArray(b.reasons) ? b.reasons : [];   // [{memberId, callIds[], note}] — 배정 근거(선택)
        if (!title) {
            res.status(400).json({ message: 'title is required' });
            return;
        }
        if (!members.length) {
            res.status(400).json({ message: '대상 상담사를 1명 이상 선택하세요.' });
            return;
        }
        const orgId = resolveActiveOrgId(req);
        // 배정 + 근거를 한 트랜잭션으로. 근거 콜은 "그 상담사(agent_user_id) 것"인지 검증 후에만 저장.
        const client = await pool.connect();
        let created;
        try {
            await client.query('BEGIN');
            const ins = await client.query(
                `INSERT INTO public.coaching_assignments
                     (org_id, title, target_type, members, action_items, scenario_codes, channel, assigned_by_user_id)
                 VALUES ($1, $2, $3, $4::int[], $5::text[], $6::text[], $7, $8)
                 RETURNING *`,
                [orgId, title, targetType, members, items, scenarios, channel, req.session?.user_id ?? null]
            );
            created = ins.rows[0];
            for (const r of reasons) {
                const memberId = Number(r?.memberId);
                if (!Number.isFinite(memberId) || !members.includes(memberId)) continue;   // 대상에 없는 멤버 무시
                const callIds = Array.isArray(r?.callIds) ? r.callIds.map((x) => String(x)).filter(Boolean) : [];
                if (!callIds.length) continue;
                const note = r?.note != null && String(r.note).trim() ? String(r.note).trim() : null;
                // 소유 검증 + 표시 스냅샷: 이 콜들이 정말 memberId 상담사의 콜인지(agent_user_id) 확인.
                const vparams = [callIds, memberId];
                let vsql = `SELECT "ID" AS id, "CDATE" AS date, "TOTAL_SCORE" AS score
                              FROM public.qa_calls WHERE "ID" = ANY($1::text[]) AND agent_user_id = $2`;
                if (orgId != null) { vparams.push(orgId); vsql += ` AND org_id = $3`; }
                const { rows: valid } = await client.query(vsql, vparams);
                for (const vc of valid) {
                    await client.query(
                        `INSERT INTO public.coaching_assignment_reasons
                             (assignment_id, member_user_id, qa_call_id, note, call_date, score)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (assignment_id, member_user_id, qa_call_id) DO NOTHING`,
                        [created.id, memberId, vc.id, note, vc.date, vc.score]
                    );
                }
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
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
        // 본인 근거(문제 콜) — member_user_id = 본인 인 것만 조회(프라이버시). 콜 삭제 시 스냅샷 폴백.
        const reasonsByAssignment = new Map();
        const _rids = rows.map((r) => r.id);
        if (_rids.length) {
            const { rows: rrows } = await pool.query(
                `SELECT r.assignment_id, r.qa_call_id, r.note,
                        COALESCE(c."CDATE", r.call_date) AS date,
                        COALESCE(c."TOTAL_SCORE", r.score) AS score,
                        c."UID" AS uid, c."CALL_SEQ" AS call_no, c.io_divi
                   FROM public.coaching_assignment_reasons r
                   LEFT JOIN public.qa_calls c ON c."ID" = r.qa_call_id
                  WHERE r.member_user_id = $1 AND r.assignment_id = ANY($2::bigint[])
                  ORDER BY score ASC NULLS LAST`,
                [uid, _rids]
            );
            for (const rr of rrows) {
                if (!reasonsByAssignment.has(rr.assignment_id)) reasonsByAssignment.set(rr.assignment_id, []);
                reasonsByAssignment.get(rr.assignment_id).push({
                    callId: rr.qa_call_id,
                    date: rr.date,
                    score: rr.score == null ? null : Number(rr.score),
                    uid: rr.uid,
                    callNo: rr.call_no,
                    channel: rr.io_divi === 'I' ? 'inbound' : rr.io_divi === 'O' ? 'outbound' : null,
                    note: rr.note || null,
                });
            }
        }
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
                reasons: reasonsByAssignment.get(row.id) || [],  // 배정 근거(본인 콜만)
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
        // 골든셋 배치 '적용 평가 항목' = 평가 시 RAG 사용 항목(단일 컨트롤). 체크(=미제외)된 항목의
        //   이름을 organizations.rag_fewshot_item_names 로 동기화 → 그 항목만 평가 시 few-shot RAG 사용
        //   (getOrgFewshot 게이트). 색인(golden.excluded→allowed_items)과 동일 체크박스가 구동.
        await syncRagFewshotFromGolden(orgId, config).catch(() => {});
        // LLM 스킬 '적용 평가 항목'(config.skill.excluded, order_no) → 파이프라인 스킬 설정
        //   (PUT /v2/mtg-skill/{rubric}/settings, item_number) 동기화 — fire-and-forget(실패해도 저장은 성공).
        if (orgId !== 0 && config.skill && Array.isArray(config.skill.excluded)) {
            pushSkillSettings(pool, orgId, config.skill.excluded)
                .then((r) => {
                    if (r && r.ok === false) logger.warn(`[skill-learn] 설정 동기화 실패(org=${orgId}): ${r.error || '미상'}`);
                })
                .catch((e) => logger.warn(`[skill-learn] 설정 동기화 실패(org=${orgId}): ${e?.message || e}`));
        }
        res.json({ ok: true, org_id: orgId });
    } catch (e) {
        console.error('PUT /api/batch/config error:', e?.message || e);
        res.status(500).json({ ok: false, message: '배치 설정 저장 실패' });
    }
});

// 골든셋 배치 '적용 평가 항목' → 평가 시 RAG 항목(organizations.rag_fewshot_item_names) 동기화.
//   체크(=config.golden.excluded 에 없는) 항목의 이름을 RAG 사용 목록으로 저장. 항목명 소스는
//   '적용 평가 항목' 칩과 동일(qa_evaluation_rows) — order_no 정합. rubric_id 는 기존값 보존,
//   없으면 rbrc_org{N}(색인측 getOrgFewshot 규칙과 정합). golden 미설정/org 0 이면 무동작.
//   전 항목 제외(체크 0) → item_names 빈 배열 → getOrgFewshot null → 평가 시 RAG 전면 OFF.
async function syncRagFewshotFromGolden(orgId, config) {
    if (!orgId || Number(orgId) === 0) return;
    const golden = config && config.golden;
    if (!golden || !Array.isArray(golden.excluded)) return; // 골든 섹션 없는 저장은 건드리지 않음
    const excludedSet = new Set(golden.excluded.map(Number).filter(Number.isFinite));
    // '적용 평가 항목' 칩과 동일 소스로 order_no → 항목명(정합 보장).
    const { rows } = await pool.query(
        `SELECT er.order_no, max(er.item) AS item
           FROM qa_evaluation_rows er
           JOIN qa_calls c ON c."ID" = er."ID"
          WHERE c.is_sandbox = false AND c.org_id = $1
          GROUP BY er.order_no ORDER BY er.order_no`,
        [orgId]
    );
    const includedNames = rows
        .filter((r) => !excludedSet.has(Number(r.order_no)))
        .map((r) => String(r.item || '').trim())
        .filter(Boolean);
    // rubric_id: 기존값 보존(org10=rbrc_asdf_org10 등 특수 유지), 없으면 rbrc_org{N}.
    const { rows: orgRows } = await pool.query(
        `SELECT rag_rubric_id FROM public.organizations WHERE id = $1 LIMIT 1`,
        [orgId]
    );
    const existingRubric = String(orgRows[0]?.rag_rubric_id || '').trim();
    const rubricId = existingRubric || `rbrc_org${orgId}`;
    await saveRagFewshotConfig(pool, { [orgId]: { rubric_id: rubricId, item_names: includedNames } });
}

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
            // 수신자: (1) super_admin 전원(브랜드 전환기로 모든 브랜드 관리 — org_id 무관),
            //   (2) 전역 관리자(org_id IS NULL — 이 배포처럼 관리자에 org 미지정),
            //   (3) 해당 브랜드 관리자(org_id = 브랜드). 멀티테넌트/단일 배포 모두 커버.
            const { rows } = await pool.query(
                `SELECT user_id FROM public.admin_users
                  WHERE COALESCE(is_active, 0) <> 0
                    AND role IN ('admin', 'super_admin')
                    AND (role = 'super_admin' OR org_id IS NULL OR org_id = $1)`,
                [orgId]
            );
            for (const r of rows) if (r.user_id != null) recipients.add(Number(r.user_id));
        } catch (e) {
            console.warn('notifyGoldenLearnComplete: 관리자 조회 실패:', e?.message || e);
        }
        if (!recipients.size) return;
        const ok = result?.ok !== false;
        const savedN = result?.saved ?? result?.records ?? '?';
        const goldenN = result?.golden_count ?? '?';
        const srcLabel = source && source.startsWith('schedule') ? '자동(스케줄러)' : '수동';
        const type = ok ? 'golden_learn_completed' : 'golden_learn_failed';
        const title = ok ? '골든셋 학습 완료' : '골든셋 학습 실패';
        const body = ok
            ? `${srcLabel} · 골든 ${goldenN}건 · 색인 ${savedN}건${result?.dry_run ? ' (dry-run)' : ''}`
            : `${srcLabel} · ${result?.error || result?.reason || '오류'}`;
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

// POST /api/golden-learn/run — 골든셋 학습 배치 수동 트리거(백그라운드). 즉시 응답({started:true}) 후
//   triggerGoldenLearn → ingestGoldenSetToRag: qa_golden_set ⋈ 전사 → 백엔드 POST /v2/mtg-rag/{rubric_id}/examples 색인.
//   진행/결과는 GET /api/golden-learn/status 로 폴링. body.dry_run=true 시 AOSS 미기록 프리뷰. 과거 콜 재평가 아님.
app.post('/api/golden-learn/run', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const dryRun = !!(req.body && req.body.dry_run);
    const cur = goldenLearnStatus.get(orgId);
    if (cur && cur.state === 'running') {
        res.json({ ok: true, started: true, already_running: true, org_id: orgId, golden_count: cur.golden_count ?? null });
        return;
    }
    // 즉시 피드백용 빠른 카운트(임베딩 전).
    let goldenCount = null;
    try {
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM public.qa_golden_set WHERE org_id = $1', [orgId]);
        goldenCount = rows[0]?.n ?? null;
    } catch {
        /* 카운트 실패는 무시 — 실행에 영향 없음 */
    }
    const startedAt = Date.now();
    goldenLearnStatus.set(orgId, { state: 'running', source: 'manual', started_at: startedAt, dry_run: dryRun, golden_count: goldenCount, progress: { processed: 0, total: goldenCount || null, saved: 0, skipped: 0, failed: 0 } });
    // 백그라운드 실행 — 즉시 응답(프록시/브라우저 타임아웃 회피). 결과는 status 로 확인.
    (async () => {
        try {
            // 진척 콜백 — ingest 청크마다 progress 갱신 → GET /status 폴링이 진행바에 실시간 반영.
            const onProgress = (p) => {
                const prev = goldenLearnStatus.get(orgId) || {};
                if (prev.state !== 'running') return; // 완료/에러 후 늦은 콜백 무시
                goldenLearnStatus.set(orgId, { ...prev, progress: p });
            };
            const result = await triggerGoldenLearn(pool, orgId, { source: 'manual', dryRun, onProgress });
            goldenLearnStatus.set(orgId, { state: 'done', source: 'manual', started_at: startedAt, finished_at: Date.now(), dry_run: dryRun, golden_count: goldenCount, result });
            await insertQaAuditLog(pool, {
                req,
                action: 'GOLDEN_LEARN_RUN',
                resource_type: 'golden_learn',
                resource_id: String(orgId),
                http_method: 'POST',
                http_path: '/api/golden-learn/run',
                detail_json: JSON.stringify(result),
                success: result.ok,
            }).catch(() => {});
            // 학습 완료 → 알림 센터 통지(트리거 관리자 + 브랜드 관리자). dry-run 프리뷰는 제외.
            if (!dryRun) {
                await notifyGoldenLearnComplete(orgId, result, {
                    actorUserId: req.session?.user_id ?? null,
                    actorName: req.session?.display_name || req.session?.login_id || null,
                    source: 'manual',
                }).catch(() => {});
            }
        } catch (e) {
            console.error('golden-learn background error:', e?.message || e);
            goldenLearnStatus.set(orgId, { state: 'error', started_at: startedAt, finished_at: Date.now(), error: String(e?.message || e) });
        }
    })();
    res.json({ ok: true, started: true, org_id: orgId, golden_count: goldenCount });
});

// GET /api/golden-learn/status — 활성 브랜드의 골든셋 학습 잡 최신 상태(폴링용).
app.get('/api/golden-learn/status', requireAdmin, (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    res.json(goldenLearnStatus.get(orgId) || { state: 'idle' });
});

// GET /api/golden-learn/coverage — 골든셋 규모/학습 기준일(정밀) 표시용.
//   · 테이블: 골든 총 건수(+대화 수) + 골든 최신 등록일(qa_golden_set.created_at MAX = "며칠까지 쌓였나")
//   · 색인(정밀): 백엔드에서 실제 색인된 consultation_id 를 받아 PG created_at 과 조인 → latest_indexed_at
//     (= "며칠까지 진짜 학습됐나"). 재색인 없이 기존 색인 그대로 정확.
//   · needs_relearn: 골든 총량 > 색인량 또는 최신 등록 > 최신 색인 → 미학습분 존재(재학습 필요).
app.get('/api/golden-learn/coverage', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    try {
        // ① 테이블 총량 + 최신 등록일
        const { rows: t } = await pool.query(
            `SELECT COUNT(*)::int AS golden_count,
                    COUNT(DISTINCT qa_id)::int AS conversation_count,
                    MAX(created_at) AS latest_golden_at
               FROM public.qa_golden_set WHERE org_id = $1`,
            [orgId]
        );
        const tot = t[0] || {};
        // ② 색인 커버리지(정밀) — 백엔드에서 색인된 consultation_id 받아 PG created_at 과 조인
        const cov = await fetchGoldenIndexCoverage(pool, orgId);
        let latestIndexedAt = null;
        let indexedConvCount = 0;
        if (cov.consultation_ids && cov.consultation_ids.length) {
            const { rows: ir } = await pool.query(
                `SELECT COUNT(DISTINCT qa_id)::int AS indexed_conversation_count,
                        MAX(created_at) AS latest_indexed_at
                   FROM public.qa_golden_set WHERE org_id = $1 AND qa_id = ANY($2::text[])`,
                [orgId, cov.consultation_ids]
            );
            latestIndexedAt = (ir[0] && ir[0].latest_indexed_at) || null;
            indexedConvCount = (ir[0] && ir[0].indexed_conversation_count) || 0;
        }
        const latestGoldenMs = tot.latest_golden_at ? new Date(tot.latest_golden_at).getTime() : null;
        const latestIndexedMs = latestIndexedAt ? new Date(latestIndexedAt).getTime() : null;
        const needsRelearn = !!(
            (tot.golden_count ?? 0) > (cov.indexed_count ?? 0) ||
            (latestGoldenMs && (!latestIndexedMs || latestGoldenMs > latestIndexedMs))
        );
        const status = goldenLearnStatus.get(orgId) || {};
        res.json({
            org_id: orgId,
            rubric_id: cov.rubric_id,
            golden_count: tot.golden_count ?? 0,
            conversation_count: tot.conversation_count ?? 0,
            latest_golden_at: tot.latest_golden_at || null,
            indexed_count: cov.indexed_count ?? 0,
            indexed_conversation_count: indexedConvCount,
            latest_indexed_at: latestIndexedAt,
            needs_relearn: needsRelearn,
            last_run_at: status.finished_at || null,
            last_run_state: status.state || 'idle',
        });
    } catch (e) {
        res.status(500).json({ message: String(e?.message || e) });
    }
});

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
        }
    };
}

// POST /api/skill-learn/run — 스킬 학습 수동 트리거(백그라운드). 즉시 응답({started:true}) 후
//   triggerSkillLearn → runSkillLearn: 정정 케이스 수집 → 백엔드 POST /v2/mtg-skill/{rubric_id}/generate.
//   진행/결과는 GET /api/skill-learn/status 로 폴링. golden-learn/run 미러.
app.post('/api/skill-learn/run', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const cur = skillLearnStatus.get(orgId);
    if (cur && cur.state === 'running') {
        res.json({ ok: true, started: true, already_running: true, org_id: orgId });
        return;
    }
    const startedAt = Date.now();
    skillLearnStatus.set(orgId, { state: 'running', source: 'manual', started_at: startedAt, stage: 'collect', stage_message: '검수 정정 케이스 수집 중…' });
    pushSkillLog({ org_id: orgId, source: 'manual', stage: 'collect', message: '스킬 학습 시작 — 검수 정정 케이스 수집' });
    // 백그라운드 실행 — 즉시 응답(프록시/브라우저 타임아웃 회피). 결과는 status 로 확인.
    (async () => {
        try {
            const result = await triggerSkillLearn(pool, orgId, {
                source: 'manual',
                onProgress: skillLearnProgressLogger(orgId, 'manual'),
            });
            recordSkillLearnResult(orgId, 'manual', result, startedAt);
            await insertQaAuditLog(pool, {
                req,
                action: 'SKILL_LEARN_RUN',
                resource_type: 'skill_learn',
                resource_id: String(orgId),
                http_method: 'POST',
                http_path: '/api/skill-learn/run',
                detail_json: JSON.stringify(result),
                success: result.ok,
            }).catch(() => {});
        } catch (e) {
            console.error('skill-learn background error:', e?.message || e);
            skillLearnStatus.set(orgId, { state: 'error', source: 'manual', started_at: startedAt, finished_at: Date.now(), error: String(e?.message || e) });
            pushSkillLog({ org_id: orgId, source: 'manual', stage: 'error', message: `스킬 학습 실패 — ${String(e?.message || e)}`, error: String(e?.message || e) });
        }
    })();
    res.json({ ok: true, started: true, org_id: orgId });
});

// GET /api/skill-learn/status — 활성 브랜드의 스킬 학습 잡 최신 상태(폴링용).
//   generate 단계 진행 중이면 파이프라인 status 의 generating {done,total} 을 progress 로 동봉
//   → 프론트 진행바(골든 진행바 미러). 프록시 실패는 progress 생략(상태 응답 무영향).
app.get('/api/skill-learn/status', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const entry = skillLearnStatus.get(orgId) || { state: 'idle' };
    if (entry.state === 'running' && entry.stage === 'generate' && entry.rubric_id) {
        try {
            const g = await fetchSkillGenProgress(entry.rubric_id);
            if (g) {
                res.json({ ...entry, progress: { done: g.done ?? 0, total: g.total ?? null } });
                return;
            }
        } catch { /* 진행률 조회 실패 — progress 없이 상태만 */ }
    }
    res.json(entry);
});

// GET /api/skill-learn/versions — 스킬 버전 목록 프록시(org→rubric_id 해석 후 파이프라인 조회).
app.get('/api/skill-learn/versions', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    res.json(await fetchSkillVersions(pool, orgId));
});

// GET /api/skill-learn/versions/:versionId — 스킬 버전 상세(overlay md + 생성 근거 케이스) 프록시.
app.get('/api/skill-learn/versions/:versionId', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    res.json(await fetchSkillVersionDetail(pool, orgId, String(req.params.versionId || '')));
});

// POST /api/skill-learn/activate — 스킬 버전 활성화/롤백. body {version_id} (null=전체 비활성) 프록시.
app.post('/api/skill-learn/activate', requireAdmin, async (req, res) => {
    const orgId = resolveActiveOrgId(req, { strict: true });
    if (orgId === null || orgId === undefined) {
        res.status(400).json({ message: 'active brand context required' });
        return;
    }
    const versionId = req.body && req.body.version_id != null ? String(req.body.version_id) : null;
    const result = await activateSkillVersion(pool, orgId, versionId);
    if (result && result.ok) {
        pushSkillLog({
            org_id: orgId,
            source: 'manual',
            stage: 'activate',
            message: versionId ? `버전 활성화 — ${versionId}` : '스킬 비활성화(active 버전 해제)',
            rubric_id: result.rubric_id ?? null,
            version_id: versionId,
        });
    }
    res.json(result);
});

// GET /api/skill-log/recent — 스킬 학습 로그 조회(rag-log/recent 미러, 인메모리 링버퍼).
//   limit(기본 100, 1~500) · within_minutes(기본 60분) 밖은 컷. 최신순 {entries} 래핑.
//   브랜드 격리: super_admin 은 전체, 그 외는 세션 org_id 엔트리만(org 미지정 관리자는 전체).
app.get('/api/skill-log/recent', requireAdmin, (req, res) => {
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    limit = Math.min(Math.max(1, Math.trunc(limit)), SKILL_LOG_MAX);
    let withinMin = Number(req.query.within_minutes);
    if (!Number.isFinite(withinMin) || withinMin <= 0) withinMin = 60;
    const cutoff = Date.now() - withinMin * 60 * 1000;
    let rows = SKILL_LOG.filter((e) => (e.ts || 0) >= cutoff);
    if (req.session?.role !== 'super_admin' && req.session?.org_id != null) {
        rows = rows.filter((e) => Number(e.org_id) === Number(req.session.org_id));
    }
    // 최신순(ts 내림차순) — 원본 링버퍼는 변형하지 않도록 복사 후 정렬.
    const entries = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
    res.json({ entries });
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
        const bHighRel = bias.highMode === 'rel';        // 평균점수 이상: 상대값(평균 대비 +N) | 절대값
        const bHighRelPts = num(bias.highRel, 0);
        // ② 신뢰도 — 저장된 LLM 판정(qa_confidence_judgments)을 선택 항목으로 스코프해서 필터.
        const uncOn = !!conf.uncertain;
        const conOn = !!conf.contradiction;
        const confOn = !!(on.confidence && (uncOn || conOn));
        // 적용 평가 항목: excluded(order_no 배열) 제외 = 나머지만 검사. 빈 배열이면 전 항목.
        const excluded = Array.isArray(conf.excluded)
            ? conf.excluded.map((x) => Number(x)).filter((n) => Number.isInteger(n))
            : [];

        // ⑤ 무작위 표본 — 결정적 해시 샘플링(콜별 고정)으로 in-scope 의 약 pct% 를 표본화.
        //   추정치가 아니라 manualReview 도장과 동일한 식으로 실제 카운트 → preview = 실제.
        const randomOn = !!(on.bias && bias.random);
        const randomPct = num(bias.randomPct, 0);

        // ④ 근속(대상자 특정) — 상담사 입사일(trainee_registrations.hire_date) 기준. 도장 로직과 동일 식.
        const tenure = cfg.tenure || {};
        const tjOn = !!(on.tenure && tenure.junior);
        const tjM = Math.max(0, Math.round(num(tenure.juniorMonths, 6)));
        const tsOn = !!(on.tenure && tenure.senior);
        const tsY = Math.max(0, Math.round(num(tenure.seniorYears, 5)));

        const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, confOn, uncOn, conOn, excluded, randomOn, randomPct, tjOn, tjM, tsOn, tsY, bHighRel, bHighRelPts];
        let orgClause = '';
        if (orgId !== 0) { params.push(orgId); orgClause = `AND c.org_id = $${params.length}`; }

        const sql = `
            WITH scoped AS (
                SELECT c."ID" AS id, c."TOTAL_SCORE"::numeric AS score, c.duration_sec, cj.judgments,
                       tr.hire_date AS hire_date
                  FROM qa_calls c
                  LEFT JOIN qa_confidence_judgments cj ON cj.qa_id = c."ID"
                  LEFT JOIN trainee_registrations tr ON tr.user_id = c.agent_user_id
                 WHERE c.is_sandbox = false ${orgClause}
            ), in_scope AS (
                SELECT id, score, duration_sec, judgments, hire_date FROM scoped
                 WHERE duration_sec IS NOT NULL AND duration_sec >= $1 AND duration_sec < $2
            ), agg AS (
                SELECT avg(score) AS org_avg FROM in_scope
            ), flagged AS (
                SELECT
                    ($3 AND ( ($4 AND a.org_avg IS NOT NULL AND i.score <= a.org_avg - $5) OR (NOT $4 AND i.score < $6) )) AS q_match,
                    ($7 AND ( ($19 AND a.org_avg IS NOT NULL AND i.score >= a.org_avg + $20) OR (NOT $19 AND i.score >= $8) )) AS b_match,
                    ($9 AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(coalesce(i.judgments, '[]'::jsonb)) e
                         WHERE NOT ((e->>'order_no')::int = ANY($12::int[]))
                           AND ( ($10 AND (e->>'uncertain')::boolean) OR ($11 AND (e->>'contradiction')::boolean) )
                    )) AS c_match,
                    ($13 AND (((hashtext(i.id) % 100) + 100) % 100) < $14) AS r_match,
                    ($15 AND i.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND i.hire_date::date >= (CURRENT_DATE - make_interval(months => $16))) AS te_j_match,
                    ($17 AND i.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND i.hire_date::date <= (CURRENT_DATE - make_interval(years  => $18))) AS te_s_match,
                    (i.judgments IS NOT NULL) AS judged
                  FROM in_scope i CROSS JOIN agg a
            )
            SELECT
                (SELECT count(*) FROM scoped)::int   AS pool,
                (SELECT count(*) FROM in_scope)::int AS in_scope_cnt,
                (SELECT round(org_avg, 1) FROM agg)  AS org_avg,
                count(*) FILTER (WHERE q_match)::int  AS quality_cnt,
                count(*) FILTER (WHERE b_match)::int  AS bias_high_cnt,
                count(*) FILTER (WHERE r_match)::int  AS bias_random_cnt,
                count(*) FILTER (WHERE b_match OR r_match)::int AS bias_cnt,
                count(*) FILTER (WHERE c_match)::int  AS confidence_cnt,
                count(*) FILTER (WHERE te_j_match)::int AS tenure_junior_cnt,
                count(*) FILTER (WHERE te_s_match)::int AS tenure_senior_cnt,
                count(*) FILTER (WHERE te_j_match OR te_s_match)::int AS tenure_cnt,
                count(*) FILTER (WHERE judged)::int   AS judged_cnt,
                count(*) FILTER (WHERE q_match OR b_match OR c_match OR r_match OR te_j_match OR te_s_match)::int AS union_cnt
            FROM flagged`;

        const { rows } = await pool.query(sql, params);
        const r = rows[0] || { pool: 0, in_scope_cnt: 0, org_avg: null, quality_cnt: 0, bias_high_cnt: 0, bias_random_cnt: 0, bias_cnt: 0, confidence_cnt: 0, tenure_junior_cnt: 0, tenure_senior_cnt: 0, tenure_cnt: 0, judged_cnt: 0, union_cnt: 0 };

        const totalTargets = r.union_cnt || 0; // union 은 in_scope 부분집합 — 실제 도장 대상 수와 일치

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
                tenure: on.tenure
                    ? { supported: true, count: r.tenure_cnt,
                        junior_count: r.tenure_junior_cnt, senior_count: r.tenure_senior_cnt,
                        note: `신입 ${r.tenure_junior_cnt}건 + 장기근속 ${r.tenure_senior_cnt}건 (입사일 기준)` }
                    : { supported: true, count: 0, note: '비활성' },
                bias: on.bias
                    ? { supported: true, count: r.bias_cnt,
                        high_count: r.bias_high_cnt, random_count: r.bias_random_cnt,
                        note: randomOn ? `무작위 표본 ${r.bias_random_cnt}건(약 ${randomPct}%) + 고점 ${r.bias_high_cnt}건` : null }
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
        // 변경 이력 append(읽기전용 스냅샷). 실패해도 저장은 성공으로 처리.
        try {
            await pool.query(
                `INSERT INTO public.qa_batch_prompt_history
                     (org_id, version, uncertain_def, contradiction_def, updated_at, updated_by, updated_by_name)
                 VALUES ($1, $2, $3, $4, now(), $5, $6)`,
                [PROMPT_ORG, version, newU, newC, updatedBy, req.session?.display_name ?? null]
            );
        } catch (he) { console.error('prompt history insert error:', he?.message || he); }
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

// POST /api/batch/run — 수기평가 대상 도장 즉시 실행(수동 트리거). 배치주기 '수동'/'매일'/'매시간'에서
//   '지금 실행' 버튼이 호출. in-scope 전체 미도장 대상에 도장(멱등·누적). body 없음.
app.post('/api/batch/run', requireAdmin, async (req, res) => {
    try {
        const orgId = batchOrgKey(req);
        const stamped = await applyManualReviewStamps(pool, orgId, { qaIds: null });
        res.json({ ok: true, org_id: orgId, stamped });
    } catch (e) {
        console.error('POST /api/batch/run error:', e?.message || e);
        res.status(500).json({ ok: false, message: '배치 실행 실패' });
    }
});

// GET /api/batch/prompt/history — 판정 프롬프트 변경 이력(버전별 스냅샷, 최신순). 읽기전용.
app.get('/api/batch/prompt/history', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT version, uncertain_def, contradiction_def, updated_at, updated_by, updated_by_name
               FROM public.qa_batch_prompt_history
              WHERE org_id = $1
              ORDER BY version DESC, id DESC
              LIMIT 100`,
            [PROMPT_ORG]
        );
        res.json({ ok: true, items: rows });
    } catch (e) {
        console.error('GET /api/batch/prompt/history error:', e?.message || e);
        res.status(500).json({ ok: false, message: '변경 이력 조회 실패' });
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
