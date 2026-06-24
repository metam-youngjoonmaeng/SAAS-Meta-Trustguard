// 브랜드(=Organization) / 도메인(Domain) / 사용자(admin_users) / 감사 로그 라우터.
// 원본: 01-AI-Tutor-dev/backend/admin/routes.py 의 /admin/{domains,brands,organizations,trainees,login-history}
// 권한:
//   - GET  /api/admin/organizations  : admin / super_admin (사이드바 셀렉터용 활성 브랜드 목록)
//   - GET  /api/admin/domains        : admin / super_admin (브랜드 등록 폼에서 선택지)
//   - GET  /api/admin/users          : admin / super_admin (admin 은 본인 브랜드만)
//   - POST/PATCH/DELETE /admin/users 및 /brands 관리 목록 : super_admin 전용
//   - GET  /api/admin/audit-logs     : super_admin 전용 (실시간 로그)
//   - GET  /api/admin/notifications  : admin / super_admin (본인이 수행한 평가·적재 이벤트만)

import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import { AUDIT_ACTION, AUDIT_VIEW_WINDOW_DAYS, insertQaAuditLog } from './auditLog.mjs';
import { logger, todayLogPath } from './logger.mjs';
import {
    seedMinimalEvalItems,
    seedEvalItemsFromDomain,
    seedPentagonAxesFromDomain,
    applyDomainEvalItems,
    applyDomainPentagonAxes,
} from './defaultEvalItems.mjs';

// 레거시 표준 브랜드(신한1 / 한화2 / 코오롱3) — 도메인 변경 시 평가항목 교체 대상에서 제외(기존 항목 보존).
// canonical 정의: server/qaPipelineIngest.mjs 의 동명 상수.
const LEGACY_STANDARD_ORG_IDS = new Set([1, 2, 3]);

function sha256Hex(s) {
    return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// 신규 사용자에게 자동 부여되는 초기 비밀번호.
// INITIAL_USER_PASSWORD env 가 있으면 그 값을, 없으면 PoC 폴백 '1234'.
// 신규 계정은 must_change_password=true 로 시작 → 첫 로그인 시 강제 변경.
function resolveInitialPassword() {
    const fromEnv = String(process.env.INITIAL_USER_PASSWORD || '').trim();
    if (fromEnv) return fromEnv;
    if (!resolveInitialPassword._warned) {
        console.warn('[qa-api] INITIAL_USER_PASSWORD 미설정 — PoC 폴백 "1234" 사용. 운영에서는 반드시 .env 로 강력한 값 설정.');
        resolveInitialPassword._warned = true;
    }
    return '1234';
}

function requireSuperAdmin(req, res, next) {
    if (!req.session || req.session.role !== 'super_admin') {
        res.status(403).json({ message: 'super_admin 권한이 필요합니다' });
        return;
    }
    next();
}

async function domainNameById(pool, domainId) {
    if (domainId == null) return null;
    const { rows } = await pool.query('SELECT name FROM public.domains WHERE id = $1', [domainId]);
    return rows[0]?.name ?? null;
}

export function createBrandRouter(pool) {
    const router = express.Router();

    // ── 도메인 ─────────────────────────────────────────────

    router.get('/admin/domains', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, name, key, sort_order
                 FROM public.domains
                 WHERE active = true
                 ORDER BY sort_order ASC, id ASC`
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/domains error:', err);
            res.status(500).json({ message: 'Failed to list domains.' });
        }
    });

    router.post('/admin/domains', requireSuperAdmin, async (req, res) => {
        const name = String(req.body?.name || '').trim();
        const key = String(req.body?.key || '').trim();
        const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;
        if (!name) {
            res.status(400).json({ message: 'name 필수' });
            return;
        }
        try {
            const { rows } = await pool.query(
                `INSERT INTO public.domains (name, key, sort_order)
                 VALUES ($1, $2, $3)
                 RETURNING id, name, key, sort_order`,
                [name, key, sortOrder]
            );
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_CREATE,
                resource_type: 'domain',
                resource_id: String(rows[0]?.id ?? ''),
                http_method: 'POST',
                http_path: '/api/admin/domains',
                detail_json: JSON.stringify({ name, key, sort_order: sortOrder }),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            console.error('POST /api/admin/domains error:', err);
            res.status(500).json({ message: 'Failed to create domain.' });
        }
    });

    router.patch('/admin/domains/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const fields = [];
        const values = [];
        let idx = 1;
        for (const k of ['name', 'key']) {
            if (typeof req.body?.[k] === 'string') {
                fields.push(`${k} = $${idx++}`);
                values.push(String(req.body[k]).trim());
            }
        }
        if (req.body?.sort_order != null && Number.isFinite(Number(req.body.sort_order))) {
            fields.push(`sort_order = $${idx++}`);
            values.push(Number(req.body.sort_order));
        }
        if (typeof req.body?.active === 'boolean') {
            fields.push(`active = $${idx++}`);
            values.push(Boolean(req.body.active));
        }
        if (fields.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        values.push(id);
        try {
            const { rows } = await pool.query(
                `UPDATE public.domains SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, name, key, sort_order, active`,
                values
            );
            if (rows.length === 0) {
                res.status(404).json({ message: '도메인을 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_UPDATE,
                resource_type: 'domain',
                resource_id: String(id),
                http_method: 'PATCH',
                http_path: `/api/admin/domains/${id}`,
                detail_json: JSON.stringify(req.body || {}).slice(0, 8000),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            console.error('PATCH /api/admin/domains/:id error:', err);
            res.status(500).json({ message: 'Failed to update domain.' });
        }
    });

    router.delete('/admin/domains/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        try {
            await pool.query('DELETE FROM public.domains WHERE id = $1', [id]);
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_DELETE,
                resource_type: 'domain',
                resource_id: String(id),
                http_method: 'DELETE',
                http_path: `/api/admin/domains/${id}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/admin/domains/:id error:', err);
            res.status(500).json({ message: 'Failed to delete domain.' });
        }
    });

    // ── 도메인별 기본 평가항목 (domain_default_eval_items) ──────
    // 신규 브랜드 생성 시 eval_item_defs 로 복제되는 템플릿. super_admin 만 편집.
    // (브랜드 관리 → 도메인 편집 화면에서 도메인 클릭 시 노출)

    // 특정 도메인의 기본 평가항목 목록 (super_admin 전용 — 전역 템플릿 설정).
    router.get('/admin/domains/:id/eval-defaults', requireSuperAdmin, async (req, res) => {
        const domainId = Number(req.params.id);
        if (!Number.isFinite(domainId)) {
            res.status(400).json({ message: 'invalid domain id' });
            return;
        }
        try {
            const { rows } = await pool.query(
                `SELECT id, domain_id, order_no, category, item, criterion, prompt_template,
                        pentagon_axis, scoring_type, max_score, is_active
                 FROM public.domain_default_eval_items
                 WHERE domain_id = $1
                 ORDER BY order_no ASC, id ASC`,
                [domainId]
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/domains/:id/eval-defaults error:', err);
            res.status(500).json({ message: 'Failed to list domain eval defaults.' });
        }
    });

    // 도메인 기본 평가항목 추가. order_no 는 미사용 최소 양의 정수로 자동 발급.
    router.post('/admin/domains/:id/eval-defaults', requireSuperAdmin, async (req, res) => {
        const domainId = Number(req.params.id);
        if (!Number.isFinite(domainId)) {
            res.status(400).json({ message: 'invalid domain id' });
            return;
        }
        const category = String(req.body?.category || '').trim();
        const item = String(req.body?.item || '').trim();
        if (!category) { res.status(400).json({ message: 'category 필수' }); return; }
        if (!item) { res.status(400).json({ message: 'item 필수' }); return; }
        const criterion = typeof req.body?.criterion === 'string' ? req.body.criterion : null;
        const promptTemplate = typeof req.body?.prompt_template === 'string' ? req.body.prompt_template : null;
        const pentagonAxis =
            req.body?.pentagon_axis == null || req.body?.pentagon_axis === ''
                ? null : String(req.body.pentagon_axis).trim();
        const scoringType = req.body?.scoring_type === 'yes_no' ? 'yes_no' : 'numeric';
        let maxScore = null;
        if (scoringType === 'numeric') {
            const n = Number(req.body?.max_score);
            if (!Number.isFinite(n) || n <= 0) {
                res.status(400).json({ message: 'numeric 항목은 max_score > 0 필요' });
                return;
            }
            maxScore = Math.round(n);
        }
        const isActive = req.body?.is_active === false ? false : true;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // order_no 발급: 해당 도메인에서 사용 안 된 최소 양의 정수.
            const { rows: usedRows } = await client.query(
                `SELECT order_no FROM public.domain_default_eval_items WHERE domain_id = $1`,
                [domainId]
            );
            const usedSet = new Set(usedRows.map((r) => Number(r.order_no)));
            let nextOrderNo = 1;
            while (usedSet.has(nextOrderNo)) nextOrderNo++;
            const { rows } = await client.query(
                `INSERT INTO public.domain_default_eval_items
                   (domain_id, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING id, domain_id, order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active`,
                [domainId, nextOrderNo, category, item, criterion, promptTemplate,
                 pentagonAxis, scoringType, maxScore, isActive]
            );
            await client.query('COMMIT');
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_EVAL_DEFAULT_CREATE,
                resource_type: 'domain_eval_default',
                resource_id: String(rows[0]?.id ?? ''),
                http_method: 'POST',
                http_path: `/api/admin/domains/${domainId}/eval-defaults`,
                detail_json: JSON.stringify({ domain_id: domainId, category, item, order_no: nextOrderNo }),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('POST /api/admin/domains/:id/eval-defaults error:', err);
            res.status(500).json({ message: 'Failed to create domain eval default.' });
        } finally {
            client.release();
        }
    });

    // 도메인 기본 평가항목 수정.
    router.patch('/admin/domain-eval-defaults/:itemId', requireSuperAdmin, async (req, res) => {
        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const fields = [];
        const values = [];
        let idx = 1;
        for (const k of ['category', 'item']) {
            if (typeof req.body?.[k] === 'string') {
                const v = String(req.body[k]).trim();
                if (!v) { res.status(400).json({ message: `${k} 는 비울 수 없습니다` }); return; }
                fields.push(`${k} = $${idx++}`);
                values.push(v);
            }
        }
        for (const k of ['criterion', 'prompt_template']) {
            if (k in (req.body || {})) {
                fields.push(`${k} = $${idx++}`);
                values.push(typeof req.body[k] === 'string' ? req.body[k] : null);
            }
        }
        if ('pentagon_axis' in (req.body || {})) {
            fields.push(`pentagon_axis = $${idx++}`);
            values.push(req.body.pentagon_axis == null || req.body.pentagon_axis === '' ? null : String(req.body.pentagon_axis).trim());
        }
        if (typeof req.body?.scoring_type === 'string') {
            const st = req.body.scoring_type === 'yes_no' ? 'yes_no' : 'numeric';
            fields.push(`scoring_type = $${idx++}`);
            values.push(st);
            // yes_no 면 max_score 무효화, numeric 이면 본문 max_score 따름(아래 분기에서 처리).
            if (st === 'yes_no') {
                fields.push(`max_score = $${idx++}`);
                values.push(null);
            }
        }
        if ('max_score' in (req.body || {}) && req.body?.scoring_type !== 'yes_no') {
            const n = Number(req.body.max_score);
            fields.push(`max_score = $${idx++}`);
            values.push(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
        }
        if (typeof req.body?.is_active === 'boolean') {
            fields.push(`is_active = $${idx++}`);
            values.push(Boolean(req.body.is_active));
        }
        if (typeof req.body?.order_no === 'number' && Number.isFinite(req.body.order_no)) {
            fields.push(`order_no = $${idx++}`);
            values.push(Math.round(req.body.order_no));
        }
        if (fields.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        fields.push(`updated_at = now()`);
        values.push(itemId);
        try {
            const { rows } = await pool.query(
                `UPDATE public.domain_default_eval_items SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, domain_id, order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active`,
                values
            );
            if (rows.length === 0) {
                res.status(404).json({ message: '항목을 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_EVAL_DEFAULT_UPDATE,
                resource_type: 'domain_eval_default',
                resource_id: String(itemId),
                http_method: 'PATCH',
                http_path: `/api/admin/domain-eval-defaults/${itemId}`,
                detail_json: JSON.stringify(req.body || {}).slice(0, 8000),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            console.error('PATCH /api/admin/domain-eval-defaults/:itemId error:', err);
            res.status(500).json({ message: 'Failed to update domain eval default.' });
        }
    });

    // 도메인 기본 평가항목 삭제 (하드 삭제 — 템플릿이라 이력 불필요).
    router.delete('/admin/domain-eval-defaults/:itemId', requireSuperAdmin, async (req, res) => {
        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        try {
            const { rowCount } = await pool.query(
                'DELETE FROM public.domain_default_eval_items WHERE id = $1',
                [itemId]
            );
            if (rowCount === 0) {
                res.status(404).json({ message: '항목을 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_EVAL_DEFAULT_DELETE,
                resource_type: 'domain_eval_default',
                resource_id: String(itemId),
                http_method: 'DELETE',
                http_path: `/api/admin/domain-eval-defaults/${itemId}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/admin/domain-eval-defaults/:itemId error:', err);
            res.status(500).json({ message: 'Failed to delete domain eval default.' });
        }
    });

    // ── 도메인별 기본 펜타곤 축 (domain_default_pentagon_axes) ──────
    // 신규 브랜드 생성 시 pentagon_axes 로 복제되는 템플릿. super_admin 만 편집.

    router.get('/admin/domains/:id/pentagon-defaults', requireSuperAdmin, async (req, res) => {
        const domainId = Number(req.params.id);
        if (!Number.isFinite(domainId)) {
            res.status(400).json({ message: 'invalid domain id' });
            return;
        }
        try {
            const { rows } = await pool.query(
                `SELECT id, domain_id, axis_no, label, description, prompt_template, is_active
                 FROM public.domain_default_pentagon_axes
                 WHERE domain_id = $1
                 ORDER BY axis_no ASC, id ASC`,
                [domainId]
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/domains/:id/pentagon-defaults error:', err);
            res.status(500).json({ message: 'Failed to list domain pentagon defaults.' });
        }
    });

    router.post('/admin/domains/:id/pentagon-defaults', requireSuperAdmin, async (req, res) => {
        const domainId = Number(req.params.id);
        if (!Number.isFinite(domainId)) {
            res.status(400).json({ message: 'invalid domain id' });
            return;
        }
        const label = String(req.body?.label || '').trim();
        if (!label) { res.status(400).json({ message: 'label 필수' }); return; }
        const description = typeof req.body?.description === 'string' ? req.body.description : null;
        const promptTemplate = typeof req.body?.prompt_template === 'string' ? req.body.prompt_template : null;
        const isActive = req.body?.is_active === false ? false : true;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // axis_no 발급: 해당 도메인에서 사용 안 된 최소 양의 정수.
            const { rows: usedRows } = await client.query(
                `SELECT axis_no FROM public.domain_default_pentagon_axes WHERE domain_id = $1`,
                [domainId]
            );
            const usedSet = new Set(usedRows.map((r) => Number(r.axis_no)));
            let nextAxisNo = 1;
            while (usedSet.has(nextAxisNo)) nextAxisNo++;
            const { rows } = await client.query(
                `INSERT INTO public.domain_default_pentagon_axes
                   (domain_id, axis_no, label, description, prompt_template, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, domain_id, axis_no, label, description, prompt_template, is_active`,
                [domainId, nextAxisNo, label, description, promptTemplate, isActive]
            );
            await client.query('COMMIT');
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_PENTAGON_DEFAULT_CREATE,
                resource_type: 'domain_pentagon_default',
                resource_id: String(rows[0]?.id ?? ''),
                http_method: 'POST',
                http_path: `/api/admin/domains/${domainId}/pentagon-defaults`,
                detail_json: JSON.stringify({ domain_id: domainId, label, axis_no: nextAxisNo }),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('POST /api/admin/domains/:id/pentagon-defaults error:', err);
            res.status(500).json({ message: 'Failed to create domain pentagon default.' });
        } finally {
            client.release();
        }
    });

    router.patch('/admin/domain-pentagon-defaults/:itemId', requireSuperAdmin, async (req, res) => {
        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const fields = [];
        const values = [];
        let idx = 1;
        if (typeof req.body?.label === 'string') {
            const v = String(req.body.label).trim();
            if (!v) { res.status(400).json({ message: 'label 은 비울 수 없습니다' }); return; }
            fields.push(`label = $${idx++}`);
            values.push(v);
        }
        for (const k of ['description', 'prompt_template']) {
            if (k in (req.body || {})) {
                fields.push(`${k} = $${idx++}`);
                values.push(typeof req.body[k] === 'string' ? req.body[k] : null);
            }
        }
        if (typeof req.body?.is_active === 'boolean') {
            fields.push(`is_active = $${idx++}`);
            values.push(Boolean(req.body.is_active));
        }
        if (typeof req.body?.axis_no === 'number' && Number.isFinite(req.body.axis_no)) {
            fields.push(`axis_no = $${idx++}`);
            values.push(Math.round(req.body.axis_no));
        }
        if (fields.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        fields.push(`updated_at = now()`);
        values.push(itemId);
        try {
            const { rows } = await pool.query(
                `UPDATE public.domain_default_pentagon_axes SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, domain_id, axis_no, label, description, prompt_template, is_active`,
                values
            );
            if (rows.length === 0) {
                res.status(404).json({ message: '축을 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_PENTAGON_DEFAULT_UPDATE,
                resource_type: 'domain_pentagon_default',
                resource_id: String(itemId),
                http_method: 'PATCH',
                http_path: `/api/admin/domain-pentagon-defaults/${itemId}`,
                detail_json: JSON.stringify(req.body || {}).slice(0, 8000),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            console.error('PATCH /api/admin/domain-pentagon-defaults/:itemId error:', err);
            res.status(500).json({ message: 'Failed to update domain pentagon default.' });
        }
    });

    router.delete('/admin/domain-pentagon-defaults/:itemId', requireSuperAdmin, async (req, res) => {
        const itemId = Number(req.params.itemId);
        if (!Number.isFinite(itemId)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        try {
            const { rowCount } = await pool.query(
                'DELETE FROM public.domain_default_pentagon_axes WHERE id = $1',
                [itemId]
            );
            if (rowCount === 0) {
                res.status(404).json({ message: '축을 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.DOMAIN_PENTAGON_DEFAULT_DELETE,
                resource_type: 'domain_pentagon_default',
                resource_id: String(itemId),
                http_method: 'DELETE',
                http_path: `/api/admin/domain-pentagon-defaults/${itemId}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/admin/domain-pentagon-defaults/:itemId error:', err);
            res.status(500).json({ message: 'Failed to delete domain pentagon default.' });
        }
    });

    // ── 조직(브랜드) ────────────────────────────────────────

    // 사이드바 셀렉터용 — admin: 본인 소속 브랜드(들), super_admin: 활성 전체
    router.get('/admin/organizations', async (req, res) => {
        try {
            const isSuper = req.session?.role === 'super_admin';
            const ownOrgId = Number(req.session?.org_id) || null;
            const { rows: orgRows } = isSuper
                ? await pool.query(
                      `SELECT o.id, o.name, o.short, o.color, o.active, o.domain_id,
                              d.name AS domain_name
                       FROM public.organizations o
                       LEFT JOIN public.domains d ON d.id = o.domain_id
                       WHERE o.active = true
                       ORDER BY o.id ASC`
                  )
                : await pool.query(
                      `SELECT o.id, o.name, o.short, o.color, o.active, o.domain_id,
                              d.name AS domain_name
                       FROM public.organizations o
                       LEFT JOIN public.domains d ON d.id = o.domain_id
                       WHERE o.active = true AND o.id = $1
                       ORDER BY o.id ASC`,
                      [ownOrgId]
                  );

            const ids = orgRows.map((r) => r.id);
            const counts = await brandStatCounts(pool, ids);

            res.json(
                orgRows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    short: r.short || r.name.slice(0, 1),
                    color: r.color,
                    domain_id: r.domain_id,
                    domain_name: r.domain_name,
                    members: counts.members.get(r.id) || 0,
                    sessions: counts.sessions.get(r.id) || 0,
                    is_own: r.id === ownOrgId,
                    is_current: r.id === ownOrgId,
                }))
            );
        } catch (err) {
            console.error('GET /api/admin/organizations error:', err);
            res.status(500).json({ message: 'Failed to list organizations.' });
        }
    });

    // super_admin 관리 탭 — 전체(비활성 포함)
    router.get('/admin/brands', requireSuperAdmin, async (req, res) => {
        try {
            const { rows: orgRows } = await pool.query(
                `SELECT o.id, o.name, o.short, o.color, o.active, o.domain_id, o.created_at,
                        d.name AS domain_name
                 FROM public.organizations o
                 LEFT JOIN public.domains d ON d.id = o.domain_id
                 ORDER BY o.id ASC`
            );
            const ids = orgRows.map((r) => r.id);
            const counts = await brandStatCounts(pool, ids);

            res.json(
                orgRows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    short: r.short || r.name.slice(0, 1),
                    color: r.color,
                    active: r.active,
                    domain_id: r.domain_id,
                    domain_name: r.domain_name,
                    created_at: r.created_at,
                    members: counts.members.get(r.id) || 0,
                    sessions: counts.sessions.get(r.id) || 0,
                }))
            );
        } catch (err) {
            console.error('GET /api/admin/brands error:', err);
            res.status(500).json({ message: 'Failed to list brands.' });
        }
    });

    router.post('/admin/organizations', requireSuperAdmin, async (req, res) => {
        const name = String(req.body?.name || '').trim();
        const short = String(req.body?.short || '').trim().slice(0, 2);
        const color = String(req.body?.color || '#055AAF').trim();
        const domainId =
            req.body?.domain_id == null || req.body?.domain_id === ''
                ? null
                : Number(req.body.domain_id);
        if (!name) {
            res.status(400).json({ message: 'name 필수' });
            return;
        }
        const client = await pool.connect();
        let out;
        let seededItemCount = 0;
        let seededAxisCount = 0;
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `INSERT INTO public.organizations (name, short, color, domain_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, name, short, color, active, domain_id`,
                [name, short, color, domainId]
            );
            out = rows[0];
            // 신규 브랜드 = 선택한 도메인(업종) 기본 평가항목 + 펜타곤 축 복제.
            //   도메인 미지정/디폴트 0건이면 '첫인사' 1항목 폴백. 펜타곤 0건이면 프론트 코드 기본 라벨 폴백.
            seededItemCount = await seedEvalItemsFromDomain(client, out.id, domainId);
            if (seededItemCount === 0) {
                seededItemCount = await seedMinimalEvalItems(client, out.id);
            }
            seededAxisCount = await seedPentagonAxesFromDomain(client, out.id, domainId);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
            const detail = `${err?.code || ''} ${err?.message || err} ${err?.detail || ''}`.trim();
            logger.error(`POST /api/admin/organizations: ${detail}`, { module: 'brand' });
            console.error('POST /api/admin/organizations error:', err);
            res.status(500).json({ message: `Failed to create organization. ${detail}`.trim() });
            return;
        }
        client.release();
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.BRAND_CREATE,
            resource_type: 'brand',
            resource_id: String(out?.id ?? ''),
            http_method: 'POST',
            http_path: '/api/admin/organizations',
            detail_json: JSON.stringify({ name, short, color, domain_id: domainId, seeded_eval_items: seededItemCount, seeded_pentagon_axes: seededAxisCount }),
            success: true,
        });
        res.json({ ...out, domain_name: await domainNameById(pool, out.domain_id) });
    });

    router.patch('/admin/brands/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const fields = [];
        const values = [];
        let idx = 1;
        for (const k of ['name', 'short', 'color']) {
            if (typeof req.body?.[k] === 'string') {
                let v = String(req.body[k]).trim();
                if (k === 'short') v = v.slice(0, 2);
                fields.push(`${k} = $${idx++}`);
                values.push(v);
            }
        }
        if (typeof req.body?.active === 'boolean') {
            fields.push(`active = $${idx++}`);
            values.push(Boolean(req.body.active));
        }
        const hasDomainInBody = 'domain_id' in (req.body || {});
        let newDomainId = null;
        if (hasDomainInBody) {
            newDomainId = req.body.domain_id == null || req.body.domain_id === '' ? null : Number(req.body.domain_id);
            fields.push(`domain_id = $${idx++}`);
            values.push(newDomainId);
        }
        if (fields.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        values.push(id);
        const client = await pool.connect();
        let out;
        let reseed = null;
        let reseedAxes = null;
        try {
            await client.query('BEGIN');
            // 도메인 변경 감지용 현재 값
            const cur = await client.query('SELECT domain_id FROM public.organizations WHERE id = $1', [id]);
            if (cur.rows.length === 0) {
                await client.query('ROLLBACK').catch(() => {});
                client.release();
                res.status(404).json({ message: '브랜드를 찾을 수 없습니다' });
                return;
            }
            const prevDomainId = cur.rows[0].domain_id;
            const { rows } = await client.query(
                `UPDATE public.organizations SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, name, short, color, active, domain_id`,
                values
            );
            out = rows[0];
            // 도메인이 실제로 바뀌면 '기본' 평가항목 + 펜타곤 축을 새 도메인 기본값으로 교체. 레거시 표준(1/2/3)은 보존.
            const domainChanged =
                hasDomainInBody && Number(prevDomainId ?? -1) !== Number(newDomainId ?? -1);
            if (domainChanged && !LEGACY_STANDARD_ORG_IDS.has(id)) {
                reseed = await applyDomainEvalItems(client, id, newDomainId, true);
                reseedAxes = await applyDomainPentagonAxes(client, id, newDomainId, true);
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
            console.error('PATCH /api/admin/brands/:id error:', err);
            res.status(500).json({ message: 'Failed to update brand.' });
            return;
        }
        client.release();
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.BRAND_UPDATE,
            resource_type: 'brand',
            resource_id: String(id),
            http_method: 'PATCH',
            http_path: `/api/admin/brands/${id}`,
            detail_json: JSON.stringify({
                ...(req.body || {}),
                reseeded_eval_items: reseed?.count ?? null,
                reseed_mode: reseed?.mode ?? null,
                reseeded_pentagon_axes: reseedAxes ?? null,
            }).slice(0, 8000),
            success: true,
        });
        res.json({
            ...out,
            domain_name: await domainNameById(pool, out.domain_id),
            reseeded_eval_items: reseed?.count ?? null,
            reseed_mode: reseed?.mode ?? null,
            reseeded_pentagon_axes: reseedAxes ?? null,
        });
    });

    router.delete('/admin/brands/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        try {
            // qa_calls.org_id 가 ON DELETE RESTRICT 이므로 활성 콜이 있는 브랜드는 삭제 불가
            const { rows: refRows } = await pool.query(
                'SELECT COUNT(*)::int AS cnt FROM public.qa_calls WHERE org_id = $1',
                [id]
            );
            if (refRows[0]?.cnt > 0) {
                res.status(409).json({
                    message: `해당 브랜드에 연결된 콜 ${refRows[0].cnt}건이 있어 삭제할 수 없습니다`,
                });
                return;
            }
            await pool.query('DELETE FROM public.organizations WHERE id = $1', [id]);
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.BRAND_DELETE,
                resource_type: 'brand',
                resource_id: String(id),
                http_method: 'DELETE',
                http_path: `/api/admin/brands/${id}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/admin/brands/:id error:', err);
            res.status(500).json({ message: 'Failed to delete brand.' });
        }
    });

    // ── 사용자(admin_users) ─────────────────────────────────

    // GET /api/admin/users
    // 브랜드별 가시성 규칙:
    //   - admin       : 본인 org_id 소속 사용자 + 전역(org_id NULL) super_admin
    //   - super_admin : 활성 브랜드(X-Active-Brand-Id 헤더, 없으면 ?brand_id 쿼리, 없으면 본인 org_id) 소속 사용자 + 전역(org_id NULL) super_admin
    //                   특수값 'all' 을 헤더/쿼리로 보내면 브랜드 무관 전체 사용자 반환.
    //   ※ 브랜드에 소속된 super_admin 은 해당 브랜드에서만 노출(타 브랜드 화면에 더 이상 끼지 않음).
    router.get('/admin/users', async (req, res) => {
        try {
            const isSuper = req.session?.role === 'super_admin';
            const ownOrgId = Number(req.session?.org_id) || null;
            const rawHeader = String(req.headers['x-active-brand-id'] || '').trim();
            const rawQuery = String(req.query?.brand_id || '').trim();
            const raw = rawHeader || rawQuery;
            let scopeOrgId;
            if (isSuper) {
                if (raw.toLowerCase() === 'all') {
                    scopeOrgId = null;
                } else {
                    const parsed = Number(raw);
                    scopeOrgId = Number.isFinite(parsed) ? parsed : ownOrgId;
                }
            } else {
                scopeOrgId = ownOrgId;
            }
            const params = [];
            let where = '';
            if (scopeOrgId != null) {
                params.push(scopeOrgId);
                // 선택한 브랜드 소속만 노출. 단 브랜드 미지정(org_id NULL) super_admin 은 전역 관리자로 간주해 항상 노출.
                where = `WHERE (u.org_id = $${params.length} OR (u.role = 'super_admin' AND u.org_id IS NULL))`;
            }
            if (!isSuper && scopeOrgId == null) {
                // admin 인데 org_id 가 비어있으면 전역(org_id NULL) super_admin 만 노출 (자기 브랜드 정보가 없어 admin 목록 보장 불가).
                where = `WHERE u.role = 'super_admin' AND u.org_id IS NULL`;
            }
            const { rows } = await pool.query(
                `SELECT u.user_id, u.login_id, u.display_name, u.role, u.is_active,
                        u.org_id, o.name AS org_name, u.department,
                        u.email, u.hire_date, u.leave_date, u.extension, u.dup_login_yn,
                        u.profile_image_path, u.must_change_password,
                        u.created_at, u.updated_at,
                        (SELECT MAX(al.created_at) FROM public.qa_audit_logs al
                         WHERE al.user_id = u.user_id
                           AND al.action = 'AUTH_LOGIN_SUCCESS') AS last_login_at,
                        (SELECT COUNT(*) FROM public.qa_audit_logs al
                         WHERE al.user_id = u.user_id
                           AND al.action = 'AUTH_LOGIN_SUCCESS')::int AS login_count
                 FROM public.admin_users u
                 LEFT JOIN public.organizations o ON o.id = u.org_id
                 ${where}
                 ORDER BY u.user_id ASC`,
                params
            );
            // 프로필 이미지 URL 을 응답에 함께 노출 (UI 가 직접 접근하기 위한 가공).
            res.json(rows.map((r) => ({
                ...r,
                profile_image_url: r.profile_image_path ? `/uploads/${r.profile_image_path}` : null,
            })));
        } catch (err) {
            console.error('GET /api/admin/users error:', err);
            res.status(500).json({ message: 'Failed to list users.' });
        }
    });

    // POST /api/admin/users
    // 관리자(super_admin)는 신규 사용자의 로그인ID/이름/역할/소속만 지정. 비밀번호는 관리자가 정할 수 없으며
    // 서버가 초기 비밀번호(INITIAL_USER_PASSWORD env, 기본 폴백 '1234')를 자동 부여한다.
    // 사용자는 첫 로그인 시 must_change_password=true 로 비밀번호 변경 강제.
    router.post('/admin/users', requireSuperAdmin, async (req, res) => {
        const loginId = String(req.body?.login_id || '').trim();
        const displayName = String(req.body?.display_name || '').trim();
        const role = String(req.body?.role || 'admin').trim();
        const orgId = req.body?.org_id == null || req.body?.org_id === '' ? null : Number(req.body.org_id);
        const department = req.body?.department == null ? null : String(req.body.department).trim() || null;
        if (!loginId || !displayName) {
            res.status(400).json({ message: 'login_id / display_name 모두 필수' });
            return;
        }
        if (!['admin', 'super_admin'].includes(role)) {
            res.status(400).json({ message: '허용된 role: admin | super_admin' });
            return;
        }
        const initialPassword = resolveInitialPassword();
        try {
            const { rows } = await pool.query(
                `INSERT INTO public.admin_users (login_id, password_hash, display_name, role, org_id, department, must_change_password)
                 VALUES ($1, $2, $3, $4, $5, $6, true)
                 RETURNING user_id, login_id, display_name, role, is_active, org_id, department, created_at, updated_at, must_change_password`,
                [loginId, sha256Hex(initialPassword), displayName, role, orgId, department]
            );
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_CREATE,
                resource_type: 'admin_user',
                resource_id: String(rows[0]?.user_id ?? ''),
                http_method: 'POST',
                http_path: '/api/admin/users',
                detail_json: JSON.stringify({ login_id: loginId, display_name: displayName, role, org_id: orgId, department, initial_password_issued: true }),
                success: true,
            });
            // 응답에 초기 비밀번호를 노출하면 super_admin 이 발급 직후 안전하게 안내 가능.
            res.json({ ...rows[0], initial_password: initialPassword });
        } catch (err) {
            if (err.code === '23505') {
                res.status(409).json({ message: '이미 사용 중인 login_id 입니다' });
                return;
            }
            console.error('POST /api/admin/users error:', err);
            res.status(500).json({ message: 'Failed to create user.' });
        }
    });

    router.patch('/admin/users/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        // 자가 락아웃 방지 — 본인의 role / is_active 는 이 엔드포인트로 변경 불가.
        // 클라이언트 UI 가 이미 본인을 일괄 수정에서 제외하지만, API 직접 호출/일괄 우회 등을 막기 위해 서버에서도 강제.
        const actorId = Number(req.session?.user_id);
        if (Number.isFinite(actorId) && actorId === id) {
            if ('role' in (req.body || {}) || 'is_active' in (req.body || {})) {
                res.status(400).json({ message: '본인의 역할/상태는 변경할 수 없습니다' });
                return;
            }
        }
        const fields = [];
        const values = [];
        let idx = 1;
        if (typeof req.body?.display_name === 'string') {
            fields.push(`display_name = $${idx++}`);
            values.push(String(req.body.display_name).trim());
        }
        if (typeof req.body?.role === 'string') {
            if (!['admin', 'super_admin', 'agent'].includes(req.body.role)) {
                res.status(400).json({ message: '허용된 role: admin | super_admin | agent' });
                return;
            }
            fields.push(`role = $${idx++}`);
            values.push(req.body.role);
        }
        if (typeof req.body?.is_active === 'boolean' || typeof req.body?.is_active === 'number') {
            fields.push(`is_active = $${idx++}`);
            values.push(req.body.is_active ? 1 : 0);
        }
        if ('org_id' in (req.body || {})) {
            fields.push(`org_id = $${idx++}`);
            values.push(req.body.org_id == null || req.body.org_id === '' ? null : Number(req.body.org_id));
        }
        if ('department' in (req.body || {})) {
            fields.push(`department = $${idx++}`);
            const raw = req.body.department;
            values.push(raw == null ? null : String(raw).trim() || null);
        }
        // 인사 필드 — 입사일/퇴사일(YYYY-MM-DD, 빈값 허용→NULL), 내선번호(빈값→NULL), 중복로그인(Y/N).
        if ('hire_date' in (req.body || {})) {
            fields.push(`hire_date = $${idx++}`);
            const raw = req.body.hire_date;
            values.push(raw == null ? null : String(raw).trim() || null);
        }
        if ('leave_date' in (req.body || {})) {
            fields.push(`leave_date = $${idx++}`);
            const raw = req.body.leave_date;
            values.push(raw == null ? null : String(raw).trim() || null);
        }
        if ('extension' in (req.body || {})) {
            fields.push(`extension = $${idx++}`);
            const raw = req.body.extension;
            values.push(raw == null ? null : String(raw).trim() || null);
        }
        if ('dup_login_yn' in (req.body || {})) {
            fields.push(`dup_login_yn = $${idx++}`);
            values.push(String(req.body.dup_login_yn).trim().toUpperCase() === 'Y' ? 'Y' : 'N');
        }
        // 비밀번호는 관리자가 임의로 지정할 수 없음 — POST /api/admin/users/:id/reset-password 로만 초기화 가능.
        if (fields.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        fields.push(`updated_at = now()`);
        values.push(id);
        try {
            // UPDATE 후 organizations 와 LEFT JOIN 해서 org_name 까지 함께 반환 — 클라가 화면 상태 정확히 갱신할 수 있게.
            const { rows } = await pool.query(
                `WITH upd AS (
                     UPDATE public.admin_users SET ${fields.join(', ')} WHERE user_id = $${idx}
                     RETURNING user_id, login_id, display_name, role, is_active, org_id, department,
                               email, hire_date, leave_date, extension, dup_login_yn, updated_at
                 )
                 SELECT upd.*, o.name AS org_name
                 FROM upd
                 LEFT JOIN public.organizations o ON o.id = upd.org_id`,
                values
            );
            if (rows.length === 0) {
                res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
                return;
            }
            const detail = { changed: Object.keys(req.body || {}) };
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_UPDATE,
                resource_type: 'admin_user',
                resource_id: String(id),
                http_method: 'PATCH',
                http_path: `/api/admin/users/${id}`,
                detail_json: JSON.stringify(detail),
                success: true,
            });
            res.json(rows[0]);
        } catch (err) {
            console.error('PATCH /api/admin/users/:id error:', err);
            res.status(500).json({ message: 'Failed to update user.' });
        }
    });

    // POST /api/admin/users/:id/reset-password
    // 관리자가 사용자 비밀번호를 임의 값으로 정하지 못하게 함 — 초기 비밀번호로 강제 재설정 + must_change_password=true.
    // 비번 분실 사용자에게 super_admin 이 안내해 줄 수 있도록 응답에 초기 비밀번호 포함.
    router.post('/admin/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const initialPassword = resolveInitialPassword();
        try {
            const { rows } = await pool.query(
                `UPDATE public.admin_users
                    SET password_hash = $1, must_change_password = true, updated_at = now()
                 WHERE user_id = $2
                 RETURNING user_id, login_id, display_name`,
                [sha256Hex(initialPassword), id]
            );
            if (rows.length === 0) {
                res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_PASSWORD_CHANGE,
                resource_type: 'admin_user',
                resource_id: String(id),
                http_method: 'POST',
                http_path: `/api/admin/users/${id}/reset-password`,
                detail_json: JSON.stringify({ reset_by_admin: true, must_change_password: true }),
                success: true,
            });
            res.json({ ok: true, initial_password: initialPassword, user: rows[0] });
        } catch (err) {
            console.error('POST /api/admin/users/:id/reset-password error:', err);
            res.status(500).json({ message: 'Failed to reset password.' });
        }
    });

    router.delete('/admin/users/:id', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        if (req.session?.user_id === id) {
            res.status(400).json({ message: '본인 계정은 삭제할 수 없습니다' });
            return;
        }
        try {
            const { rowCount } = await pool.query('DELETE FROM public.admin_users WHERE user_id = $1', [id]);
            if (rowCount === 0) {
                res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_DELETE,
                resource_type: 'admin_user',
                resource_id: String(id),
                http_method: 'DELETE',
                http_path: `/api/admin/users/${id}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/admin/users/:id error:', err);
            res.status(500).json({ message: 'Failed to delete user.' });
        }
    });

    // ── 감사 로그 ───────────────────────────────────────────

    // GET /api/admin/audit-logs?limit=100&before=<audit_id>&action=<filter>
    // 실시간 로그 탭은 최근 AUDIT_VIEW_WINDOW_DAYS 일 이내만 조회 가능 (서버 측 강제).
    // DB 자체 보관은 3일이지만(pruneOldAuditLogs), 화면에는 1일치만 노출하여 노출 범위 축소.
    router.get('/admin/audit-logs', requireSuperAdmin, async (req, res) => {
        const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
        const before = Number(req.query?.before);
        const actionFilter = String(req.query?.action || '').trim();
        const params = [];
        const conds = [`created_at >= now() - $1::interval`];
        params.push(`${AUDIT_VIEW_WINDOW_DAYS} days`);
        if (Number.isFinite(before)) {
            params.push(before);
            conds.push(`audit_id < $${params.length}`);
        }
        if (actionFilter) {
            params.push(actionFilter);
            conds.push(`action = $${params.length}`);
        }
        params.push(limit);
        const where = `WHERE ${conds.join(' AND ')}`;
        try {
            const { rows } = await pool.query(
                `SELECT audit_id, created_at, user_id, login_id, display_name,
                        role, action, resource_type, resource_id,
                        http_method, http_path, client_ip, success, error_message
                 FROM public.qa_audit_logs
                 ${where}
                 ORDER BY audit_id DESC
                 LIMIT $${params.length}`,
                params
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/audit-logs error:', err);
            res.status(500).json({ message: 'Failed to list audit logs.' });
        }
    });

    // ── 알림 ─────────────────────────────────────────────────
    // 본인(user_id = req.session.user_id) 이 수행한 평가/적재 완료 이벤트만 노출.
    // 데이터는 qa_audit_logs 파생 — 별도 notifications 테이블 없음.
    // admin / super_admin 모두 접근 가능 (실시간 로그와 달리 권한 분리).
    const NOTIFICATION_ACTIONS = [
        AUDIT_ACTION.QA_MANUAL_EVAL_SAVE,
        AUDIT_ACTION.SAMPLE_INGEST,
        AUDIT_ACTION.INGEST_AI_CANVAS,
        AUDIT_ACTION.INGEST_COLLECTION_CALL,
    ];

    router.get('/admin/notifications', async (req, res) => {
        const role = req.session?.role;
        if (role !== 'admin' && role !== 'super_admin') {
            res.status(403).json({ message: 'admin 권한이 필요합니다' });
            return;
        }
        const actorId = Number(req.session?.user_id);
        if (!Number.isFinite(actorId)) {
            res.json([]);
            return;
        }
        const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
        try {
            const { rows } = await pool.query(
                `SELECT audit_id, created_at, action, resource_type, resource_id,
                        success, error_message
                 FROM public.qa_audit_logs
                 WHERE user_id = $1
                   AND created_at >= now() - $2::interval
                   AND action = ANY($3::text[])
                 ORDER BY audit_id DESC
                 LIMIT $4`,
                [actorId, `${AUDIT_VIEW_WINDOW_DAYS} days`, NOTIFICATION_ACTIONS, limit]
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/notifications error:', err);
            res.status(500).json({ message: 'Failed to list notifications.' });
        }
    });

    // ── Application 로그(파일 기반) ─────────────────────────
    // 원본: 01-AI-Tutor-dev/backend/admin/logs_routes.py 의 /admin/logs/{recent,stream}
    // qa_audit_logs(구조화 사용자 활동) 와는 별개 — 운영/디버깅용 winston 파일 로그.

    // loguru 동일 포맷 파싱: "YYYY-MM-DD HH:mm:ss.SSS | LEVEL | module - message"
    const APP_LOG_LINE_RE =
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s\|\s([A-Z]+)\s*\|\s(\S+)\s-\s(.*)$/;

    function parseAppLogLine(raw) {
        const line = String(raw).replace(/\n$/, '');
        if (!line) return null;
        const m = APP_LOG_LINE_RE.exec(line);
        if (m) {
            return { ts: m[1], level: m[2], module: m[3], message: m[4] };
        }
        return { ts: '', level: '', module: '', message: line };
    }

    router.get('/admin/logs/recent', requireSuperAdmin, (req, res) => {
        const limit = Math.min(Math.max(Number(req.query?.limit) || 500, 1), 5000);
        const filePath = todayLogPath();
        let lines = [];
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                lines = raw.split('\n').filter((l) => l.length > 0);
                if (lines.length > limit) lines = lines.slice(-limit);
            }
        } catch (err) {
            console.error('GET /api/admin/logs/recent error:', err);
        }
        res.json({
            file: filePath.split('/').pop(),
            exists: fs.existsSync(filePath),
            lines: lines.map(parseAppLogLine).filter(Boolean),
        });
    });

    // SSE 라이브 tail — 오늘 파일을 0.5s 마다 polling, 자정 회전 시 새 파일로 자동 전환.
    router.get('/admin/logs/stream', requireSuperAdmin, (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();

        let currentPath = todayLogPath();
        let fd = null;
        let offset = 0;
        let buffer = '';
        let closed = false;
        let pingCounter = 0;

        const openIfPossible = () => {
            try {
                if (fs.existsSync(currentPath)) {
                    fd = fs.openSync(currentPath, 'r');
                    const stat = fs.fstatSync(fd);
                    offset = stat.size;
                }
            } catch (err) {
                fd = null;
            }
        };
        openIfPossible();

        const tick = () => {
            if (closed) return;
            const newToday = todayLogPath();
            if (newToday !== currentPath) {
                if (fd !== null) {
                    try { fs.closeSync(fd); } catch { /* ignore */ }
                    fd = null;
                }
                currentPath = newToday;
                buffer = '';
                offset = 0;
                openIfPossible();
            }
            if (fd === null && fs.existsSync(currentPath)) openIfPossible();

            let sent = false;
            if (fd !== null) {
                try {
                    const stat = fs.fstatSync(fd);
                    if (stat.size > offset) {
                        const buf = Buffer.alloc(stat.size - offset);
                        fs.readSync(fd, buf, 0, buf.length, offset);
                        offset = stat.size;
                        buffer += buf.toString('utf8');
                        let nlIdx;
                        while ((nlIdx = buffer.indexOf('\n')) >= 0) {
                            const line = buffer.slice(0, nlIdx);
                            buffer = buffer.slice(nlIdx + 1);
                            if (!line) continue;
                            const parsed = parseAppLogLine(line);
                            if (!parsed) continue;
                            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                            sent = true;
                        }
                    } else if (stat.size < offset) {
                        offset = 0;
                        buffer = '';
                    }
                } catch (err) {
                    if (fd !== null) {
                        try { fs.closeSync(fd); } catch { /* ignore */ }
                        fd = null;
                    }
                }
            }
            pingCounter += 1;
            if (!sent && pingCounter >= 60) {
                res.write(': ping\n\n');
                pingCounter = 0;
            }
        };

        const interval = setInterval(tick, 500);
        req.on('close', () => {
            closed = true;
            clearInterval(interval);
            if (fd !== null) {
                try { fs.closeSync(fd); } catch { /* ignore */ }
                fd = null;
            }
        });
    });

    return router;
}

async function brandStatCounts(pool, ids) {
    const members = new Map();
    const sessions = new Map();
    if (!ids || ids.length === 0) return { members, sessions };
    // 브랜드별 소속 admin 카운트 (super_admin 제외 — super_admin 은 별도 합산해서 모든 브랜드에 더함).
    const { rows: memberRows } = await pool.query(
        `SELECT org_id, COUNT(*)::int AS cnt
         FROM public.admin_users
         WHERE org_id = ANY($1::int[]) AND role <> 'super_admin'
         GROUP BY org_id`,
        [ids]
    );
    for (const r of memberRows) members.set(r.org_id, r.cnt);
    const { rows: superRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM public.admin_users WHERE role = 'super_admin'`
    );
    const superCnt = Number(superRows?.[0]?.cnt) || 0;
    for (const id of ids) members.set(id, (members.get(id) || 0) + superCnt);
    const { rows: callRows } = await pool.query(
        `SELECT org_id, COUNT(*)::int AS cnt
         FROM public.qa_calls
         WHERE org_id = ANY($1::int[]) AND is_sandbox = false
         GROUP BY org_id`,
        [ids]
    );
    for (const r of callRows) sessions.set(r.org_id, r.cnt);
    return { members, sessions };
}
