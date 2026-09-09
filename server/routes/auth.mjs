// 인증 · 세션 · 조직 전환 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 4개 · 함께 옮긴 헬퍼/상태 4개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createAuthRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { AUDIT_ACTION, insertLoginHistory, insertQaAuditLog } from '../auditLog.mjs';
import { SANDBOX_LOGIN_ID, beginSandboxSession, endSandboxSession } from '../sandboxSession.mjs';
import bcrypt from 'bcryptjs';
import { sha256Hex } from '../util/common.mjs';

export function createAuthRoutes(ctx) {
    const { createSession, lookupSession, pool, sessionStore } = ctx;
    const router = express.Router();


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
    async function verifyPassword(password, storedRaw) {
        const raw = rawPasswordHash(storedRaw);
        if (!raw) return false;
        if (/^\$2[aby]\$/.test(raw)) {
            try {
                // 비동기 compare — bcryptjs 는 해싱 라운드 사이에 이벤트루프를 양보하므로
                // 로그인 검증 중에도 루프가 안 막힌다(다른 요청 인터리브).
                // compareSync 는 수십~100ms 동안 루프를 완전히 정지 → 동시 로그인 직렬화·부하 급증.
                return await bcrypt.compare(String(password), raw);
            } catch {
                return false;
            }
        }
        return sha256Hex(password).toLowerCase() === raw.toLowerCase();
    }

    function destroySession(token) {
        if (token) sessionStore.delete(token);
    }

    router.post('/api/auth/login', async (req, res) => {
        const loginId = String(req.body?.id || '').trim();
        const password = String(req.body?.password || '').trim();
        if (!loginId || !password) {
            res.status(400).json({ message: 'id and password are required' });
            return;
        }
        try {
            // 통합DB: admin_users 뷰 폐지 → common.users ⋈ common.memberships 직접 조회.
            //   login_id = username(로컬) 또는 이메일에서 .ics 제거(SSO) — 구 admin_users 뷰 규약과 동일.
            //   활성 멤버십 우선순위(last_active → active → 최소 id)로 1건 선택.
            const { rows } = await pool.query(
                `SELECT u.id AS user_id,
                    COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
                    u.name AS display_name, u.password_hash,
                    m.id AS membership_id, m.tenant_id, m.role::text AS role, m.department,
                    (m.status = 'active') AS is_active
               FROM common.users u
               LEFT JOIN common.memberships m ON m.user_id = u.id
              WHERE COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) = $1
              ORDER BY (m.id = u.last_active_membership_id) DESC NULLS LAST,
                       (m.status = 'active') DESC, m.id ASC
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
                await insertLoginHistory(pool, {
                    req,
                    actor: { user_id: null, login_id: loginId || '(unknown)', role: null },
                    event: 'login_fail',
                    reason: 'user_not_found',
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
                await insertLoginHistory(pool, {
                    req,
                    actor: { user_id: row.user_id, login_id: row.login_id, display_name: row.display_name, role: row.role },
                    org_id: row.org_id,
                    event: 'login_fail',
                    reason: 'inactive',
                });
                res.status(401).json({ message: 'invalid credentials', reason: 'inactive' });
                return;
            }
            if (!(await verifyPassword(password, row.password_hash))) {
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
                await insertLoginHistory(pool, {
                    req,
                    actor: { user_id: row.user_id, login_id: row.login_id, display_name: row.display_name, role: row.role },
                    org_id: row.org_id,
                    event: 'login_fail',
                    reason: 'bad_password',
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
            await insertLoginHistory(pool, {
                req,
                actor: { user_id: row.user_id, login_id: row.login_id, display_name: row.display_name, role: row.role },
                membership_id: row.membership_id,
                event: 'login_success',
            });
            // 활성 멤버십은 위 조회에서 이미 확정(row.membership_id/tenant_id) — last_active 만 갱신.
            if (row.membership_id != null) {
                try {
                    await pool.query('UPDATE common.users SET last_active_membership_id = $1 WHERE id = $2', [row.membership_id, row.user_id]);
                } catch (e) { console.error('last_active_membership update error:', e); }
            }
            const sessionToken = createSession(row);
            res.json({
                ok: true,
                user: {
                    user_id: row.user_id,
                    login_id: row.login_id,
                    display_name: row.display_name,
                    role: row.role,
                    tenant_id: row.tenant_id ?? null,
                    department: row.department ?? null,
                    session_token: sessionToken,
                },
            });
        } catch (error) {
            console.error('POST /api/auth/login error:', error);
            res.status(500).json({ message: 'Failed to login.' });
        }
    });

    router.post('/api/auth/logout', async (req, res) => {
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
            await insertLoginHistory(pool, {
                req,
                actor: {
                    user_id: sessionBeforeDestroy?.user_id ?? null,
                    login_id: loginId || sessionBeforeDestroy?.login_id || '(unknown)',
                    display_name: sessionBeforeDestroy?.display_name ?? null,
                    role: sessionBeforeDestroy?.role ?? null,
                },
                membership_id: sessionBeforeDestroy?.membership_id ?? null,
                event: 'logout',
            });
            res.json({ ok: true });
        } catch (error) {
            console.error('POST /api/auth/logout error:', error);
            res.status(500).json({ message: 'Failed to end session.' });
        }
    });

    // ── 다중 소속(02/03 동일) — 내 멤버십 목록 + 조직 전환 ──────────
    // GET /api/auth/memberships: 로그인 사용자의 active 멤버십(조직×역할) 목록. current=현재 활성.
    router.get('/api/auth/memberships', async (req, res) => {
        const uid = req.session?.user_id;
        if (uid == null) { res.json([]); return; }
        try {
            const { rows } = await pool.query(
                `SELECT m.id AS membership_id, m.tenant_id, tn.name AS tenant_name,
                    m.role::text AS role, m.department
               FROM common.memberships m
               LEFT JOIN common.tenants tn ON tn.tenant_id = m.tenant_id
              WHERE m.user_id = $1 AND m.status = 'active'
              ORDER BY (m.id = (SELECT last_active_membership_id FROM common.users WHERE id = $1)) DESC NULLS LAST,
                       m.id ASC`,
                [uid]
            );
            const activeMid = req.session.membership_id ?? null;
            const activeTenant = req.session.tenant_id ?? null;
            res.json(rows.map((r) => ({
                ...r,
                // 현재 활성: 세션의 membership_id 우선, 없으면 tenant_id 로 매칭(폴백).
                current: activeMid != null ? r.membership_id === activeMid : r.tenant_id === activeTenant,
            })));
        } catch (error) {
            console.error('GET /api/auth/memberships error:', error);
            res.status(500).json({ message: 'Failed to load memberships.' });
        }
    });

    // POST /api/auth/switch-org { trainee_id }: 본인 소유 active 멤버십으로 활성 전환.
    //   users.last_active_trainee_id 갱신 + 현재 세션의 org_id/role/trainee_id 교체(다음 로그인도 유지).
    router.post('/api/auth/switch-org', async (req, res) => {
        const uid = req.session?.user_id;
        if (uid == null) { res.status(401).json({ message: 'not authenticated' }); return; }
        // body: membership_id(신) 우선, trainee_id(구, 프론트 미전환 호환) 폴백.
        const membershipId = Number(req.body?.membership_id ?? req.body?.trainee_id);
        if (!Number.isFinite(membershipId)) { res.status(400).json({ message: 'membership_id required' }); return; }
        try {
            const { rows } = await pool.query(
                `SELECT m.id, m.tenant_id, m.role::text AS role, m.department, tn.name AS tenant_name
               FROM common.memberships m
               LEFT JOIN common.tenants tn ON tn.tenant_id = m.tenant_id
              WHERE m.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
                [membershipId, uid]
            );
            if (!rows.length) { res.status(403).json({ message: '해당 조직 멤버십에 접근 권한이 없습니다.' }); return; }
            const m = rows[0];
            await pool.query('UPDATE common.users SET last_active_membership_id = $1 WHERE id = $2', [membershipId, uid]);
            // 세션은 sessionStore 객체 참조 → 필드 갱신이 그대로 저장됨.
            if (req.session) {
                req.session.tenant_id = m.tenant_id;
                req.session.role = m.role;
                req.session.membership_id = m.id;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.BRAND_SWITCH || 'BRAND_SWITCH',
                resource_type: 'membership',
                resource_id: String(membershipId),
                http_method: 'POST',
                http_path: '/api/auth/switch-org',
                detail_json: JSON.stringify({ tenant_id: m.tenant_id, role: m.role }),
                success: true,
            });
            res.json({ ok: true, membership_id: m.id, tenant_id: m.tenant_id, tenant_name: m.tenant_name, role: m.role, department: m.department });
        } catch (error) {
            console.error('POST /api/auth/switch-org error:', error);
            res.status(500).json({ message: 'Failed to switch organization.' });
        }
    });

    return router;
}
