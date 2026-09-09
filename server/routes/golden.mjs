// 골든셋 · 스킬셋 지정 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 6개 · 함께 옮긴 헬퍼/상태 0개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createGoldenRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { AUDIT_ACTION, insertQaAuditLog } from '../auditLog.mjs';
import { SANDBOX_LOGIN_ID } from '../sandboxSession.mjs';

export function createGoldenRoutes(ctx) {
    const { pool, requireAdmin, resolveActiveOrgId } = ctx;
    const router = express.Router();

    /* ── 골든셋(qa_golden_set) ──────────────────────────────────
     * 수기평가 "AI 와 동일" 로 확정된 케이스를 LLM Few-shot 예제로 보관.
     * - GET    /api/golden-set/:qaId               → 해당 콜의 골드셋 행 목록 (order_no 기준)
     * - POST   /api/golden-set/:qaId/:orderNo      → 등록 (서버가 현재 데이터에서 스냅샷)
     * - DELETE /api/golden-set/:qaId/:orderNo      → 해제
     *
     * "동일" 판정 자체는 프론트의 새 수기평가 모델(낮음/동일/높음)에서 결정되며,
     * DB qa_call_item_score.manual_eval 컬럼은 아직 그 모델과 비호환이므로
     * 본 라우트는 manual_eval == ai_eval 검증을 강제하지 않는다 (프론트가 gatekeeper).
     * score 는 ai_eval (== 동일 판정 시 사용자가 인정한 점수) 을 그대로 스냅샷.
     */
    // 평가 항목 단위 골든셋 사례 조회 — AI 평가항목 관리 탭의 "골든셋 사례" 탭에서 사용.
    // 활성 브랜드(org_id) 로 필터. super_admin 이 X-Active-Brand-Id=all 이면 전체.
    // 매칭 키: order_no 가 오면 그것만 사용 (qa_call_item_score.item 의 긴 문구와
    // CHECKLIST_TEMPLATE.item 의 UI 단축어가 다른 신한 케이스 대응). 없으면 (category, item) 폴백.
    router.get('/api/golden-set', async (req, res) => {
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
                params.push(orgId); conds.push(`g.tenant_id = $${params.length}`);
            }
            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            // 통합DB: qa_golden_set.qa_id = call_id(bigint, →qa_evaluations). 외부 표시 qa_id=common.calls.source_id.
            //   검수자=qa_evaluations.user_id → common.users(login_id=username|이메일에서 .ics 제거, display_name=name).
            const { rows } = await pool.query(
                `SELECT g.golden_id, c.source_id AS qa_id, g.order_no, g.tenant_id AS org_id,
                    c.cdate AS call_datetime,
                    g.category, g.item, g.reason_text, g.agent_utterance, g.score,
                    g.created_at,
                    e.user_id      AS user_id,
                    COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                    u.name         AS display_name
             FROM qa_golden_set g
             LEFT JOIN common.calls c ON c.call_id = g.qa_id
             LEFT JOIN trustguard.qa_evaluations e ON e.call_id = g.qa_id
             LEFT JOIN common.users u ON u.id = e.user_id
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

    router.get('/api/golden-set/:qaId', async (req, res) => {
        const qaId = String(req.params.qaId || '').trim();
        if (!qaId) {
            res.status(400).json({ message: 'qaId is required' });
            return;
        }
        try {
            // 통합DB: :qaId=source_id → call_id. qa_golden_set.qa_id=call_id.
            const { rows: cc } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
            if (!cc[0]) {
                res.json({ ok: true, entries: [] });
                return;
            }
            const { rows } = await pool.query(
                `SELECT g.golden_id, c.source_id AS qa_id, g.order_no, g.tenant_id AS org_id,
                    c.cdate AS call_datetime,
                    g.category, g.item, g.reason_text, g.agent_utterance, g.score,
                    g.created_at,
                    e.user_id     AS user_id,
                    COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                    u.name        AS display_name
             FROM qa_golden_set g
             LEFT JOIN common.calls c ON c.call_id = g.qa_id
             LEFT JOIN trustguard.qa_evaluations e ON e.call_id = g.qa_id
             LEFT JOIN common.users u ON u.id = e.user_id
             WHERE g.qa_id = $1
             ORDER BY g.order_no ASC`,
                [cc[0].call_id]
            );
            res.json({ ok: true, entries: rows });
        } catch (error) {
            console.error('GET /api/golden-set/:qaId error:', error);
            res.status(500).json({ message: 'Failed to load golden set.' });
        }
    });

    router.post('/api/golden-set/:qaId/:orderNo', requireAdmin, async (req, res) => {
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
                    `SELECT e.is_sandbox
                   FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                  WHERE c.source_id = $1 LIMIT 1`,
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
            // 스냅샷 소스: 평가행 + 체크리스트(발화) + 콜 메타. 통합DB: :qaId=source_id → call_id.
            //   qa_golden_set.qa_id=call_id, tenant_id=콜 테넌트. 등록자는 qa_evaluations.user_id(검수자)로 추적.
            const { rows: evalRow } = await pool.query(
                `SELECT er.call_id, er.order_no, er.category, er.item, er.reason_text, er.ai_eval,
                    er.agent_utterance, c.tenant_id AS org_id
             FROM eval_item_score er
             JOIN common.calls c ON c.call_id = er.call_id
             WHERE c.source_id = $1 AND er.order_no = $2
             LIMIT 1`,
                [qaId, orderNo]
            );
            if (!evalRow[0]) {
                res.status(404).json({ message: 'evaluation row not found' });
                return;
            }
            const e = evalRow[0];

            // UNIQUE (qa_id, order_no) 충돌 시 충돌 행 그대로 반환 (멱등성). qa_id=call_id, org_id=tenant_id.
            const { rows: inserted } = await pool.query(
                `INSERT INTO qa_golden_set (
                qa_id, order_no, tenant_id,
                category, item, reason_text, agent_utterance, score
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (qa_id, order_no) DO NOTHING
             RETURNING golden_id, qa_id, order_no, score, created_at`,
                [
                    e.call_id, orderNo, e.org_id ?? null,
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
            // entry.qa_id 는 call_id(bigint)로 반환되므로 FE 계약(텍스트 source_id)에 맞춰 덮어쓴다.
            res.json({ ok: true, inserted: wasNew, entry: inserted[0] ? { ...inserted[0], qa_id: qaId } : null });
        } catch (error) {
            console.error('POST /api/golden-set/:qaId/:orderNo error:', error);
            res.status(500).json({ message: 'Failed to add to golden set.' });
        }
    });

    router.delete('/api/golden-set/:qaId/:orderNo', requireAdmin, async (req, res) => {
        const qaId = String(req.params.qaId || '').trim();
        const orderNo = Number(req.params.orderNo);
        if (!qaId || !Number.isFinite(orderNo)) {
            res.status(400).json({ message: 'qaId and orderNo are required' });
            return;
        }

        if (req.session?.login_id === SANDBOX_LOGIN_ID) {
            try {
                const { rows: targetRow } = await pool.query(
                    `SELECT e.is_sandbox
                   FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                  WHERE c.source_id = $1 LIMIT 1`,
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
            // 통합DB: :qaId=source_id → call_id. qa_golden_set.qa_id=call_id.
            const { rows: cc } = await pool.query('SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1', [qaId]);
            const { rowCount } = cc[0]
                ? await pool.query(`DELETE FROM qa_golden_set WHERE qa_id = $1 AND order_no = $2`, [cc[0].call_id, orderNo])
                : { rowCount: 0 };
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

    // ── 스킬셋 (수기 '높음'/'낮음' 정정 누적) — AI 스킬 관리 화면 ────────
    // 검수자가 AI 점수를 정정('낮음'=과대평가/'높음'=과소평가)한 승인·비샌드박스 항목행.
    // 스킬 학습(skillLearn.collectSkillCases)과 동일 소스이며, skill_excluded_at 이 찍힌 건 뺀다.
    router.get('/api/skillset', async (req, res) => {
        const orderNoRaw = req.query.order_no;
        const orderNo = orderNoRaw !== undefined && orderNoRaw !== '' && Number.isFinite(Number(orderNoRaw))
            ? Number(orderNoRaw)
            : null;
        const category = String(req.query.category || '').trim();
        const item = String(req.query.item || '').trim();
        const orgId = resolveActiveOrgId(req);
        try {
            // 통합DB: review_status/is_sandbox/user_id=qa_evaluations(e), 헤더=common.calls(c), 검수자=common.users.
            const conds = [`e.review_status = 'approved'`, `e.is_sandbox = false`, `er.manual_eval_option IN ('낮음','높음')`];
            const params = [];
            if (orderNo !== null) {
                params.push(orderNo); conds.push(`er.order_no = $${params.length}`);
            } else {
                if (category) { params.push(category); conds.push(`er.category = $${params.length}`); }
                if (item)     { params.push(item);     conds.push(`er.item     = $${params.length}`); }
            }
            if (orgId !== null && orgId !== undefined) {
                params.push(orgId); conds.push(`c.tenant_id = $${params.length}`);
            }
            const where = `WHERE ${conds.join(' AND ')}`;
            const { rows } = await pool.query(
                `SELECT c.source_id AS qa_id, er.order_no, er.category, er.item,
                    er.ai_eval, er.manual_eval_option AS direction, er.reason_text,
                    er.agent_utterance,
                    c.cdate AS call_datetime, c.tenant_id AS org_id,
                    COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                    u.name AS display_name
               FROM eval_item_score er
               JOIN common.calls c ON c.call_id = er.call_id
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
               LEFT JOIN common.users u ON u.id = e.user_id
               ${where}
                 AND er.skill_excluded_at IS NULL
               ORDER BY c.cdate DESC
               LIMIT 200`,
                params
            );
            res.json({ ok: true, entries: rows });
        } catch (error) {
            console.error('GET /api/skillset error:', error);
            res.status(500).json({ message: 'Failed to load skillset entries.' });
        }
    });

    // DELETE /api/skillset/:qaId/:orderNo — 스킬셋에서만 제외(배치 학습 대상 제외). 원본 평가행 불변.
    router.delete('/api/skillset/:qaId/:orderNo', requireAdmin, async (req, res) => {
        const qaId = String(req.params.qaId || '').trim();
        const orderNo = Number(req.params.orderNo);
        if (!qaId || !Number.isFinite(orderNo)) {
            res.status(400).json({ message: 'qaId and orderNo are required' });
            return;
        }
        try {
            // 제외는 평가행의 플래그 컬럼으로 표기(마이그레이션 70 — 구 qa_skill_excluded 흡수).
            // 원본 점수·사유는 그대로 두고 학습 신호에서만 빠진다(soft-exclude).
            // 통합DB: :qaId=source_id → call_id. eval_item_score 는 call_id 키.
            await pool.query(
                `UPDATE eval_item_score
                SET skill_excluded_at = now()
              WHERE call_id = (SELECT call_id FROM common.calls WHERE source_id = $1 LIMIT 1)
                AND order_no = $2 AND skill_excluded_at IS NULL`,
                [qaId, orderNo]
            );
            res.json({ ok: true, excluded: true });
        } catch (error) {
            console.error('DELETE /api/skillset/:qaId/:orderNo error:', error);
            res.status(500).json({ message: 'Failed to exclude from skillset.' });
        }
    });

    return router;
}
