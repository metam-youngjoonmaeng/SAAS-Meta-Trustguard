// 서비스 연동 (health · svc · realtime · ipcc) 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 6개 · 함께 옮긴 헬퍼/상태 0개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createSvcRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { getActiveCalls } from '../mqttListener.mjs';
import { evaluateDomainCall, evaluateStandardCall } from '../qaPipelineIngest.mjs';
import { callAnswerStats, ipccEnabled } from '../xhubSource.mjs';

export function createSvcRoutes(ctx) {
    const { CANONICAL_PENTAGON_AXES, buildPentagonByAxisDefs, normalizeDepartment, pool } = ctx;
    const router = express.Router();

    router.get('/api/health', async (_req, res) => {
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
    router.get('/api/svc/eval-items', async (req, res) => {
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
        // 통합DB: org_id(int) → tenant_id(citext). 크로스서비스 호출 tenant_id 우선, 구 org_id 문자열 폴백.
        const tenantId = String(req.query.tenant_id ?? req.query.org_id ?? '').trim().toLowerCase() || null;
        if (!Number.isFinite(domainId) && !tenantId) {
            res.status(400).json({ message: 'domain_id 또는 tenant_id 가 필요합니다' });
            return;
        }
        try {
            if (Number.isFinite(domainId)) {
                // 도메인(업종) 기준 — domain_default_eval_items + domain_default_pentagon_axes (표시·설정용).
                const { rows: items } = await pool.query(
                    `SELECT order_no, category, item, criterion, pentagon_axis, scoring_type, max_score
                   FROM domain_default_eval_items
                  WHERE domain_id = $1 AND is_active = true
                  ORDER BY order_no ASC, id ASC`,
                    [domainId]
                );
                const { rows: axes } = await pool.query(
                    `SELECT axis_no, label, description, prompt_template
                   FROM domain_default_pentagon_axes
                  WHERE domain_id = $1 AND is_active = true
                  ORDER BY axis_no ASC`,
                    [domainId]
                );
                res.json({ ok: true, domain_id: domainId, count: items.length, items, pentagon_axes: axes });
                return;
            }
            const department = req.query.department ? normalizeDepartment(req.query.department) : null;
            const params = [tenantId];
            const where = ['tenant_id = $1', 'deactivated_at IS NULL', 'is_active = true', 'effective_from <= now()'];
            if (department) {
                params.push(department);
                where.push(`department = $${params.length}`);
            }
            const { rows } = await pool.query(
                `SELECT order_no, category, item, criterion, pentagon_axis, scoring_type, max_score, department
               FROM eval_item_defs
              WHERE ${where.join(' AND ')}
              ORDER BY department ASC, order_no ASC`,
                params
            );
            // 펜타곤 축(라벨·설명·평가 프롬프트) 동봉 — 도메인 분기와 동일. 엔진이 축별 평가기준 판단에 사용.
            const { rows: axes } = await pool.query(
                `SELECT axis_no, label, description, prompt_template
               FROM pentagon_axes
              WHERE ${where.join(' AND ')}
              ORDER BY department ASC, axis_no ASC`,
                params
            );
            res.json({ ok: true, tenant_id: tenantId, count: rows.length, items: rows, pentagon_axes: axes });
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
    router.get('/api/svc/brand-qa-scores', async (req, res) => {
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
            // 통합DB: 브랜드 매칭키 organizations.proj_cd = common.calls.tenant_id(citext, 대소문자 무시).
            //   is_sandbox/TOTAL_SCORE=qa_evaluations, 날짜=common.calls.cdate(timestamptz), 배점합=eval_item_score.
            const params = [projCd];
            const where = ['c.tenant_id = $1', 'e.is_sandbox = false', 'e."TOTAL_SCORE" IS NOT NULL'];
            if (dateRe.test(start)) { params.push(start); where.push(`c.cdate::date >= $${params.length}::date`); }
            if (dateRe.test(end)) { params.push(end); where.push(`c.cdate::date <= $${params.length}::date`); }
            const { rows } = await pool.query(
                `SELECT c.tenant_id AS org_id, o.name AS brand_name, c.tenant_id AS proj_cd,
                    COUNT(*) AS call_count,
                    ROUND(AVG(e."TOTAL_SCORE")::numeric, 1) AS avg_raw,
                    ROUND(AVG(CASE WHEN tm.total_max > 0 THEN e."TOTAL_SCORE" / tm.total_max * 100 END)::numeric, 1) AS avg_score_100
               FROM common.calls c
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
               LEFT JOIN common.tenants o ON o.tenant_id = c.tenant_id
               LEFT JOIN LATERAL (
                   SELECT COALESCE(SUM(ch.max_score), 0) AS total_max
                     FROM eval_item_score ch WHERE ch.call_id = c.call_id
               ) tm ON true
              WHERE ${where.join(' AND ')}
              GROUP BY c.tenant_id, o.name`,
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
    router.post('/api/svc/deep-eval', async (req, res) => {
        const expected = String(process.env.EVAL_SHARE_TOKEN || '').trim();
        if (!expected) {
            res.status(503).json({ message: '딥평가 공유 비활성 (EVAL_SHARE_TOKEN 미설정)' });
            return;
        }
        if (String(req.headers['x-service-token'] || '').trim() !== expected) {
            res.status(401).json({ message: 'invalid service token' });
            return;
        }
        const { transcript, qa_org_id, tenant_id, domain_id, department, role, consultation_id } = req.body || {};
        if (!Array.isArray(transcript) || !transcript.length) {
            res.status(400).json({ message: 'transcript (non-empty array) required' });
            return;
        }
        const domainId = Number(domain_id);
        // 통합DB: qa_org_id(int) → tenant_id(citext). tenant_id 우선, 구 qa_org_id 문자열 폴백.
        const orgId = String(tenant_id ?? qa_org_id ?? '').trim().toLowerCase() || null;
        const useDomain = Number.isFinite(domainId);
        if (!useDomain && !orgId) {
            res.status(400).json({ message: 'domain_id 또는 tenant_id(qa_org_id) 가 필요합니다' });
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
                        `SELECT label FROM domain_default_pentagon_axes
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
    router.get('/api/realtime/active-calls', (req, res) => {
        const includeEnded = String(req.query.include_ended ?? 'true') !== 'false';
        const calls = getActiveCalls(includeEnded);
        res.json({ calls, count: calls.length });
    });

    // IPCC 응답률/포기호(call) — xhub.call_logs 집계(읽기전용 터널 경유). IPCC 미설정 시 enabled=false.
    // 진짜 포기호(상담원 연결 전 끊김)는 STT/TA 에 안 잡히므로 IPCC 가 유일 소스. proj_cd/from/to 쿼리.
    router.get('/api/ipcc/call-stats', async (req, res) => {
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

    return router;
}
