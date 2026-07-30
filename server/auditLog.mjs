/**
 * QA 감사 로그 — qa_audit_logs (PostgreSQL)
 * DDL은 docker/init/postgres/01_init.sql 의 dump 안에 포함
 */

import pg from 'pg';

export const AUDIT_ACTION = {
    AUTH_LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
    AUTH_LOGIN_FAIL: 'AUTH_LOGIN_FAIL',
    AUTH_LOGOUT: 'AUTH_LOGOUT',
    QA_MANUAL_EVAL_SAVE: 'QA_MANUAL_EVAL_SAVE',
    QA_REVIEW_STATUS_UPDATE: 'QA_REVIEW_STATUS_UPDATE',
    QA_ADMIN_COMMENTS_SAVE: 'QA_ADMIN_COMMENTS_SAVE',
    QA_GOLDEN_SET_ADD: 'QA_GOLDEN_SET_ADD',
    QA_GOLDEN_SET_REMOVE: 'QA_GOLDEN_SET_REMOVE',
    SAMPLE_INGEST: 'SAMPLE_INGEST',
    SAMPLE_CLEAR: 'SAMPLE_CLEAR',
    INGEST_AI_CANVAS: 'INGEST_AI_CANVAS',
    INGEST_COLLECTION_CALL: 'INGEST_COLLECTION_CALL',
    INGEST_QA_PIPELINE: 'INGEST_QA_PIPELINE',
    BRAND_CREATE: 'BRAND_CREATE',
    BRAND_UPDATE: 'BRAND_UPDATE',
    BRAND_DELETE: 'BRAND_DELETE',
    USER_CREATE: 'USER_CREATE',
    USER_UPDATE: 'USER_UPDATE',
    USER_DELETE: 'USER_DELETE',
    USER_PASSWORD_CHANGE: 'USER_PASSWORD_CHANGE',
    DOMAIN_CREATE: 'DOMAIN_CREATE',
    DOMAIN_UPDATE: 'DOMAIN_UPDATE',
    DOMAIN_DELETE: 'DOMAIN_DELETE',
    DOMAIN_EVAL_DEFAULT_CREATE: 'DOMAIN_EVAL_DEFAULT_CREATE',
    DOMAIN_EVAL_DEFAULT_UPDATE: 'DOMAIN_EVAL_DEFAULT_UPDATE',
    DOMAIN_EVAL_DEFAULT_DELETE: 'DOMAIN_EVAL_DEFAULT_DELETE',
    DOMAIN_PENTAGON_DEFAULT_CREATE: 'DOMAIN_PENTAGON_DEFAULT_CREATE',
    DOMAIN_PENTAGON_DEFAULT_UPDATE: 'DOMAIN_PENTAGON_DEFAULT_UPDATE',
    DOMAIN_PENTAGON_DEFAULT_DELETE: 'DOMAIN_PENTAGON_DEFAULT_DELETE',
};

// 보관 기간: AI-Tutor backend/main.py 의 loguru retention="3 days" 와 동일
export const AUDIT_RETENTION_DAYS = 3;
// 실시간 로그 화면 표시 기간(서버 측 강제 윈도우)
export const AUDIT_VIEW_WINDOW_DAYS = 1;

/**
 * 3일 초과 audit 로그 삭제. 부팅 시 1회 + 6시간마다 호출.
 * @param {pg.Pool} pool
 */
export async function pruneOldAuditLogs(pool) {
    try {
        const { rowCount } = await pool.query(
            `DELETE FROM trustguard.qa_audit_logs WHERE created_at < now() - $1::interval`,
            [`${AUDIT_RETENTION_DAYS} days`]
        );
        if (rowCount > 0) {
            console.log(`[qa-audit] pruned ${rowCount} rows older than ${AUDIT_RETENTION_DAYS} days`);
        }
    } catch (err) {
        console.error('[qa-audit] prune failed:', err);
    }
}

export function readActorFromReq(req) {
    const rawUid = String(req.headers['x-actor-user-id'] || '').trim();
    const uid = rawUid ? parseInt(rawUid, 10) : NaN;
    let loginId = String(req.headers['x-actor-login-id'] || '').trim();
    try {
        if (loginId) loginId = decodeURIComponent(loginId);
    } catch {
        /* keep raw */
    }
    let role = String(req.headers['x-actor-role'] || '').trim();
    try {
        if (role) role = decodeURIComponent(role);
    } catch {
        /* keep */
    }
    role = role.slice(0, 64);
    return {
        user_id: Number.isFinite(uid) ? uid : null,
        login_id: loginId || '(unknown)',
        display_name: null,
        role: role || null,
    };
}

export function clientMetaFromReq(req) {
    const xff = req.headers['x-forwarded-for'];
    const ip =
        typeof xff === 'string' && xff.length > 0
            ? xff.split(',')[0].trim().slice(0, 64)
            : String(req.socket?.remoteAddress || '').slice(0, 64);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    return { client_ip: ip || null, user_agent: ua || null };
}

/**
 * @param {pg.Pool} pool
 * @param {object} p
 */
export async function insertQaAuditLog(pool, p) {
    const actor = p.actor != null ? p.actor : readActorFromReq(p.req || {});
    const meta = clientMetaFromReq(p.req || {});
    const row = {
        user_id: actor.user_id ?? null,
        login_id: String(actor.login_id || '(unknown)').slice(0, 128),
        display_name: actor.display_name != null ? String(actor.display_name).slice(0, 200) : null,
        role: actor.role != null ? String(actor.role).slice(0, 64) : null,
        action: String(p.action || '').slice(0, 64),
        resource_type: String(p.resource_type || '').slice(0, 64),
        resource_id: String(p.resource_id || '').slice(0, 256),
        http_method: p.http_method != null ? String(p.http_method).slice(0, 16) : null,
        http_path: p.http_path != null ? String(p.http_path).slice(0, 512) : null,
        client_ip: meta.client_ip,
        user_agent: meta.user_agent,
        detail_json: p.detail_json != null ? String(p.detail_json).slice(0, 8000) : null,
        success: p.success === false || p.success === 0 ? 0 : 1,
        error_message: p.error_message != null ? String(p.error_message).slice(0, 2000) : null,
    };
    try {
        await pool.query(
            `INSERT INTO qa_audit_logs (
                user_id, login_id, display_name, role,
                action, resource_type, resource_id,
                http_method, http_path, client_ip, user_agent,
                detail_json, success, error_message
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10, $11,
                $12, $13, $14
            )`,
            [
                row.user_id,
                row.login_id,
                row.display_name,
                row.role,
                row.action,
                row.resource_type,
                row.resource_id,
                row.http_method,
                row.http_path,
                row.client_ip,
                row.user_agent,
                row.detail_json,
                row.success,
                row.error_message,
            ]
        );
    } catch (err) {
        console.error('[qa-audit] insert failed:', err);
    }
}

/**
 * 로그인 이력(login_history) 영속 기록. qa_audit_logs 와 달리 prune 대상이 아님(영구 보존).
 * 로그인 성공/실패/로그아웃 시점에 감사로그와 병행 호출한다. 실패해도 로그인 흐름을 막지 않는다.
 * @param {pg.Pool} pool
 * @param {object} p - { req, actor:{user_id,login_id,display_name,role}, org_id, event, reason }
 */
export async function insertLoginHistory(pool, p) {
    // 통합DB: common.login_history(user_id, membership_id, email, name, event=common.logineventtype,
    //   ip_address, user_agent). 구 login_id/role/org_id/reason 컬럼은 없음 →
    //   실패 사유·역할·브랜드는 qa_audit_logs(insertQaAuditLog)가 detail_json 으로 별도 보존.
    //   email/name 은 actor 에서(로그인ID는 이메일 규약이라 email 로 보관), membership_id 는 있으면.
    const actor = p.actor || {};
    const meta = clientMetaFromReq(p.req || {});
    const row = {
        user_id: actor.user_id ?? null,
        membership_id: p.membership_id ?? actor.membership_id ?? null,
        email: actor.email ?? (actor.login_id != null ? String(actor.login_id).slice(0, 200) : null),
        name: actor.display_name != null ? String(actor.display_name).slice(0, 200) : null,
        event: String(p.event || 'login_success').slice(0, 32),
        ip_address: meta.client_ip,
        user_agent: meta.user_agent,
    };
    try {
        await pool.query(
            `INSERT INTO login_history (user_id, membership_id, email, name, event, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [row.user_id, row.membership_id, row.email, row.name, row.event, row.ip_address, row.user_agent]
        );
    } catch (err) {
        console.error('[login-history] insert failed:', err);
    }
}
