// 코칭 · 튜터 시나리오 · 상담사별 콜 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 9개 · 함께 옮긴 헬퍼/상태 2개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createCoachingRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';

export function createCoachingRoutes(ctx) {
    const { createNotification, pool, requireAdmin, resolveActiveOrgId } = ctx;
    const router = express.Router();

    /* ── [MERGE from old2-05, additive] 코칭 배정 / 알림 / TA 지표 ─────────────────
     *   coaching_assignments(mig 26) · notifications(mig 28) · qa_call_emotion_recovery(mig 31) + taSource.
     *   우리 기존 라우트/로직 불변. admin_users(테이블) 만 참조 — users/trainee(mig 29/30) 미의존. */

    /* ── Tutor 시나리오 카탈로그(코칭 배정용) ───────────────────────
     * GET /api/tutor/scenarios
     * 평가항목 공유의 거울: SSOT(시나리오)=Tutor, QA 가 읽어옴.
     * 활성 tenant_id → Tutor `GET /svc/scenarios?tenant_id=` 호출(X-Service-Token=EVAL_SHARE_TOKEN).
     * 통합DB: 매핑 키 = tenant_id(=proj_cd 1:1, 구 qa_org_id 폐기). ★튜터(02)측도 tenant_id 수용 동반 필요(교차제품). 미페어링 시 빈 카탈로그(graceful).
     * ────────────────────────────────────────────────────────── */
    router.get('/api/tutor/scenarios', requireAdmin, async (req, res) => {
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
            const url = `${base}/svc/scenarios?tenant_id=${encodeURIComponent(orgId)}`;
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
    router.get('/api/agents/:agentId/calls', requireAdmin, async (req, res) => {
        try {
            const agentId = Number(req.params.agentId);
            if (!Number.isFinite(agentId)) {
                res.status(400).json({ message: 'invalid agentId' });
                return;
            }
            const orgId = resolveActiveOrgId(req);
            // 통합DB: 헤더=common.calls(c, agent_user_id/uid/cdate/io_divi/call_seq), 점수=qa_evaluations(e, TOTAL_SCORE).
            const params = [agentId];
            const conds = [`c.agent_user_id = $1`];
            if (orgId != null) { params.push(orgId); conds.push(`c.tenant_id = $${params.length}`); }
            const io = String(req.query.io || '').toUpperCase();
            if (io === 'I' || io === 'O') { params.push(io); conds.push(`c.io_divi = $${params.length}`); }
            const from = String(req.query.from || '').trim();
            const to = String(req.query.to || '').trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); conds.push(`c.cdate::date >= $${params.length}::date`); }
            if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); conds.push(`c.cdate::date <= $${params.length}::date`); }
            // 평가된 콜만(= /api/calls 유니버스). 포기호/미응대 제외.
            conds.push(`(
            EXISTS (SELECT 1 FROM eval_item_score er    WHERE er.call_id = c.call_id)
        )`);
            conds.push(`EXISTS (SELECT 1 FROM common.call_transcript q WHERE q.call_id = c.call_id AND q.speaker = 'agent')`);
            const where = `WHERE ${conds.join(' AND ')}`;
            const order = req.query.sort === 'date'
                ? `c.cdate DESC`
                : `e."TOTAL_SCORE" ASC NULLS LAST, c.cdate DESC`;   // 기본: 저점수 우선
            const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
            const page = Math.max(1, Number(req.query.page) || 1);
            const offset = (page - 1) * limit;

            const FROM = `common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id`;
            const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${FROM} ${where}`, params);
            const total = cnt[0]?.n || 0;
            const itemsParams = params.slice();
            itemsParams.push(limit, offset);
            const { rows } = await pool.query(
                `SELECT c.source_id AS id, c.cdate AS date, e."TOTAL_SCORE" AS score,
                    c.uid AS uid, c.call_seq AS call_no, c.io_divi AS io_divi
               FROM ${FROM} ${where}
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

    router.get('/api/coaching', requireAdmin, async (req, res) => {
        try {
            const orgId = resolveActiveOrgId(req);
            const params = [];
            const conds = ['g.archived_at IS NULL'];   // 보드에서 정리(X)한 코칭은 제외(코칭 이력엔 유지).
            if (orgId != null) {
                params.push(orgId);
                conds.push(`g.tenant_id = $${params.length}`);
            }
            const where = `WHERE ${conds.join(' AND ')}`;
            // 통합DB: coaching_assignments.tenant_id, 배정자·멤버=common.users(login_id=username|이메일 .ics 제거, name=표시명).
            const { rows } = await pool.query(
                `SELECT g.*, au.name AS assigned_by_name,
                    (SELECT array_agg(COALESCE(mu.username, regexp_replace(mu.email, '\\.ics$', '')))
                       FROM common.users mu WHERE mu.id = ANY(g.members)) AS member_logins
               FROM coaching_assignments g
               LEFT JOIN common.users au ON au.id = g.assigned_by_user_id
               ${where}
              ORDER BY g.created_at DESC`,
                params
            );
            // 배정 근거(문제 콜) — 관리자는 전 멤버 근거 열람. 멤버별로 묶어 상세 모달에서 표시.
            const reasonsByAssignment = new Map();
            const _rids = rows.map((r) => r.id);
            if (_rids.length) {
                // 통합DB: coaching_assignment_reasons.qa_call_id=call_id(bigint,→qa_evaluations). 헤더=common.calls, 점수=qa_evaluations.
                //   외부 표시 callId=common.calls.source_id(텍스트).
                const { rows: rrows } = await pool.query(
                    `SELECT r.assignment_id, r.member_user_id, r.qa_call_id, r.note,
                        c.source_id AS source_id,
                        COALESCE(c.cdate::text, r.call_date) AS date,
                        COALESCE(e."TOTAL_SCORE", r.score) AS score,
                        c.uid AS uid, c.call_seq AS call_no, c.io_divi
                   FROM coaching_assignment_reasons r
                   LEFT JOIN common.calls c ON c.call_id = r.qa_call_id
                   LEFT JOIN trustguard.qa_evaluations e ON e.call_id = r.qa_call_id
                  WHERE r.assignment_id = ANY($1::bigint[])
                  ORDER BY score ASC NULLS LAST`,
                    [_rids]
                );
                for (const rr of rrows) {
                    if (!reasonsByAssignment.has(rr.assignment_id)) reasonsByAssignment.set(rr.assignment_id, []);
                    reasonsByAssignment.get(rr.assignment_id).push({
                        memberUserId: rr.member_user_id,
                        callId: rr.source_id ?? rr.qa_call_id,
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
    router.get('/api/coaching/history', requireAdmin, async (req, res) => {
        try {
            const orgId = resolveActiveOrgId(req);
            const params = [];
            let where = '';
            if (orgId != null) {
                params.push(orgId);
                where = `WHERE g.tenant_id = $${params.length}`;
            }
            const { rows } = await pool.query(
                `SELECT
                 g.id          AS coaching_id,
                 g.title       AS title,
                 g.assigned_at AS assigned_at,
                 g.channel     AS channel,
                 g.scenario_codes AS scenario_codes,
                 COALESCE(cardinality(g.scenario_codes), 0) AS scenarios,
                 ab.name AS by_name,
                 m.member_uid  AS member_uid,
                 mu.name AS member_name,
                 COALESCE(mu.username, regexp_replace(mu.email, '\\.ics$', '')) AS member_login,
                 mm.department   AS member_team,
                 sc.before_avg AS before_avg,
                 sc.after_avg  AS after_avg
               FROM coaching_assignments g
               CROSS JOIN LATERAL unnest(g.members) AS m(member_uid)
               LEFT JOIN common.users ab ON ab.id = g.assigned_by_user_id
               LEFT JOIN common.users mu ON mu.id = m.member_uid
               LEFT JOIN common.memberships mm ON mm.user_id = m.member_uid AND mm.tenant_id = g.tenant_id
               LEFT JOIN LATERAL (
                   SELECT
                       round(avg(qe."TOTAL_SCORE") FILTER (WHERE qc.cdate <  g.assigned_at))::int AS before_avg,
                       round(avg(qe."TOTAL_SCORE") FILTER (WHERE qc.cdate >= g.assigned_at))::int AS after_avg
                     FROM common.calls qc
                     JOIN trustguard.qa_evaluations qe ON qe.call_id = qc.call_id
                    WHERE qc.agent_user_id = m.member_uid
                      AND qe."TOTAL_SCORE" IS NOT NULL
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

    router.post('/api/coaching', requireAdmin, async (req, res) => {
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
                    `INSERT INTO coaching_assignments
                     (tenant_id, title, target_type, members, action_items, scenario_codes, channel, assigned_by_user_id)
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
                    // 소유 검증 + 표시 스냅샷: 이 콜들(source_id)이 정말 memberId 상담사 것인지(agent_user_id) 확인.
                    //   통합DB: qa_call_id=call_id(bigint) 로 저장, call_date=cdate 텍스트 스냅샷.
                    const vparams = [callIds, memberId];
                    let vsql = `SELECT c.call_id AS id, c.cdate::text AS date, e."TOTAL_SCORE" AS score
                              FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                             WHERE c.source_id = ANY($1::text[]) AND c.agent_user_id = $2`;
                    if (orgId != null) { vparams.push(orgId); vsql += ` AND c.tenant_id = $3`; }
                    const { rows: valid } = await client.query(vsql, vparams);
                    for (const vc of valid) {
                        await client.query(
                            `INSERT INTO coaching_assignment_reasons
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

    router.delete('/api/coaching/:id', requireAdmin, async (req, res) => {
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
                scope = ` AND tenant_id = $${params.length}`;
            }
            const { rowCount } = await pool.query(
                `DELETE FROM coaching_assignments WHERE id = $1${scope}`,
                params
            );
            res.json({ ok: true, deleted: rowCount });
        } catch (error) {
            console.error('DELETE /api/coaching error:', error);
            res.status(500).json({ message: 'Failed to delete coaching.' });
        }
    });

    // 코칭 보드에서 정리(숨김) — archived_at 세팅. 레코드는 보존(코칭 이력엔 계속 노출). 전원 학습완료 카드의 'X'.
    router.post('/api/coaching/:id/archive', requireAdmin, async (req, res) => {
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
                scope = ` AND tenant_id = $${params.length}`;
            }
            const { rowCount } = await pool.query(
                `UPDATE coaching_assignments SET archived_at = now() WHERE id = $1${scope}`,
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
    router.post('/api/coaching/:id/archive-mine', async (req, res) => {
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
                `UPDATE coaching_assignments
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

    router.get('/api/coaching/mine', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) {
                res.json([]);
                return;
            }
            const { rows } = await pool.query(
                `SELECT g.*, au.name AS assigned_by_name,
                    sc.before_avg, sc.after_avg
               FROM coaching_assignments g
               LEFT JOIN common.users au ON au.id = g.assigned_by_user_id
               LEFT JOIN LATERAL (
                   SELECT
                       round(avg(qe."TOTAL_SCORE") FILTER (WHERE qc.cdate <  g.assigned_at))::int AS before_avg,
                       round(avg(qe."TOTAL_SCORE") FILTER (WHERE qc.cdate >= g.assigned_at))::int AS after_avg
                     FROM common.calls qc
                     JOIN trustguard.qa_evaluations qe ON qe.call_id = qc.call_id
                    WHERE qc.agent_user_id = $1
                      AND qe."TOTAL_SCORE" IS NOT NULL
               ) sc ON TRUE
              WHERE $1 = ANY(g.members)
              ORDER BY g.created_at DESC`,
                [uid]
            );
            // 본인 근거(문제 콜) — member_user_id = 본인 인 것만 조회(프라이버시). 콜 삭제 시 스냅샷 폴백.
            const reasonsByAssignment = new Map();
            const _rids = rows.map((r) => r.id);
            if (_rids.length) {
                // 통합DB: qa_call_id=call_id(bigint), 헤더=common.calls(source_id/uid/cdate/call_seq), 점수=qa_evaluations.
                const { rows: rrows } = await pool.query(
                    `SELECT r.assignment_id, r.qa_call_id, r.note,
                        c.source_id AS source_id,
                        COALESCE(c.cdate::text, r.call_date) AS date,
                        COALESCE(e."TOTAL_SCORE", r.score) AS score,
                        c.uid AS uid, c.call_seq AS call_no, c.io_divi
                   FROM coaching_assignment_reasons r
                   LEFT JOIN common.calls c ON c.call_id = r.qa_call_id
                   LEFT JOIN trustguard.qa_evaluations e ON e.call_id = r.qa_call_id
                  WHERE r.member_user_id = $1 AND r.assignment_id = ANY($2::bigint[])
                  ORDER BY score ASC NULLS LAST`,
                    [uid, _rids]
                );
                for (const rr of rrows) {
                    if (!reasonsByAssignment.has(rr.assignment_id)) reasonsByAssignment.set(rr.assignment_id, []);
                    reasonsByAssignment.get(rr.assignment_id).push({
                        callId: rr.source_id ?? rr.qa_call_id,
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
                            `SELECT 1 FROM notifications
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
                                orgId: row.tenant_id ?? null,
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

    return router;
}
