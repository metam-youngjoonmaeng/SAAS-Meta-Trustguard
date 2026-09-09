// 브랜드(=Organization) / 도메인(Domain) / 사용자(admin_users) / 감사 로그 라우터.
// 원본: 01-AI-Tutor-dev/backend/admin/routes.py 의 /admin/{domains,brands,organizations,trainees,login-history}
// 권한:
//   - GET  /api/admin/organizations  : admin / super_admin (사이드바 셀렉터용 활성 브랜드 목록)
//   - GET  /api/admin/domains        : admin / super_admin (브랜드 등록 폼에서 선택지)
//   - GET  /api/admin/users          : admin / super_admin (admin 은 본인 브랜드만)
//   - POST/PATCH/DELETE /admin/users 및 /brands 관리 목록 : super_admin 전용
//   - GET  /api/admin/audit-logs     : super_admin 전용 (실시간 로그)
//   - GET  /api/admin/notifications  : admin / super_admin (본인이 수행한 평가·적재 이벤트만)

import fs from 'fs';
import express from 'express';
import { AUDIT_ACTION, AUDIT_VIEW_WINDOW_DAYS, insertQaAuditLog } from './auditLog.mjs';
import { logger, todayLogPath } from './logger.mjs';
import {
    seedMinimalEvalItems,
    seedEvalItemsFromDomain,
    seedKsqiItemDefs,
    seedPentagonAxesFromDomain,
} from './defaultEvalItems.mjs';
import { sha256Hex } from './util/common.mjs';


// 브랜드별 KSQI 토글의 집 = trustguard.tenant_settings.ksqi_stt_enabled.
// 통합DB에서 이 값은 공유 common.tenants 가 아니라 QA 전용표에 격리한다(tenant_rag_config 와 같은 원칙 —
// common 은 튜터·TA 도 쓰는 표라 QA 전용 플래그를 넣지 않는다). TA 의 meta_summary_ta.tenant_settings 와 같은 자리.
// 표 존재 여부는 1회 캐시. 부재 시 쿼리가 참조하면 SQL 에러로 브랜드 API 전체가 500 → 앱 마비이므로,
// 유무에 따라 쿼리 조각을 분기(부재 시 ksqi_stt_enabled=false 상수)해 무회귀를 보장한다.
let _qaSettingsTableCache = null;
async function hasQaSettingsTable(pool) {
    if (_qaSettingsTableCache !== null) return _qaSettingsTableCache;
    try {
        const { rows } = await pool.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'trustguard' AND table_name = 'tenant_settings'
               AND column_name = 'ksqi_stt_enabled' LIMIT 1`
        );
        _qaSettingsTableCache = rows.length > 0;
    } catch {
        _qaSettingsTableCache = false;
    }
    return _qaSettingsTableCache;
}

// ★ 2026-09-02 — tenant_settings 표가 없는 DB(로컬·54.235 통합스키마)의 저장 자리 = trustguard.qa_batch_configs.config.ksqi_stt_enabled.
//   증상: 시스템 설정 KSQI 토글 → PATCH 가 400 "수정 항목이 없습니다"(토글 패치가 표 부재로 통째 무시됨) → 프론트
//   "KSQI 토글 저장에 실패했습니다" alert. ECS Aurora 에는 표가 있어 그쪽만 동작했다.
//   전용 표를 만들지 않는다(DDL 금지 원칙 — KMS 지정(config.kms)과 같은 판단, index.js `/api/admin/kms-items` 참조).
//   표가 있으면 종전대로 tenant_settings 를 쓴다(ECS 무회귀) — 읽기/쓰기 모두 같은 분기.
const KSQI_FALLBACK_KEY = 'ksqi_stt_enabled';

// 브랜드 목록 쿼리에 끼울 KSQI 조각(SELECT + JOIN). 표 부재 시 qa_batch_configs.config 폴백을 JOIN 한다.
async function ksqiSqlParts(pool) {
    if (!(await hasQaSettingsTable(pool))) {
        return {
            sel: `COALESCE((bc.config ->> '${KSQI_FALLBACK_KEY}')::boolean, false) AS ksqi_stt_enabled`,
            join: 'LEFT JOIN trustguard.qa_batch_configs bc ON bc.tenant_id = o.tenant_id',
        };
    }
    return {
        sel: 'COALESCE(qs.ksqi_stt_enabled, false) AS ksqi_stt_enabled',
        join: 'LEFT JOIN trustguard.tenant_settings qs ON qs.tenant_id = o.tenant_id',
    };
}

/** 토글 저장 — 표가 있으면 tenant_settings UPSERT, 없으면 qa_batch_configs.config 병합 UPSERT(다른 키 보존). */
async function writeKsqiToggle(client, hasQaSet, tenantId, enabled, updatedBy) {
    if (hasQaSet) {
        await client.query(
            `INSERT INTO trustguard.tenant_settings (tenant_id, ksqi_stt_enabled, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (tenant_id) DO UPDATE
                SET ksqi_stt_enabled = EXCLUDED.ksqi_stt_enabled, updated_at = now()`,
            [tenantId, enabled]
        );
        return;
    }
    await client.query(
        `INSERT INTO trustguard.qa_batch_configs (tenant_id, config, updated_at, updated_by)
         VALUES ($1, jsonb_build_object('${KSQI_FALLBACK_KEY}', $2::boolean), now(), $3)
         ON CONFLICT (tenant_id) DO UPDATE
            SET config = COALESCE(trustguard.qa_batch_configs.config, '{}'::jsonb)
                         || jsonb_build_object('${KSQI_FALLBACK_KEY}', $2::boolean),
                updated_at = now(), updated_by = $3`,
        [tenantId, enabled, updatedBy ?? null]
    );
}

/** 토글 읽기 — writeKsqiToggle 과 같은 분기. 행 없으면 false. */
async function readKsqiToggle(client, hasQaSet, tenantId) {
    const { rows } = hasQaSet
        ? await client.query('SELECT ksqi_stt_enabled AS v FROM trustguard.tenant_settings WHERE tenant_id = $1', [tenantId])
        : await client.query(
              `SELECT (config ->> '${KSQI_FALLBACK_KEY}')::boolean AS v FROM trustguard.qa_batch_configs WHERE tenant_id = $1`,
              [tenantId]
          );
    return rows[0]?.v === true;
}

// 신규 사용자에게 자동 부여되는 초기 비밀번호. 반드시 INITIAL_USER_PASSWORD env 로 설정한다.
// (하드코딩 폴백 제거 — 미설정 시 약한 기본값을 조용히 쓰지 않고 에러로 막는다.)
function resolveInitialPassword() {
    const fromEnv = String(process.env.INITIAL_USER_PASSWORD || '').trim();
    if (!fromEnv) {
        throw new Error('INITIAL_USER_PASSWORD 미설정 — 신규 사용자 초기 비밀번호를 .env(INITIAL_USER_PASSWORD)에 강력한 값으로 설정하세요.');
    }
    return fromEnv;
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
    const { rows } = await pool.query('SELECT name FROM domains WHERE id = $1', [domainId]);
    return rows[0]?.name ?? null;
}

export function createBrandRouter(pool) {
    const router = express.Router();

    // ── 도메인 ─────────────────────────────────────────────

    router.get('/admin/domains', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, name, key, sort_order
                 FROM domains
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
                `INSERT INTO domains (name, key, sort_order)
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
                `UPDATE domains SET ${fields.join(', ')} WHERE id = $${idx}
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
            await pool.query('DELETE FROM domains WHERE id = $1', [id]);
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
                 FROM domain_default_eval_items
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
                `SELECT order_no FROM domain_default_eval_items WHERE domain_id = $1`,
                [domainId]
            );
            const usedSet = new Set(usedRows.map((r) => Number(r.order_no)));
            let nextOrderNo = 1;
            while (usedSet.has(nextOrderNo)) nextOrderNo++;
            const { rows } = await client.query(
                `INSERT INTO domain_default_eval_items
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
                `UPDATE domain_default_eval_items SET ${fields.join(', ')} WHERE id = $${idx}
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
                'DELETE FROM domain_default_eval_items WHERE id = $1',
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
                 FROM domain_default_pentagon_axes
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
                `SELECT axis_no FROM domain_default_pentagon_axes WHERE domain_id = $1`,
                [domainId]
            );
            const usedSet = new Set(usedRows.map((r) => Number(r.axis_no)));
            let nextAxisNo = 1;
            while (usedSet.has(nextAxisNo)) nextAxisNo++;
            const { rows } = await client.query(
                `INSERT INTO domain_default_pentagon_axes
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
                `UPDATE domain_default_pentagon_axes SET ${fields.join(', ')} WHERE id = $${idx}
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
                'DELETE FROM domain_default_pentagon_axes WHERE id = $1',
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
            const ownTenant = req.session?.tenant_id ?? null;   // 구 org_id(int) → tenant_id(citext)
            const { sel: ksqiSel, join: ksqiJoin } = await ksqiSqlParts(pool);
            const { rows: orgRows } = isSuper
                ? await pool.query(
                      `SELECT o.tenant_id AS id, o.name, o.short, o.color, o.active, o.domain_id, ${ksqiSel},
                              d.name AS domain_name
                       FROM tenants o
                       LEFT JOIN domains d ON d.id = o.domain_id
                       ${ksqiJoin}
                       WHERE o.active = true
                       ORDER BY o.tenant_id ASC`
                  )
                : await pool.query(
                      `SELECT o.tenant_id AS id, o.name, o.short, o.color, o.active, o.domain_id, ${ksqiSel},
                              d.name AS domain_name
                       FROM tenants o
                       LEFT JOIN domains d ON d.id = o.domain_id
                       ${ksqiJoin}
                       WHERE o.active = true AND o.tenant_id = $1
                       ORDER BY o.tenant_id ASC`,
                      [ownTenant]
                  );

            const ids = orgRows.map((r) => r.id);
            const counts = await brandStatCounts(pool, ids);

            res.json(
                orgRows.map((r) => ({
                    id: r.id,   // = tenant_id(citext). 프론트 계약 정리는 Stage 4.
                    name: r.name,
                    short: r.short || r.name.slice(0, 1),
                    color: r.color,
                    domain_id: r.domain_id,
                    domain_name: r.domain_name,
                    ksqi_stt_enabled: r.ksqi_stt_enabled === true,
                    members: counts.members.get(r.id) || 0,
                    sessions: counts.sessions.get(r.id) || 0,
                    is_own: r.id === ownTenant,
                    is_current: r.id === ownTenant,
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
            const { sel: ksqiSel, join: ksqiJoin } = await ksqiSqlParts(pool);
            const { rows: orgRows } = await pool.query(
                `SELECT o.tenant_id AS id, o.name, o.short, o.color, o.active, o.domain_id, o.created_at, ${ksqiSel},
                        d.name AS domain_name
                 FROM tenants o
                 LEFT JOIN domains d ON d.id = o.domain_id
                 ${ksqiJoin}
                 ORDER BY o.tenant_id ASC`
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
                    ksqi_stt_enabled: r.ksqi_stt_enabled === true,
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
        // 통합DB: 브랜드 = common.tenants(PK tenant_id citext=proj_cd). 생성 시 tenant_id 필수 입력.
        const tenantId = String(req.body?.tenant_id || req.body?.proj_cd || '').trim().toLowerCase();
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
        if (!tenantId || !/^[a-z0-9][a-z0-9_-]*$/.test(tenantId)) {
            res.status(400).json({ message: 'tenant_id(브랜드 코드) 필수 — 영소문자/숫자로 시작, [a-z0-9_-]' });
            return;
        }
        const client = await pool.connect();
        let out;
        let seededItemCount = 0;
        let seededAxisCount = 0;
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `INSERT INTO common.tenants (tenant_id, name, short, color, domain_id)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING tenant_id AS id, name, short, color, active, domain_id`,
                [tenantId, name, short, color, domainId]
            );
            out = rows[0];
            // 신규 브랜드 = 선택한 도메인(업종) 기본 평가항목 + 펜타곤 축 복제.
            //   도메인 미지정/디폴트 0건이면 '첫인사' 1항목 폴백. 펜타곤 0건이면 프론트 코드 기본 라벨 폴백.
            seededItemCount = await seedEvalItemsFromDomain(client, out.id, domainId);
            if (seededItemCount === 0) {
                seededItemCount = await seedMinimalEvalItems(client, out.id);
            }
            seededAxisCount = await seedPentagonAxesFromDomain(client, out.id, domainId);
            // 신규 브랜드 = KSQI 표준 항목 세트 복제(63_ksqi_item_defs.sql 시딩분과 동일).
            //   테이블 부재(prod 미적용) 시 조용히 스킵 — 다음 기동의 seeder 재적용이 보충.
            await seedKsqiItemDefs(client, out.id);
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
        const id = String(req.params.id || '').trim().toLowerCase();   // = tenant_id(citext)
        if (!id) {
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
        // KSQI 토글은 common.tenants 가 아니라 QA 전용 저장소(tenant_settings, 부재 시 qa_batch_configs.config)에
        // 있다 → 별도 UPSERT 로 처리. 표 유무로 요청을 버리지 않는다(종전 400 "수정 항목이 없습니다" 의 원인).
        const hasQaSet = await hasQaSettingsTable(pool);
        const ksqiPatch = typeof req.body?.ksqi_stt_enabled === 'boolean' ? Boolean(req.body.ksqi_stt_enabled) : null;
        const hasDomainInBody = 'domain_id' in (req.body || {});
        let newDomainId = null;
        if (hasDomainInBody) {
            newDomainId = req.body.domain_id == null || req.body.domain_id === '' ? null : Number(req.body.domain_id);
            fields.push(`domain_id = $${idx++}`);
            values.push(newDomainId);
        }
        // 토글만 바꾸는 요청(ksqi 단독)도 정상 — common.tenants 수정 항목이 없어도 통과시킨다.
        if (fields.length === 0 && ksqiPatch === null) {
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
            const cur = await client.query('SELECT domain_id FROM common.tenants WHERE tenant_id = $1', [id]);
            if (cur.rows.length === 0) {
                await client.query('ROLLBACK').catch(() => {});
                client.release();
                res.status(404).json({ message: '브랜드를 찾을 수 없습니다' });
                return;
            }
            if (fields.length > 0) {
                const { rows } = await client.query(
                    `UPDATE common.tenants SET ${fields.join(', ')} WHERE tenant_id = $${idx}
                     RETURNING tenant_id AS id, name, short, color, active, domain_id`,
                    values
                );
                out = rows[0];
            } else {
                // ksqi 단독 변경 — 식별 정보는 그대로 읽어 응답 형태를 맞춘다.
                const { rows } = await client.query(
                    `SELECT tenant_id AS id, name, short, color, active, domain_id
                     FROM common.tenants WHERE tenant_id = $1`,
                    [id]
                );
                out = rows[0];
            }
            if (ksqiPatch !== null) {
                await writeKsqiToggle(client, hasQaSet, id, ksqiPatch, req.session?.user_id ?? null);
            }
            // 응답의 토글 값 — 이번에 바꿨으면 그 값, 아니면 저장된 값(행 없으면 false).
            out.ksqi_stt_enabled = await readKsqiToggle(client, hasQaSet, id);
            // 브랜드 수정 시에는 도메인이 바뀌어도 기존 평가항목/펜타곤 축을 보존한다(교체하지 않음).
            // 도메인 기본 평가항목/펜타곤 축 적용은 신규 브랜드 생성(POST /admin/organizations) 시에만 수행.
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
        const id = String(req.params.id || '').trim().toLowerCase();   // = tenant_id(citext)
        if (!id) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        const client = await pool.connect();
        try {
            // 통합DB 브랜드 삭제 = 콜·평가·테넌트 스코프 설정을 한 번에 제거.
            //   common.calls.tenant_id 는 ON DELETE 제약이 없어(RESTRICT) 콜을 먼저 삭제 →
            //   qa_evaluations 및 자식(eval_item_score/pentagon/annotation/recovery/review/golden/
            //   ksqi) + common.call_transcript 가 CASCADE 로 연쇄 제거.
            //   테넌트 스코프 trustguard 표(FK 가 ON UPDATE만, ON DELETE RESTRICT)는 명시 삭제.
            //   마지막으로 common.tenants 삭제 → memberships(ON DELETE CASCADE) 자동 정리.
            await client.query('BEGIN');
            const { rows: refRows } = await client.query(
                'SELECT COUNT(*)::int AS cnt FROM common.calls WHERE tenant_id = $1',
                [id]
            );
            const callCount = refRows[0]?.cnt ?? 0;
            if (callCount > 0) {
                await client.query('DELETE FROM common.calls WHERE tenant_id = $1', [id]);
            }
            for (const tbl of [
                'trustguard.eval_item_defs', 'trustguard.pentagon_axes', 'trustguard.coaching_assignments',
                'trustguard.notifications', 'trustguard.rubric_change_log', 'trustguard.qa_confidence_prompt',
                'trustguard.qa_batch_configs', 'trustguard.qa_skill_store', 'trustguard.ics_qa_poll_watermark',
                'trustguard.ksqi_item_defs',
            ]) {
                await client.query(`DELETE FROM ${tbl} WHERE tenant_id = $1`, [id]).catch((e) => {
                    // ksqi_item_defs 등 미적용 테이블 부재 시 무해 스킵.
                    if (e?.code !== '42P01') throw e;
                });
            }
            await client.query('DELETE FROM common.tenants WHERE tenant_id = $1', [id]);
            await client.query('COMMIT');
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.BRAND_DELETE,
                resource_type: 'brand',
                resource_id: String(id),
                http_method: 'DELETE',
                http_path: `/api/admin/brands/${id}`,
                success: true,
                detail_json: JSON.stringify({ deleted_calls: callCount }),
            });
            res.json({ ok: true, deleted_calls: callCount });
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {
                /* 롤백 실패는 무시 — 원 에러를 그대로 노출 */
            }
            console.error('DELETE /api/admin/brands/:id error:', err);
            res.status(500).json({ message: 'Failed to delete brand.' });
        } finally {
            client.release();
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
            const ownTenant = req.session?.tenant_id ?? null;   // 구 org_id(int) → tenant_id(citext)
            const rawHeader = String(req.headers['x-active-brand-id'] || '').trim();
            const rawQuery = String(req.query?.brand_id || '').trim();
            const raw = rawHeader || rawQuery;
            let scopeTenant;   // null = 전체
            if (isSuper) {
                scopeTenant = raw.toLowerCase() === 'all' ? null : (raw ? raw.toLowerCase() : ownTenant);
            } else {
                scopeTenant = ownTenant;
            }
            // 통합DB: admin_users 뷰 폐지 → common.users ⋈ common.memberships ⋈ tenants.
            //   login_id = COALESCE(username, email에서 .ics 제거). is_active = 멤버십 status='active'.
            //   memberships.tenant_id NOT NULL 이라 구 '전역 super_admin(org_id NULL)' 개념은 없음(테넌트 스코프).
            const params = [];
            let where = '';
            if (scopeTenant != null) {
                params.push(scopeTenant);
                where = `WHERE m.tenant_id = $${params.length}`;
            }
            const { rows } = await pool.query(
                `SELECT u.id AS user_id,
                        COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                        u.name AS display_name, m.role::text AS role,
                        (m.status = 'active') AS is_active,
                        m.tenant_id, o.name AS org_name, m.department,
                        u.email, m.hire_date, m.leave_date, m.extension, m.dup_login_yn,
                        u.created_at, u.created_at AS updated_at,
                        (SELECT MAX(al.created_at) FROM qa_audit_logs al
                         WHERE al.user_id = u.id AND al.action = 'AUTH_LOGIN_SUCCESS') AS last_login_at,
                        (SELECT COUNT(*) FROM qa_audit_logs al
                         WHERE al.user_id = u.id AND al.action = 'AUTH_LOGIN_SUCCESS')::int AS login_count
                 FROM common.users u
                 JOIN common.memberships m ON m.user_id = u.id
                 LEFT JOIN common.tenants o ON o.tenant_id = m.tenant_id
                 ${where}
                 ORDER BY u.id ASC`,
                params
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/users error:', err);
            res.status(500).json({ message: 'Failed to list users.' });
        }
    });

    // POST /api/admin/users
    // 관리자(super_admin)는 신규 사용자의 로그인ID/이름/역할/소속만 지정. 비밀번호는 관리자가 정할 수 없으며
    // 서버가 초기 비밀번호(INITIAL_USER_PASSWORD env, 필수)를 자동 부여한다.
    router.post('/admin/users', requireSuperAdmin, async (req, res) => {
        const loginId = String(req.body?.login_id || '').trim();
        const displayName = String(req.body?.display_name || '').trim();
        const role = String(req.body?.role || 'admin').trim();
        // 통합DB: 소속 = tenant_id(citext). body.tenant_id 우선, 구 org_id 는 문자열로 폴백.
        const tenantId = String(req.body?.tenant_id ?? req.body?.org_id ?? '').trim().toLowerCase() || null;
        const department = req.body?.department == null ? null : String(req.body.department).trim() || null;
        if (!loginId || !displayName) {
            res.status(400).json({ message: 'login_id / display_name 모두 필수' });
            return;
        }
        if (!['admin', 'super_admin'].includes(role)) {
            res.status(400).json({ message: '허용된 role: admin | super_admin' });
            return;
        }
        if (!tenantId) {
            res.status(400).json({ message: 'tenant_id(소속 브랜드) 필수' });
            return;
        }
        // 로컬(비-SSO) 계정 신원: username = login_id, 합성 이메일 = login_id@metahub.local.
        const email = `${loginId.toLowerCase()}@metahub.local`;
        const emailHash = sha256Hex(email);
        const client = await pool.connect();
        try {
            const initialPassword = resolveInitialPassword();
            await client.query('BEGIN');
            const { rows: urows } = await client.query(
                `INSERT INTO common.users (email, email_hash, name, username, password_hash)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [email, emailHash, displayName, loginId, sha256Hex(initialPassword)]
            );
            const userId = urows[0].id;
            await client.query(
                `INSERT INTO common.memberships (user_id, tenant_id, role, department, status)
                 VALUES ($1, $2, $3::common.userrole, $4, 'active')`,
                [userId, tenantId, role, department]
            );
            await client.query('COMMIT');
            const out = {
                user_id: userId, login_id: loginId, display_name: displayName, role,
                is_active: true, tenant_id: tenantId, department, created_at: new Date().toISOString(),
            };
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_CREATE,
                resource_type: 'admin_user',
                resource_id: String(userId),
                http_method: 'POST',
                http_path: '/api/admin/users',
                detail_json: JSON.stringify({ login_id: loginId, display_name: displayName, role, tenant_id: tenantId, department, initial_password_issued: true }),
                success: true,
            });
            res.json({ ...out, initial_password: initialPassword });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            if (err.code === '23505') {
                res.status(409).json({ message: '이미 사용 중인 login_id 입니다' });
                return;
            }
            console.error('POST /api/admin/users error:', err);
            res.status(500).json({ message: 'Failed to create user.' });
        } finally {
            client.release();
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
        // 통합DB: users(공통 신원=name) vs memberships(소속·권한) 로 필드 분리 갱신.
        const b = req.body || {};
        const userSet = [], userVals = [];
        const membSet = [], membVals = [];
        if (typeof b.display_name === 'string') { userSet.push(`name = $${userVals.length + 1}`); userVals.push(String(b.display_name).trim()); }
        if (typeof b.role === 'string') {
            if (!['admin', 'super_admin', 'agent'].includes(b.role)) {
                res.status(400).json({ message: '허용된 role: admin | super_admin | agent' });
                return;
            }
            membSet.push(`role = $${membVals.length + 1}::common.userrole`); membVals.push(b.role);
        }
        if (typeof b.is_active === 'boolean' || typeof b.is_active === 'number') {
            membSet.push(`status = $${membVals.length + 1}`); membVals.push(b.is_active ? 'active' : 'suspended');
        }
        if ('tenant_id' in b || 'org_id' in b) {
            const t = String(b.tenant_id ?? b.org_id ?? '').trim().toLowerCase() || null;
            membSet.push(`tenant_id = $${membVals.length + 1}`); membVals.push(t);
        }
        if ('department' in b) { membSet.push(`department = $${membVals.length + 1}`); membVals.push(b.department == null ? null : String(b.department).trim() || null); }
        if ('hire_date' in b) { membSet.push(`hire_date = $${membVals.length + 1}`); membVals.push(b.hire_date == null ? null : String(b.hire_date).trim() || null); }
        if ('leave_date' in b) { membSet.push(`leave_date = $${membVals.length + 1}`); membVals.push(b.leave_date == null ? null : String(b.leave_date).trim() || null); }
        if ('extension' in b) { membSet.push(`extension = $${membVals.length + 1}`); membVals.push(b.extension == null ? null : String(b.extension).trim() || null); }
        if ('dup_login_yn' in b) { membSet.push(`dup_login_yn = $${membVals.length + 1}`); membVals.push(String(b.dup_login_yn).trim().toUpperCase() === 'Y' ? 'Y' : 'N'); }
        if (userSet.length === 0 && membSet.length === 0) {
            res.status(400).json({ message: '수정 항목이 없습니다' });
            return;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const chk = await client.query('SELECT 1 FROM common.users WHERE id = $1', [id]);
            if (chk.rows.length === 0) {
                await client.query('ROLLBACK'); client.release();
                res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
                return;
            }
            if (userSet.length) {
                userVals.push(id);
                await client.query(`UPDATE common.users SET ${userSet.join(', ')} WHERE id = $${userVals.length}`, userVals);
            }
            if (membSet.length) {
                // 다중 소속 시 활성/기본 멤버십 1건만 갱신(구 admin_users 뷰 우선순위와 정합).
                membVals.push(id);
                await client.query(
                    `UPDATE common.memberships SET ${membSet.join(', ')}
                      WHERE id = (SELECT m.id FROM common.memberships m
                                   WHERE m.user_id = $${membVals.length}
                                   ORDER BY (m.id = (SELECT last_active_membership_id FROM common.users WHERE id = $${membVals.length})) DESC NULLS LAST,
                                            (m.status = 'active') DESC, m.id ASC LIMIT 1)`,
                    membVals
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
            console.error('PATCH /api/admin/users/:id error:', err);
            res.status(500).json({ message: 'Failed to update user.' });
            return;
        }
        client.release();
        // 응답 = 갱신 후 admin_users-호환 행 재조회(활성/기본 멤버십 기준).
        const { rows } = await pool.query(
            `SELECT u.id AS user_id, COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                    u.name AS display_name, m.role::text AS role, (m.status = 'active') AS is_active,
                    m.tenant_id, o.name AS org_name, m.department, u.email,
                    m.hire_date, m.leave_date, m.extension, m.dup_login_yn, u.created_at, u.created_at AS updated_at
               FROM common.users u
               LEFT JOIN LATERAL (
                   SELECT mm.* FROM common.memberships mm WHERE mm.user_id = u.id
                    ORDER BY (mm.id = u.last_active_membership_id) DESC NULLS LAST, (mm.status = 'active') DESC, mm.id ASC LIMIT 1
               ) m ON true
               LEFT JOIN common.tenants o ON o.tenant_id = m.tenant_id
              WHERE u.id = $1`,
            [id]
        );
        await insertQaAuditLog(pool, {
            req,
            action: AUDIT_ACTION.USER_UPDATE,
            resource_type: 'admin_user',
            resource_id: String(id),
            http_method: 'PATCH',
            http_path: `/api/admin/users/${id}`,
            detail_json: JSON.stringify({ changed: Object.keys(req.body || {}) }),
            success: true,
        });
        res.json(rows[0]);
    });

    // POST /api/admin/users/:id/reset-password
    // 관리자가 사용자 비밀번호를 임의 값으로 정하지 못하게 함 — 초기 비밀번호로 재설정.
    // 비번 분실 사용자에게 super_admin 이 안내해 줄 수 있도록 응답에 초기 비밀번호 포함.
    router.post('/admin/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ message: 'invalid id' });
            return;
        }
        try {
            const initialPassword = resolveInitialPassword();
            const { rows } = await pool.query(
                `UPDATE common.users
                    SET password_hash = $1
                 WHERE id = $2
                 RETURNING id AS user_id,
                           COALESCE(username, regexp_replace(email, '\\.ics$', '')) AS login_id,
                           name AS display_name`,
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
                detail_json: JSON.stringify({ reset_by_admin: true }),
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
            const { rowCount } = await pool.query('DELETE FROM common.users WHERE id = $1', [id]);
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

    // ── 멤버십(다중 소속) 관리 ─────────────────────────────────
    // 한 유저(users.id)가 여러 조직에 소속 가능(02/03 동일). trainee_registrations 를 직접 다룬다.

    // GET /api/admin/users/:userId/memberships — 해당 유저의 멤버십(조직×역할) 목록.
    router.get('/admin/users/:userId/memberships', requireSuperAdmin, async (req, res) => {
        const userId = Number(req.params.userId);
        if (!Number.isFinite(userId)) { res.status(400).json({ message: 'invalid userId' }); return; }
        try {
            const { rows } = await pool.query(
                `SELECT m.id AS membership_id, m.tenant_id, o.name AS tenant_name, m.role::text AS role,
                        m.department, m.status,
                        (m.id = u.last_active_membership_id) AS is_active_membership
                   FROM common.memberships m
                   LEFT JOIN common.tenants o ON o.tenant_id = m.tenant_id
                   LEFT JOIN common.users u ON u.id = m.user_id
                  WHERE m.user_id = $1
                  ORDER BY (m.status = 'active') DESC, m.id ASC`,
                [userId]
            );
            res.json(rows);
        } catch (err) {
            console.error('GET memberships error:', err);
            res.status(500).json({ message: 'Failed to load memberships.' });
        }
    });

    // POST /api/admin/users/:userId/memberships { org_id, role, department } — 기존 유저를 새 조직에 소속(멤버십 추가).
    router.post('/admin/users/:userId/memberships', requireSuperAdmin, async (req, res) => {
        const userId = Number(req.params.userId);
        const tenantId = String(req.body?.tenant_id ?? req.body?.org_id ?? '').trim().toLowerCase() || null;
        const role = ['agent', 'admin', 'super_admin'].includes(req.body?.role) ? req.body.role : 'agent';
        const department = req.body?.department == null ? null : String(req.body.department).trim() || null;
        if (!Number.isFinite(userId) || !tenantId) {
            res.status(400).json({ message: 'userId / tenant_id 필수' });
            return;
        }
        try {
            const { rows: urows } = await pool.query('SELECT id FROM common.users WHERE id = $1', [userId]);
            if (!urows.length) { res.status(404).json({ message: '사용자를 찾을 수 없습니다' }); return; }
            const { rows: orows } = await pool.query('SELECT 1 FROM common.tenants WHERE tenant_id = $1', [tenantId]);
            if (!orows.length) { res.status(404).json({ message: '조직을 찾을 수 없습니다' }); return; }
            const { rows: dup } = await pool.query(
                'SELECT 1 FROM common.memberships WHERE user_id = $1 AND tenant_id = $2 LIMIT 1',
                [userId, tenantId]
            );
            if (dup.length) { res.status(409).json({ message: '이미 해당 조직에 소속되어 있습니다' }); return; }
            const { rows: ins } = await pool.query(
                `INSERT INTO common.memberships (user_id, tenant_id, department, role, status)
                 VALUES ($1, $2, $3, $4::common.userrole, 'active')
                 RETURNING id AS membership_id, tenant_id, role::text AS role, department, status`,
                [userId, tenantId, department, role]
            );
            await insertQaAuditLog(pool, {
                req,
                action: 'USER_MEMBERSHIP_ADD',
                resource_type: 'membership',
                resource_id: String(ins[0].membership_id),
                http_method: 'POST',
                http_path: `/api/admin/users/${userId}/memberships`,
                detail_json: JSON.stringify({ user_id: userId, tenant_id: tenantId, role }),
                success: true,
            });
            res.status(201).json(ins[0]);
        } catch (err) {
            console.error('POST memberships error:', err);
            res.status(500).json({ message: 'Failed to add membership.' });
        }
    });

    // DELETE /api/admin/users/:userId/memberships/:traineeId — 멤버십 제거(마지막 1개는 불가).
    router.delete('/admin/users/:userId/memberships/:traineeId', requireSuperAdmin, async (req, res) => {
        const userId = Number(req.params.userId);
        const traineeId = Number(req.params.traineeId);
        if (!Number.isFinite(userId) || !Number.isFinite(traineeId)) { res.status(400).json({ message: 'invalid id' }); return; }
        try {
            const { rows: mine } = await pool.query(
                'SELECT id FROM common.memberships WHERE id = $1 AND user_id = $2',
                [traineeId, userId]
            );
            if (!mine.length) { res.status(404).json({ message: '멤버십을 찾을 수 없습니다' }); return; }
            const { rows: cnt } = await pool.query(
                'SELECT count(*)::int AS n FROM common.memberships WHERE user_id = $1',
                [userId]
            );
            if ((cnt[0]?.n || 0) <= 1) { res.status(400).json({ message: '마지막 소속은 제거할 수 없습니다(계정 삭제를 사용하세요)' }); return; }
            await pool.query('DELETE FROM common.memberships WHERE id = $1', [traineeId]);
            // 활성 포인터가 방금 지운 멤버십이면 남은 것 중 하나로 재지정.
            await pool.query(
                `UPDATE common.users u
                    SET last_active_membership_id = (
                        SELECT m.id FROM common.memberships m
                         WHERE m.user_id = u.id
                         ORDER BY (m.status='active') DESC, m.id ASC LIMIT 1
                    )
                  WHERE u.id = $1 AND u.last_active_membership_id IS NULL`,
                [userId]
            );
            await insertQaAuditLog(pool, {
                req,
                action: 'USER_MEMBERSHIP_REMOVE',
                resource_type: 'trainee_registration',
                resource_id: String(traineeId),
                http_method: 'DELETE',
                http_path: `/api/admin/users/${userId}/memberships/${traineeId}`,
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE membership error:', err);
            res.status(500).json({ message: 'Failed to remove membership.' });
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
                 FROM qa_audit_logs
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

    // GET /api/admin/login-history?days=30&limit=200&event=<filter>
    // 로그인 이력(login_history) — 02/03 동등 기능. 영속 테이블(prune 대상 아님)에서 조회.
    // 권한: admin + super_admin (감사로그와 달리 사용자 관리 화면의 탭이므로 admin 도 허용).
    // org 격리: /admin/users 와 동일 규칙(admin=본인 org, super_admin=활성 브랜드/전체).
    router.get('/admin/login-history', async (req, res) => {
        const role = req.session?.role;
        if (role !== 'admin' && role !== 'super_admin') {
            res.status(403).json({ message: 'admin 권한이 필요합니다' });
            return;
        }
        const isSuper = role === 'super_admin';
        const ownTenant = req.session?.tenant_id ?? null;
        const rawHeader = String(req.headers['x-active-brand-id'] || '').trim();
        const rawQuery = String(req.query?.brand_id || '').trim();
        const raw = rawHeader || rawQuery;
        let scopeTenant;
        if (isSuper) {
            scopeTenant = raw.toLowerCase() === 'all' ? null : (raw ? raw.toLowerCase() : ownTenant);
        } else {
            scopeTenant = ownTenant;
        }
        const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
        const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 1000);
        const eventFilter = String(req.query?.event || '').trim();
        // 통합DB: common.login_history(user_id/membership_id/email/name/event/ip_address).
        //   구 login_id/display_name/role/org_id/reason 컬럼 없음 → email/name 로 대체, 역할·사유는 qa_audit_logs.
        //   테넌트 스코프는 membership_id → common.memberships.tenant_id 조인으로.
        const params = [`${days} days`];
        const conds = [`lh.created_at >= now() - $1::interval`];
        if (scopeTenant != null) {
            params.push(scopeTenant);
            conds.push(`lh.membership_id IN (SELECT id FROM common.memberships WHERE tenant_id = $${params.length})`);
        }
        if (eventFilter) {
            params.push(eventFilter);
            conds.push(`lh.event = $${params.length}::common.logineventtype`);
        }
        params.push(limit);
        try {
            const { rows } = await pool.query(
                `SELECT lh.id, lh.created_at, lh.user_id, lh.membership_id,
                        lh.email AS login_id, lh.name AS display_name,
                        lh.event::text AS event, lh.ip_address AS client_ip, lh.user_agent
                 FROM common.login_history lh
                 WHERE ${conds.join(' AND ')}
                 ORDER BY lh.created_at DESC
                 LIMIT $${params.length}`,
                params
            );
            res.json(rows);
        } catch (err) {
            console.error('GET /api/admin/login-history error:', err);
            res.status(500).json({ message: 'Failed to list login history.' });
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
                 FROM qa_audit_logs
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
    // ids = tenant_id(citext) 배열. 멤버=common.memberships, 콜=common.calls⋈qa_evaluations(is_sandbox).
    const members = new Map();
    const sessions = new Map();
    if (!ids || ids.length === 0) return { members, sessions };
    // 브랜드별 소속 admin 카운트 (super_admin 제외 — super_admin 은 별도 합산해서 모든 브랜드에 더함).
    const { rows: memberRows } = await pool.query(
        `SELECT tenant_id, COUNT(*)::int AS cnt
         FROM common.memberships
         WHERE tenant_id = ANY($1::citext[]) AND role <> 'super_admin'
         GROUP BY tenant_id`,
        [ids]
    );
    for (const r of memberRows) members.set(r.tenant_id, r.cnt);
    const { rows: superRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM common.memberships WHERE role = 'super_admin'`
    );
    const superCnt = Number(superRows?.[0]?.cnt) || 0;
    for (const id of ids) members.set(id, (members.get(id) || 0) + superCnt);
    const { rows: callRows } = await pool.query(
        `SELECT c.tenant_id, COUNT(*)::int AS cnt
         FROM common.calls c
         JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
         WHERE c.tenant_id = ANY($1::citext[]) AND e.is_sandbox = false
         GROUP BY c.tenant_id`,
        [ids]
    );
    for (const r of callRows) sessions.set(r.tenant_id, r.cnt);
    return { members, sessions };
}
