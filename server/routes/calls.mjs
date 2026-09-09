// 콜 목록 · 상담사 · 통계 · 평가 상세/수정 · 검수 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 10개 · 함께 옮긴 헬퍼/상태 25개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createCallRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { AUDIT_ACTION, insertQaAuditLog } from '../auditLog.mjs';
import { buildChecklistYnKorFromDbRows, effectiveChecklistKeys } from '../checklistCategorySummary.mjs';
import { MANUAL_JUDGMENT_LABELS, computeManualRubricPct, maxPointsOf, mergeManualPatches, parseStoredEarned, validateMergedManualEvals } from '../rubricManual.mjs';
import { SANDBOX_LOGIN_ID } from '../sandboxSession.mjs';

export function createCallRoutes(ctx) {
    const { DEFAULT_RADAR_KEYS, HANWHA_RADAR_KEYS, buildPentagonByAxisDefs, clamp0to100, createNotification, defaultCategoryPct, orderNoPct, pool, requireAdmin, resolveActiveOrgId, round1 } = ctx;
    const router = express.Router();

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
            const maxPts = maxPointsOf(row);
            if (maxPts === null) continue;   // 만점 없음 = 분모 제외 (구 모델의 체크리스트 행 부재)
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

    const DEFAULT_RADAR_REPORT_ITEMS = HANWHA_RADAR_REPORT_ITEMS;

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
            agent_user_id: row.agent_user_id ?? null,  // 계정 연결 정본 — 코칭 근거(코칭 배정) 상담사 매칭용
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
            // KSQI 평가 — 시행 여부 + 영역 점수(별개 축). qa_call_ksqi_summary(정규화 테이블) 조인 결과이며
            // 테이블 부재 시 has_ksqi=false·점수 null. KSQI 평가 워크스페이스 탭의 목록 필터(시행 콜만)·
            // 점수 컬럼(A/B/전체)에서 사용.
            has_ksqi: row.has_ksqi === true || row.has_ksqi === 't',
            ksqi_a: row.ksqi_a === null || row.ksqi_a === undefined ? null : Number(row.ksqi_a),
            ksqi_b: row.ksqi_b === null || row.ksqi_b === undefined ? null : Number(row.ksqi_b),
            ksqi_overall_raw:
                row.ksqi_overall_raw === null || row.ksqi_overall_raw === undefined ? null : Number(row.ksqi_overall_raw),
            ksqi_overall_max:
                row.ksqi_overall_max === null || row.ksqi_overall_max === undefined ? null : Number(row.ksqi_overall_max),
        };
    }

    // 상담사(role='agent')는 "본인이 응대한 콜"만 볼 수 있다. common.calls.agent_user_id = 본인 user_id.
    // admin/super_admin 은 제한 없음(''). params 배열에 값을 push 하고 SQL 조각을 돌려준다.
    // alias = common.calls 테이블 별칭(예: 'c') — agent_user_id 는 콜 헤더(common.calls)에 있음.
    function agentScopeSql(req, params, alias = 'c') {
        if (req.session?.role === 'agent') {
            params.push(req.session.user_id);
            return ` AND ${alias}.agent_user_id = $${params.length}`;
        }
        return '';
    }

    // 현재 세션이 콜 1건을 볼 수 있는지(상담사는 본인 콜만). admin/super=항상 true.
    // 통합DB: :qaId = common.calls.source_id(구 qa_calls.ID 텍스트). source_id 는 'ics:<PROJ>:<uid>' 로 사실상 전역유일.
    async function canAccessCall(req, qaId) {
        if (req.session?.role !== 'agent') return true;
        const { rows } = await pool.query('SELECT agent_user_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
        if (!rows.length) return false;
        return rows[0].agent_user_id === req.session.user_id;
    }

    // 평가 점수 표시용 — 정수면 정수로, 소수면 소수 2자리까지.
    function fmtEvalNum(n) {
        if (n == null) return '-';
        const num = Number(n);
        if (Number.isNaN(num)) return String(n);
        return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
    }

    // KSQI 테이블(qa_call_ksqi_score/summary — 65_qa_ksqi_rows.sql) 존재 여부 — 미적용 DB 에서
    // 참조하면 SQL 에러로 리스트 전체가 깨지므로, 존재 여부에 따라 SELECT/JOIN 조각을 분기
    // (부재 시 has_ksqi=false·점수 null)해 무회귀 보장. 1회 캐시.
    let _ksqiTablesCache = null;

    async function hasKsqiTables(pool) {
        if (_ksqiTablesCache !== null) return _ksqiTablesCache;
        try {
            const { rows } = await pool.query(
                `SELECT (to_regclass('trustguard.eval_ksqi_summary') IS NOT NULL
                 AND to_regclass('trustguard.eval_ksqi_score') IS NOT NULL) AS ok`
            );
            _ksqiTablesCache = rows[0]?.ok === true;
        } catch {
            _ksqiTablesCache = false;
        }
        return _ksqiTablesCache;
    }

    // KSQI 보고서 재조립 — 2테이블(score+summary)을 기존 응답 계약({items[], area_a, area_b, overall, summary})
    // 형태로 복원. FE(KsqiEval/KsqiEvalSection) 계약 무변경. 미시행·테이블 부재 시 null 폴백(상세 로드 무영향).
    // 근거 발화는 score.evidence(jsonb)에 인라인 — 구 qa_call_ksqi_evidence 조회·Map 재조립이 사라졌다.
    // 통합DB: 인자는 call_id(bigint). eval_ksqi_summary/score 는 call_id 로 조인.
    async function loadKsqiReport(pool, callId) {
        try {
            if (!(await hasKsqiTables(pool))) return null;
            const { rows: sumRows } = await pool.query(`SELECT * FROM eval_ksqi_summary WHERE call_id = $1 LIMIT 1`, [
                callId,
            ]);
            if (!sumRows[0]) return null;
            const s = sumRows[0];
            // `kind` 는 13_drop_ksqi_kind.sql 로 제거된 컬럼 — SELECT 에 남아 있으면 이 함수가 통째로 catch→null 이 되어
            // 저장된 KSQI 보고서가 화면에서 사라진다(0902 실측). 판정 방식은 파이프라인 카탈로그(GET /api/ksqi-stt/catalog)가 원본.
            const { rows: itemRows } = await pool.query(
                `SELECT item_number, item_name, area, score, max_score, na, defect, rationale, evidence
             FROM eval_ksqi_score WHERE call_id = $1 ORDER BY item_number`,
                [callId]
            );
            const areaObj = (p) => ({
                raw: s[`${p}_raw`],
                max: s[`${p}_max`],
                scaled: s[`${p}_scaled`],
                grade: s[`${p}_grade`],
                excellent: s[`${p}_excellent`],
            });
            return {
                items: itemRows.map((r) => ({
                    item_number: r.item_number,
                    item_name: r.item_name,
                    area: r.area,
                    score: r.score,
                    max_score: r.max_score,
                    na: r.na,
                    defect: r.defect,
                    rationale: r.rationale,
                    evidence: Array.isArray(r.evidence) ? r.evidence : [],
                })),
                area_a: areaObj('area_a'),
                area_b: areaObj('area_b'),
                overall: { raw: s.overall_raw, max: s.overall_max },
                summary: s.summary,
            };
        } catch {
            return null;
        }
    }

    router.get('/api/calls', async (req, res) => {
        try {
            const activeOrgId = resolveActiveOrgId(req);   // = tenant_id(citext)
            // 통합DB: 콜 헤더=common.calls, 평가=trustguard.qa_evaluations(call_id 조인).
            //   외부 식별자 qa_id/id = c.source_id(구 qa_calls.ID 텍스트), 내부 조인·자식은 c.call_id(bigint).
            //   자식: qa_call_item_score→eval_item_score, qa_call_transcript→common.call_transcript
            //   (speaker '상담사'→'agent'), qa_call_ksqi_summary→eval_ksqi_summary. 전부 call_id 키.
            const hasKsqi = await hasKsqiTables(pool);
            const ksqiCols = hasKsqi
                ? `(ks.call_id IS NOT NULL) AS has_ksqi,
               ks.area_a_scaled::float AS ksqi_a,
               ks.area_b_scaled::float AS ksqi_b,
               ks.overall_raw::float AS ksqi_overall_raw,
               ks.overall_max::float AS ksqi_overall_max`
                : `false AS has_ksqi,
               NULL::float AS ksqi_a,
               NULL::float AS ksqi_b,
               NULL::float AS ksqi_overall_raw,
               NULL::float AS ksqi_overall_max`;
            const ksqiJoin = hasKsqi ? `LEFT JOIN eval_ksqi_summary ks ON ks.call_id = c.call_id` : '';
            const params = [];
            const conds = [];
            if (activeOrgId != null) {
                params.push(activeOrgId);
                conds.push(`c.tenant_id = $${params.length}`);
            } else {
                // '전체' 조회 — 비활성 브랜드(셀렉터에 없는 브랜드)의 콜은 섞지 않는다.
                // 0902: 키움만 active 인 화면에 METAM 의 은행/668xxx 콜이 함께 나열됨.
                conds.push(`o.active = true`);
            }
            // 상담사(agent)는 본인이 응대한 콜만.
            if (req.session?.role === 'agent') {
                params.push(req.session.user_id);
                conds.push(`c.agent_user_id = $${params.length}`);
            }
            // '수기평가 대상만' 필터 — 배치 조건으로 도장(manual_review)된 콜만.
            if (String(req.query.manual_review || '') === 'true') {
                conds.push(`e.manual_review = true`);
            }
            // 실제 응대(=QA평가된) 콜만 노출. 포기호/미응대는 평가행이 없어 리스트에서 제외한다.
            conds.push(`(EXISTS (SELECT 1 FROM eval_item_score er WHERE er.call_id = c.call_id))`);
            // 상담사 발화가 전혀 없이 끊긴 콜은 평가 대상이 아니므로 제외.
            conds.push(`EXISTS (SELECT 1 FROM common.call_transcript q WHERE q.call_id = c.call_id AND q.speaker = 'agent')`);
            const orgFilter = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const { rows: callRows } = await pool.query(
                `SELECT
                c.call_id AS call_id,
                c.source_id AS qa_id,
                c.source_id AS id,
                c.uid AS uid,
                c.call_seq AS call_no,
                c.cdate AS call_datetime,
                c.duration_sec AS duration_sec,
                ''::text AS team_name,
                c.agent_code AS agent_code,
                c.agent_user_id AS agent_user_id,
                ''::text AS agent_id,
                COALESCE(au.name, '')::text AS agent_name,
                ''::text AS consultation_type,
                e."AI_SCORE" AS ai_score,
                e."TOTAL_SCORE" AS total_score,
                COALESCE(o.name, '')::text AS brand,
                ''::text AS eval_status,
                ''::text AS customer_no,
                ''::text AS customer_grade,
                e.department AS department,
                e.role AS role,
                e.ai_analysis_target AS ai_analysis_target,
                e.ai_analysis_reason AS ai_analysis_reason,
                c.tenant_id AS org_id,
                e.review_status AS review_status,
                e.review_round AS review_round,
                e.review_completed_at AS review_completed_at,
                e.review_started_at AS review_started_at,
                COALESCE(ru.name, COALESCE(ru.username, regexp_replace(ru.email, '\\.ics$', '')), '')::text AS reviewer_name,
                c.io_divi AS io_divi,
                e.manual_review AS manual_review,
                e.manual_review_reasons AS manual_review_reasons,
                NULL::bigint AS consumer_violations,
                NULL::bigint AS consumer_total,
                EXISTS(
                    SELECT 1
                    FROM eval_item_score er
                    WHERE er.call_id = c.call_id
                    AND ABS(er.manual_eval - er.ai_eval) > 1e-9
                ) AS has_manual_override,
                COALESCE(gs.golden_count, 0) AS golden_count,
                COALESCE(ev.ev_total, 0) AS ev_total,
                COALESCE(ev.opted_count, 0) AS opted_count,
                ${ksqiCols}
             FROM common.calls c
             JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
             LEFT JOIN common.tenants o ON o.tenant_id = c.tenant_id
             LEFT JOIN common.users au ON au.id = c.agent_user_id
             LEFT JOIN common.users ru ON ru.id = e.user_id
             LEFT JOIN (
                 SELECT qa_id, COUNT(*) AS golden_count
                 FROM qa_golden_set
                 GROUP BY qa_id
             ) gs ON gs.qa_id = c.call_id
             LEFT JOIN (
                 SELECT call_id, COUNT(*) AS ev_total,
                        COUNT(*) FILTER (WHERE manual_eval_option IS NOT NULL) AS opted_count
                 FROM eval_item_score
                 GROUP BY call_id
             ) ev ON ev.call_id = c.call_id
             ${ksqiJoin}
             ${orgFilter}
             ORDER BY c.cdate DESC`,
                params
            );
            const callIds = (callRows || []).map((r) => r.call_id).filter((x) => x != null);
            if (callIds.length === 0) {
                res.json([]);
                return;
            }
            // ★ max_score IS NULL 행(감점 전용 항목·Y/N 항목)도 포함한다 — maxPointsOf() 가 null 을 분모 제외로
            //   처리하므로 만점 합은 그대로고, 감점(−5)은 카테고리 획득점에 반영돼 카테고리 합 == 총점이 된다.
            //   (0902: 필터 때문에 키움 #5 −5 가 목록 집계에서 빠져 업무처리능력 55/60 vs 총점 87 불일치)
            const { rows: chRows } = await pool.query(
                `SELECT call_id, order_no, category, item, agent_utterance, max_score
             FROM eval_item_score
             WHERE call_id = ANY($1::bigint[])`,
                [callIds]
            );
            const { rows: evRows } = await pool.query(
                `SELECT call_id, order_no, ai_eval
             FROM eval_item_score
             WHERE call_id = ANY($1::bigint[])`,
                [callIds]
            );
            const chByQa = new Map();
            for (const r of chRows || []) {
                if (!chByQa.has(r.call_id)) chByQa.set(r.call_id, []);
                chByQa.get(r.call_id).push(r);
            }
            const evByQa = new Map();
            for (const r of evRows || []) {
                if (!evByQa.has(r.call_id)) evByQa.set(r.call_id, []);
                evByQa.get(r.call_id).push(r);
            }
            const payload = (callRows || []).map((row) => {
                const chRows = chByQa.get(row.call_id) || [];
                // 사용자 생성 평가 트랙(표준 1/2/3 외)은 콜 자체 카테고리로 동적 집계 — 부서 고정 키셋 미적용.
                const keys = effectiveChecklistKeys(row.department, chRows, row.org_id);
                const yn = buildChecklistYnKorFromDbRows(chRows, evByQa.get(row.call_id) || [], keys);
                // 평가-시점 만점 합산 — 표시 컬럼(keys) 에 해당하는 행만 집계(builder 와 동일 필터).
                // 체크리스트 없으면 null → FE DEFAULT_TOTAL_MAX 폴백.
                const keySet = new Set(keys);
                let sumTotalMax = 0;
                for (const r of chRows) {
                    if (keySet.has(String(r.category || '').trim())) {
                        sumTotalMax += maxPointsOf(r) ?? 0;   // null(분모 제외) -> 0
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
    router.get('/api/agents', async (req, res) => {
        try {
            const activeOrgId = resolveActiveOrgId(req);
            // 통합DB: 콜 헤더=common.calls(c, agent_user_id/agent_code), 평가=trustguard.qa_evaluations(e, is_sandbox/department/TOTAL_SCORE).
            //   상담사 이름=common.users.name, 부서=테넌트별 common.memberships.department (구 admin_users 대체).
            const params = [];
            let where = `WHERE e.is_sandbox = false AND c.agent_user_id IS NOT NULL`;
            if (activeOrgId != null) {
                params.push(activeOrgId);
                where += ` AND c.tenant_id = $${params.length}`;
            }
            const { rows } = await pool.query(
                `SELECT c.agent_user_id AS user_id,
                    MAX(c.agent_code) AS agent_code,
                    COALESCE(MAX(u.name), MAX(c.agent_code), '미지정') AS name,
                    COALESCE(NULLIF(MAX(m.department), ''), MAX(NULLIF(e.department, '')), '미지정') AS department,
                    ROUND(AVG(e."TOTAL_SCORE")::numeric, 1) AS score,
                    COUNT(*) AS calls
               FROM common.calls c
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
               LEFT JOIN common.users u ON u.id = c.agent_user_id
               LEFT JOIN common.memberships m ON m.user_id = c.agent_user_id AND m.tenant_id = c.tenant_id
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
    router.get('/api/stats', async (req, res) => {
        try {
            const orgId = resolveActiveOrgId(req);
            const periodRaw = String(req.query.period || 'week').toLowerCase();
            const periodDays = periodRaw === 'day' ? 1 : periodRaw === 'month' ? 30 : 7;
            const deptRaw = String(req.query.department || '').trim();
            const department = deptRaw && deptRaw.toLowerCase() !== 'all' ? deptRaw : null;

            // 통합DB: common.calls.cdate 는 timestamptz(구 qa_calls.CDATE 텍스트/MySQL 제로날짜 무력화 불필요).
            const CDATE_TS = `c.cdate`;
            const CDATE_DT = `c.cdate::date`;

            // 공통 스코프(WHERE) 빌더 — is_sandbox 제외 + tenant + (상담사 본인필터) + 선택 부서.
            //   FROM 은 반드시 common.calls c JOIN trustguard.qa_evaluations e ON e.call_id=c.call_id (is_sandbox/department=e).
            // 반환: { where, params } — alias 'c'(콜 헤더), 'e'(평가).
            const buildScope = ({ withDept = false } = {}) => {
                const params = [];
                let where = `WHERE e.is_sandbox = false`;
                if (orgId != null) { params.push(orgId); where += ` AND c.tenant_id = $${params.length}`; }
                where += agentScopeSql(req, params, 'c');
                if (withDept && department) { params.push(department); where += ` AND e.department = $${params.length}`; }
                return { where, params };
            };

            // 1) 기간 앵커 = 스코프 내 최신 콜 날짜
            const scopeAll = buildScope();
            const anchorRes = await pool.query(
                `SELECT MAX(${CDATE_TS})::date AS anchor
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id ${scopeAll.where}`,
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
            const winCur = `${CDATE_DT} BETWEEN ($A::date - ($D - 1)) AND $A::date`;
            const winPrev = `${CDATE_DT} BETWEEN ($A::date - (2*$D - 1)) AND ($A::date - $D)`;
            const bind = (sql, params) => {
                params.push(anchor); const a = `$${params.length}`;
                params.push(periodDays); const d = `$${params.length}`;
                return sql.replace(/\$A/g, a).replace(/\$D/g, d);
            };

            // 코칭대상 임계값 — 통합DB: 레거시 표준 브랜드(숫자 org 1/2/3)는 문자열 tenant_id 로 존재하지 않으므로
            //   특정 테넌트가 활성이면 항상 상대 임계값(콜별 만점 75% 미만), 전체(all)뷰만 절대 80점.
            const useRelativeCoaching = orgId != null;
            const coachingCond = useRelativeCoaching
                ? `(tm.total_max > 0 AND e."TOTAL_SCORE" < tm.total_max * 0.75)`
                : `e."TOTAL_SCORE" < 80`;
            const coachingJoin = useRelativeCoaching
                ? `LEFT JOIN LATERAL (
                   SELECT COALESCE(SUM(ch.max_score), 0) AS total_max
                     FROM eval_item_score ch WHERE ch.call_id = c.call_id
               ) tm ON true`
                : '';

            // 2) 부서 카드(현재창, 모든 부서)
            const sc2 = buildScope();
            const deptRows = (await pool.query(
                `SELECT e.department,
                    ROUND(AVG(e."TOTAL_SCORE")::numeric, 1) AS avg,
                    COUNT(*) AS count,
                    COUNT(DISTINCT COALESCE(c.agent_user_id::text, c.agent_code)) AS agent_count,
                    COUNT(*) FILTER (WHERE ${coachingCond}) AS coaching
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                    ${coachingJoin} ${sc2.where} AND ${bind(winCur, sc2.params)}
              GROUP BY e.department
              ORDER BY count DESC`,
                sc2.params
            )).rows;

            // 3) 선택 부서(또는 전체) KPI — 현재창 + 직전창 평균(delta)
            const sc3 = buildScope({ withDept: true });
            const kpiRow = (await pool.query(
                `SELECT ROUND(AVG(e."TOTAL_SCORE") FILTER (WHERE ${bind(winCur, sc3.params)})::numeric,1) AS avg,
                    COUNT(*) FILTER (WHERE ${bind(winCur, sc3.params)}) AS count,
                    COUNT(DISTINCT COALESCE(c.agent_user_id::text, c.agent_code))
                      FILTER (WHERE ${bind(winCur, sc3.params)}) AS agent_count,
                    COUNT(*) FILTER (WHERE ${bind(winCur, sc3.params)} AND ${coachingCond}) AS coaching,
                    ROUND(AVG(e."TOTAL_SCORE") FILTER (WHERE ${bind(winPrev, sc3.params)})::numeric,1) AS prev_avg
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                    ${coachingJoin} ${sc3.where}`,
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
                 SELECT e.department, er.order_no, MAX(er.ai_eval) AS max_pts
                   FROM eval_item_score er
                   JOIN common.calls c ON c.call_id = er.call_id
                   JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                   ${sc4.where}
                  GROUP BY e.department, er.order_no
             )
             SELECT MIN(er.order_no) AS order_no, er.category, er.item,
                    ROUND(AVG(er.manual_eval)::numeric, 2) AS avg_raw,
                    MAX(im.max_pts) AS item_max,
                    CASE WHEN MAX(im.max_pts) > 0
                         THEN ROUND((AVG(er.manual_eval)/MAX(im.max_pts)*100)::numeric, 1) END AS avg,
                    COUNT(*) AS count
               FROM eval_item_score er
               JOIN common.calls c ON c.call_id = er.call_id
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
               LEFT JOIN item_max im ON im.department = e.department AND im.order_no = er.order_no
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

            // 5) 일별 추이(현재창) — generate_series 날짜 스파인에 LEFT JOIN.
            //    GROUP BY 만 하면 콜 없는 날이 행에서 통째로 빠져 7일 창에 막대가 6개만 나온다(빈 날 누락 fix).
            //    빈 날은 avg=null / count=0 으로 내려 프론트가 '평가 없음'으로 구분 표시.
            const sc5 = buildScope({ withDept: true });
            const daily = (await pool.query(
                bind(
                    `SELECT s.date::date AS date, d.avg, COALESCE(d.count, 0) AS count
                   FROM generate_series($A::date - ($D - 1), $A::date, interval '1 day') AS s(date)
                   LEFT JOIN (
                        SELECT ${CDATE_DT} AS date,
                               ROUND(AVG(e."TOTAL_SCORE")::numeric, 1) AS avg, COUNT(*) AS count
                          FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                          ${sc5.where} AND ${winCur}
                         GROUP BY ${CDATE_DT}
                   ) d ON d.date = s.date::date
                  ORDER BY 1`,
                    sc5.params
                ),
                sc5.params
            )).rows.map((r) => ({
                date: r.date,
                avg: r.avg != null ? Number(r.avg) : null,
                count: Number(r.count),
            }));

            // 6) 상담사 랭킹(현재창) — 이름 조인, 미연결은 '미지정' 한 줄
            const sc6 = buildScope({ withDept: true });
            const ranking = (await pool.query(
                `SELECT c.agent_user_id, c.agent_code,
                    u.name AS display_name, m.role AS role,
                    ROUND(AVG(e."TOTAL_SCORE")::numeric, 1) AS avg, COUNT(*) AS count
               FROM common.calls c
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
               LEFT JOIN common.users u ON u.id = c.agent_user_id
               LEFT JOIN common.memberships m ON m.user_id = c.agent_user_id AND m.tenant_id = c.tenant_id
               ${sc6.where} AND ${bind(winCur, sc6.params)}
              GROUP BY c.agent_user_id, c.agent_code, u.name, m.role
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

    router.get('/api/analysis/:qaId', async (req, res) => {
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
            // 통합DB: 콜 헤더=common.calls(source_id=구 텍스트 ID·tenant_id), 평가=trustguard.qa_evaluations(call_id).
            //   외부 :qaId=source_id → call_id 해석 후 자식은 call_id 로 조인. org_id=tenant_id(citext).
            const { rows } = await pool.query(
                `SELECT c.call_id, c.source_id AS qa_id, e."AI_SCORE" AS ai_score, e."TOTAL_SCORE" AS total_score,
                    e.department, c.tenant_id AS org_id
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE c.source_id = $1 LIMIT 1`,
                [qaId]
            );
            if (!rows[0]) {
                res.status(404).json({ message: 'Not found' });
                return;
            }
            const callId = rows[0].call_id;
            const dept = rows[0].department;
            // 소비자보호부 콜은 Pentagon 분석 트랙 사용 안 함 — 빈 응답.
            if (dept === '소비자보호부') {
                res.json({ qa_id: rows[0].qa_id, department: '소비자보호부', pentagon: null, report: [] });
                return;
            }
            const isHanwha = dept === '고객센터';
            const isDefault = dept === '고객지원실';
            const { rows: checklistRows } = await pool.query(
                `SELECT er.order_no, er.category, er.item, er.max_score, er.ai_eval
             FROM eval_item_score er
             WHERE er.call_id = $1 AND er.max_score IS NOT NULL
             ORDER BY er.order_no ASC`,
                [callId]
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
            // 통합DB: 레거시 숫자 표준브랜드(신한1/한화2/코오롱3)는 문자열 tenant_id 로 존재하지 않음 →
            //   비-한화 콜은 항상 동적 루브릭(운영자 지정 pentagon_axis SSOT). org_id=tenant_id(citext).
            const isDynamicRubric = true;
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
                       FROM eval_item_defs
                      WHERE tenant_id = $1
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
                       FROM pentagon_axes
                      WHERE tenant_id = $1
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
             FROM eval_pentagon_result
             WHERE call_id = $1
             ORDER BY item_type_no ASC`,
                [callId]
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

    router.get('/api/evaluations/:qaId', async (req, res) => {
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
            // 통합DB: 콜 헤더=common.calls(source_id·tenant_id), 평가=trustguard.qa_evaluations(call_id). :qaId=source_id → call_id.
            const { rows: callRows } = await pool.query(
                `SELECT c.call_id, c.source_id AS qa_id, e.department, e.role, c.tenant_id AS org_id,
                    e.ai_analysis_target, e.ai_analysis_reason, e.manual_review, e.manual_review_reasons
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE c.source_id = $1 LIMIT 1`,
                [qaId]
            );
            if (!callRows[0]) {
                res.status(404).json({ message: 'Not found' });
                return;
            }
            const callMeta = callRows[0];
            const callId = callMeta.call_id;
            // 수기평가 대상 사유(상세 배지용) — ['저품질 검증 · 평균점수 미달', ...]
            const manualReviewReasons = Array.isArray(callMeta.manual_review_reasons) ? callMeta.manual_review_reasons : [];

            // KSQI STT 보고서 — 정규화 3테이블(eval_ksqi_score/summary)에서 기존 계약 형태로 재조립.
            // 브랜드 루브릭과 별개 축이라 별도 방어 조회 — 테이블 부재/미시행 시 null 폴백(상세 로드 무영향).
            const ksqiReport = await loadKsqiReport(pool, callId);

            // 관리자 코멘트 — eval_annotation.comments(call_id 단일행에 전체 배열 보관). 없으면 [].
            const { rows: acRows } = await pool.query(
                'SELECT comments FROM eval_annotation WHERE call_id = $1',
                [callId]
            );
            const adminComments = Array.isArray(acRows[0]?.comments) ? acRows[0].comments : [];

            // 대화 — common.call_transcript(call_id, speaker agent/customer, seq). FE 계약 유지 위해 화자 한글 복원.
            const { rows: convRaw } = await pool.query(
                `SELECT $1::text AS qa_id, seq AS turn_no, ''::text AS ts,
                    CASE speaker WHEN 'agent' THEN '상담사' WHEN 'customer' THEN '고객' ELSE speaker END AS speaker,
                    "text" AS text
             FROM common.call_transcript
             WHERE call_id = $2 AND channel = 'call'
             ORDER BY seq ASC`,
                [qaId, callId]
            );

            // 소비자보호부 분기 — 신한 PoC 전용 트랙(20 Y/N + 금칙어 + 12카테고리)이었으나
            // 브랜드별 동적 루브릭(eval_item_defs)으로 세대교체되어 qa_consumer_* 3테이블 제거(66).
            // 해당 부서 콜이 남아 있어도 500 대신 빈 트랙으로 응답해 상세 화면이 깨지지 않게 한다.
            if (callMeta.department === '소비자보호부') {
                res.json({
                    qa_id: qaId,
                    department: '소비자보호부',
                    role: callMeta.role || '전체',
                    ai_analysis_target: callMeta.ai_analysis_target,
                    ai_analysis_reason: callMeta.ai_analysis_reason,
                    consumer_eval_rows: [],
                    consumer_keywords: [],
                    consumer_ai_categories: [],
                    conversation: convRaw,
                    admin_comments: adminComments,
                    manual_review: !!callMeta.manual_review,
                    manual_review_reasons: manualReviewReasons,
                    ksqi_report: ksqiReport,
                });
                return;
            }

            // 컬렉션관리부 분기 (기존 로직)
            const { rows: evaluation_rows } = await pool.query(
                `SELECT $1::text AS qa_id, order_no, category, item, reason_text, ai_eval, manual_eval, manual_eval_option, counselor_eval
             FROM eval_item_score
             WHERE call_id = $2
             ORDER BY order_no ASC`,
                [qaId, callId]
            );
            const { rows: checklist_rows } = await pool.query(
                `SELECT $1::text AS qa_id, order_no, category, item, agent_utterance, max_score
             FROM eval_item_score
             WHERE call_id = $2 AND max_score IS NOT NULL
             ORDER BY order_no ASC`,
                [qaId, callId]
            );

            // 평가매칭률·당월평균·직무평균을 동적 계산.
            // - match_rate:  행 단위로 |ai_eval - manual_eval| / max_pts 만큼 깎아서 일치율(%) 산출.
            // - monthly_avg: 같은 연-월(CDATE 첫 7자) + 같은 직무(role) 안에서 동일 item 의 ai_eval 평균을 max_pts 대비 %.
            // - team_avg:    같은 직무(role) 운영 baseline 평균 (UI 라벨: "직무평균"). 시점 무관.
            // 본 PoC는 직무별 만점 매트릭스가 다르므로 baseline 도 같은 role 안에서만 비교해야 의미가 정합.
            // 집계는 sample-* 행을 제외해 "운영 baseline" 만 반영.
            const maxByOrderNo = new Map();
            for (const r of checklist_rows) {
                maxByOrderNo.set(Number(r.order_no), maxPointsOf(r) ?? 0);
            }
            // 항목별 채점방식 — 프론트가 Y/N(컴플라이언스 체크) 항목을 점수표에서 분리하는 데 사용.
            // 활성 eval_item_defs.scoring_type by order_no (펜타곤 axisByOrderNo 조회와 동일 패턴).
            const scoringTypeByOrderNo = new Map();
            if (callMeta.org_id !== null && callMeta.org_id !== undefined) {
                try {
                    const { rows: stRows } = await pool.query(
                        `SELECT DISTINCT ON (order_no) order_no, scoring_type
                       FROM eval_item_defs
                      WHERE tenant_id = $1 AND is_active = true AND deactivated_at IS NULL
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
                `SELECT to_char(cdate, 'YYYY-MM') AS ym FROM common.calls WHERE call_id = $1 LIMIT 1`,
                [callId]
            );
            const yearMonth = String(ymRows[0]?.ym || '');
            const callRole = String(callMeta.role || '').trim();
            // 당월평균/직무평균 baseline — 운영 baseline 만(샘플 ingest 행 source_id 'sample-%' 제외, NULL 안전).
            //   role 은 qa_evaluations, 날짜는 common.calls.cdate(timestamptz).
            const { rows: aggRows } = await pool.query(
                `SELECT
                er.item AS item,
                AVG(CASE WHEN to_char(c.cdate, 'YYYY-MM') = $1 THEN er.ai_eval END) AS monthly_avg_raw,
                AVG(er.ai_eval) AS team_avg_raw
             FROM eval_item_score er
             JOIN common.calls c ON c.call_id = er.call_id
             JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
             WHERE COALESCE(c.source_id, '') NOT LIKE 'sample-%'
               AND e.role = $2
             GROUP BY er.item`,
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

            // KMS 필수사항 체크(kiwoom_coverage) — 평가 결과 [KMS] 탭이 그대로 렌더한다.
            //   행이 없으면 null → 프론트가 근거문서 목록으로 폴백(커버리지 산출 전 옛 콜).
            let kiwoomCoverage = null;
            try {
                const { rows: kmsRows } = await pool.query(
                    `SELECT payload FROM trustguard.qa_kms_results WHERE call_id = $1`,
                    [callMeta.call_id]
                );
                kiwoomCoverage = kmsRows[0]?.payload ?? null;
            } catch (e) {
                // 테이블 미존재(마이그레이션 미적용) 등은 조회 실패로 흘리고 탭만 폴백시킨다.
                console.warn('GET /api/evaluations: qa_kms_results 조회 생략 —', e?.message || e);
            }

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
                ksqi_report: ksqiReport,
                kiwoom_coverage: kiwoomCoverage,
            });
        } catch (error) {
            console.error('GET /api/evaluations/:qaId error:', error);
            res.status(500).json({ message: 'Failed to load evaluations.' });
        }
    });

    router.put('/api/evaluations/:qaId', async (req, res) => {
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
                    `SELECT e.is_sandbox
                   FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                  WHERE c.source_id = $1 LIMIT 1`,
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
                        `SELECT c.agent_user_id, e.review_status
                       FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                      WHERE c.source_id = $1 LIMIT 1`,
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

        // 소비자보호부 Y/N 업데이트 분기 — qa_consumer_eval_rows 제거(66)로 저장 대상이 없다.
        // 신한 PoC 전용 트랙이 동적 루브릭으로 세대교체된 결과이므로, 호출되면 410 으로 명시 거절한다.
        if (Array.isArray(consumerPatches) && consumerPatches.length > 0) {
            res.status(410).json({
                message: '소비자보호부 Y/N 트랙은 폐지되었습니다. 브랜드별 평가항목(manual_patches)을 사용하세요.',
            });
            return;
        }

        if (!Array.isArray(patches) || patches.length === 0) {
            res.status(400).json({ message: 'manual_patches 또는 consumer_yn_patches 가 필요합니다.' });
            return;
        }
        try {
            // 통합DB: :qaId=common.calls.source_id → call_id 해석. 자식(eval_item_score)은 call_id 조인.
            const { rows: callRows } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
            if (!callRows[0]) {
                res.status(404).json({ message: 'Not found' });
                return;
            }
            const callId = callRows[0].call_id;
            const { rows: existingEval } = await pool.query(
                `SELECT $1::text AS qa_id, order_no, category, item, reason_text, ai_eval, manual_eval
             FROM eval_item_score
             WHERE call_id = $2
             ORDER BY order_no ASC`,
                [qaId, callId]
            );
            const { rows: checklistBase } = await pool.query(
                `SELECT $1::text AS qa_id, order_no, category, item, agent_utterance, max_score
             FROM eval_item_score
             WHERE call_id = $2 AND max_score IS NOT NULL
             ORDER BY order_no ASC`,
                [qaId, callId]
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
                        `UPDATE eval_item_score
                     SET manual_eval = $1, manual_eval_option = $2
                     WHERE call_id = $3 AND order_no = $4`,
                        [r.value, r.option, callId, r.order_no]
                    );
                }
                // 수기 환산점수가 산출될 때만 TOTAL_SCORE 갱신 — null 일 때 0 으로 덮어쓰면 안 된다.
                if (manualPct !== null) {
                    await client.query(`UPDATE trustguard.qa_evaluations SET "TOTAL_SCORE" = $1 WHERE call_id = $2`, [
                        Number(manualPct),
                        callId,
                    ]);
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
            const { rows: savedRows } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1', [qaId]);
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

    router.put('/api/evaluations/:qaId/admin-comments', async (req, res) => {
        const qaId = String(req.params.qaId || '').trim();
        const list = Array.isArray(req.body?.admin_comments) ? req.body.admin_comments : [];
        try {
            // 통합DB: :qaId=common.calls.source_id → call_id. eval_annotation 은 call_id 키(병합 comment+confidence).
            const { rows: c } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
            if (!c[0]) {
                res.status(404).json({ message: 'Not found' });
                return;
            }
            await pool.query(
                // 병합 테이블 — 사용자는 comments 만 SET. 배치가 쓰는 judgments/has_* 는 EXCLUDED 에 없으므로 보존된다.
                `INSERT INTO eval_annotation (call_id, comments, comments_at)
                 VALUES ($1, $2::jsonb, now())
             ON CONFLICT (call_id) DO UPDATE SET comments = EXCLUDED.comments, comments_at = now()`,
                [c[0].call_id, JSON.stringify(list)]
            );
            res.json({ ok: true, admin_comments: list });
        } catch (error) {
            console.error('PUT /api/evaluations/:qaId/admin-comments error:', error);
            res.status(500).json({ message: 'Failed to save admin comments.' });
        }
    });

    // 평가 콜 삭제 (관리자 전용, 벌크). body { ids:[qaId, ...] } 또는 { id:qaId } 단건 수용.
    //   통합DB: :qaId=common.calls.source_id. common.calls 행 삭제 → qa_evaluations(ON DELETE CASCADE)
    //   → 그 자식(eval_item_score·eval_pentagon_result·eval_annotation·eval_ksqi_*·eval_review_event·qa_golden_set)
    //   + common.call_transcript·eval_emotion_recovery(common.calls 참조) 까지 CASCADE 제거 — 별도 자식 DELETE 불필요.
    //   ★교차제품 주의: common.calls 는 TA 와 공용 헤더. 현재 QA "콜 삭제"=구 qa_calls 전삭제 거동 보존(헤더까지 제거).
    //   sandbox 계정은 운영 행(is_sandbox=false) 삭제 불가 — 배치에 운영행 포함 시 전체 거부(평가/검수 PUT 가드 일관).
    //   SELECT(가드)→DELETE 를 한 트랜잭션으로 묶어 TOCTOU 방지.
    router.delete('/api/calls', requireAdmin, async (req, res) => {
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
                `SELECT c.source_id AS id, e.is_sandbox
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE c.source_id = ANY($1)`,
                [ids]
            );
            // sandbox 계정: 배치에 운영 행(is_sandbox=false) 포함 시 전체 거부.
            if (req.session?.login_id === SANDBOX_LOGIN_ID && targets.some((t) => t.is_sandbox === false)) {
                await client.query('ROLLBACK');
                res.status(403).json({ message: 'sandbox account cannot delete production calls' });
                return;
            }
            const { rowCount } = await client.query('DELETE FROM common.calls WHERE source_id = ANY($1)', [ids]);
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
    router.put('/api/calls/:qaId/review-status', async (req, res) => {
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
            // 통합DB: :qaId=common.calls.source_id → call_id. review_status/is_sandbox=qa_evaluations, agent_user_id=common.calls, org_id=tenant_id.
            const { rows } = await pool.query(
                `SELECT c.call_id, e.review_status, c.agent_user_id, c.tenant_id AS org_id, e.is_sandbox
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE c.source_id = $1 LIMIT 1`,
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
        //   yes_no(컴플라이언스) 항목은 수기평가 대상이 아니므로 분모에서 제외 — 프론트 scoredRows 와 동일 기준.
        if (isAgent && next === 'review_done' && (from === 'pending' || from === 'in_review')) {
            const { rows: prog } = await pool.query(
                `SELECT count(*)::int AS total,
                    count(*) FILTER (
                        WHERE (manual_eval_option IS NOT NULL AND btrim(manual_eval_option) <> '')
                           OR (ai_eval IS NOT NULL AND manual_eval IS NOT NULL AND manual_eval IS DISTINCT FROM ai_eval)
                    )::int AS judged
               FROM eval_item_score er
              WHERE er.call_id = $1
                AND NOT EXISTS (
                      SELECT 1 FROM eval_item_defs d
                       WHERE d.tenant_id = $2 AND d.order_no = er.order_no
                         AND d.is_active = true AND d.deactivated_at IS NULL
                         AND lower(d.scoring_type) = 'yes_no'
                    )`,
                [cur.call_id, cur.org_id]
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
               FROM eval_item_score
              WHERE call_id = $1 AND counselor_eval IS NOT NULL AND manual_eval IS DISTINCT FROM counselor_eval
              ORDER BY order_no`,
                [cur.call_id]
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
                    `SELECT actor_user_id FROM eval_review_event WHERE call_id=$1 AND action IN ('reject','reject_again') ORDER BY id DESC LIMIT 1`, [cur.call_id]
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
                `UPDATE trustguard.qa_evaluations
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
              WHERE call_id = $1
              RETURNING review_status, review_round, review_started_at, review_completed_at, approved_at`,
                [cur.call_id, next, uid, bumpRound, approvedBy]
            );
            if (!rows[0]) {
                res.status(404).json({ message: 'call not found' });
                return;
            }
            const updated = rows[0];
            const round = updated.review_round;

            // 검토요청 제출(→검토요청) 시 상담사 점수 스냅샷(이후 관리자 변경분 diff 기준).
            if (action === 'submit') {
                await pool.query(`UPDATE eval_item_score SET counselor_eval = manual_eval WHERE call_id = $1`, [cur.call_id])
                    .catch((e) => console.error('counselor_eval snapshot error:', e));
            }

            // 감사 이벤트 기록(사유·변경분 포함).
            if (action) {
                const changed = (action === 'reject' || action === 'reject_again' || action === 'force_approve') && diffRows.length
                    ? JSON.stringify(diffRows.map((r) => ({ order_no: r.order_no, item: r.item, from: r.counselor_eval, to: r.manual_eval })))
                    : null;
                await pool.query(
                    `INSERT INTO eval_review_event (call_id, round, actor_user_id, action, changed_items, reason) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
                    [cur.call_id, round, uid, action, changed, reason]
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
                        `SELECT actor_user_id FROM eval_review_event WHERE call_id=$1 AND action IN ('reject','reject_again') ORDER BY id DESC LIMIT 1`, [cur.call_id]
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
    router.get('/api/calls/:qaId/review-events', async (req, res) => {
        const qaId = String(req.params.qaId || '').trim();
        if (!qaId) {
            res.status(400).json({ message: 'qaId is required' });
            return;
        }
        try {
            // 통합DB: :qaId=common.calls.source_id → call_id. eval_review_event 는 call_id 키. 없으면 빈 배열.
            const { rows: cc } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
            if (!cc[0]) {
                res.json([]);
                return;
            }
            const { rows } = await pool.query(
                `SELECT e.id, e.round, e.action, e.changed_items, e.reason, e.created_at,
                    e.actor_user_id, u.name AS actor_name
               FROM eval_review_event e
               LEFT JOIN common.users u ON u.id = e.actor_user_id
              WHERE e.call_id = $1
              ORDER BY e.id ASC`,
                [cc[0].call_id]
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

    return router;
}
