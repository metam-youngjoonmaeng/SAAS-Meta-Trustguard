// 본인 프로필 셀프-편집 라우터.
// - PATCH /api/me           : display_name / password 변경 (본인만, role/org/login_id 변경 불가)
// - GET   /api/me           : 현재 세션 사용자의 단일 사용자 객체 반환 (login 응답과 동일 형태)
//
// 비밀번호 정책: 영문·숫자·특수문자[@$!%*#?&] 1자 이상씩 + 8~20자.
// (프로필 이미지 업로드 기능은 폐지 — 사용자 식별은 display_name 텍스트만 사용)

import crypto from 'crypto';
import express from 'express';
import { AUDIT_ACTION, insertQaAuditLog } from './auditLog.mjs';

export const PASSWORD_POLICY_HINT = '영문, 숫자, 특수문자[ @$!%*#?& ] 포함 8~20자';
const PASSWORD_POLICY_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,20}$/;

function sha256Hex(s) {
    return crypto.createHash('sha256').update(String(s)).digest('hex');
}

export function isPasswordPolicyOk(pw) {
    return typeof pw === 'string' && PASSWORD_POLICY_RE.test(pw);
}

export function buildMeResponse(row, sessionToken) {
    return {
        user_id: row.user_id,
        login_id: row.login_id,
        display_name: row.display_name,
        role: row.role,
        tenant_id: row.tenant_id ?? null,
        tenant_name: row.tenant_name ?? null,
        department: row.department ?? null,
        email: row.email ?? null,
        ...(sessionToken ? { session_token: sessionToken } : {}),
    };
}

// /me 조회 — common.users + 활성 멤버십(우선순위: last_active → 최소 id) + tenants.
const ME_SELECT = `
    SELECT u.id AS user_id,
           COALESCE(u.username, regexp_replace(u.email, '\\.ics$', '')) AS login_id,
           u.name AS display_name, u.email,
           m.role::text AS role, m.tenant_id, m.department, tn.name AS tenant_name
      FROM common.users u
      LEFT JOIN LATERAL (
          SELECT mm.id, mm.role, mm.tenant_id, mm.department
            FROM common.memberships mm
           WHERE mm.user_id = u.id AND mm.status = 'active'
           ORDER BY (mm.id = u.last_active_membership_id) DESC NULLS LAST, mm.id ASC
           LIMIT 1
      ) m ON true
      LEFT JOIN common.tenants tn ON tn.tenant_id = m.tenant_id
     WHERE u.id = $1`;

export function createUserProfileRouter(pool) {
    const router = express.Router();

    router.get('/me', async (req, res) => {
        try {
            const { rows } = await pool.query(ME_SELECT, [req.session.user_id]);
            if (!rows[0]) {
                res.status(404).json({ message: '계정을 찾을 수 없습니다' });
                return;
            }
            res.json(buildMeResponse(rows[0]));
        } catch (err) {
            console.error('GET /api/me error:', err);
            res.status(500).json({ message: 'Failed to load profile.' });
        }
    });

    router.patch('/me', async (req, res) => {
        const userId = req.session.user_id;
        const newName = typeof req.body?.display_name === 'string' ? String(req.body.display_name).trim() : null;
        const newPassword = typeof req.body?.new_password === 'string' ? String(req.body.new_password) : null;
        const currentPassword = typeof req.body?.current_password === 'string' ? String(req.body.current_password) : null;

        if (newName === null && newPassword === null) {
            res.status(400).json({ message: '변경 항목이 없습니다' });
            return;
        }
        if (newName !== null && (newName.length < 1 || newName.length > 50)) {
            res.status(400).json({ message: '이름은 1~50자여야 합니다' });
            return;
        }
        if (newPassword !== null) {
            if (!currentPassword) {
                res.status(400).json({ message: '현재 비밀번호를 입력해 주세요' });
                return;
            }
            if (!isPasswordPolicyOk(newPassword)) {
                res.status(400).json({ message: `비밀번호 규칙: ${PASSWORD_POLICY_HINT}` });
                return;
            }
        }

        try {
            const { rows: cur } = await pool.query(
                `SELECT id AS user_id, COALESCE(username, regexp_replace(email, '\\.ics$', '')) AS login_id, password_hash
                   FROM common.users WHERE id = $1`,
                [userId]
            );
            const me = cur[0];
            if (!me) {
                res.status(404).json({ message: '계정을 찾을 수 없습니다' });
                return;
            }

            // 비밀번호 변경 시 현재 비번 검증.
            if (newPassword !== null) {
                const storedHash = String(me.password_hash || '').trim().toLowerCase();
                const inputHash = sha256Hex(currentPassword).toLowerCase();
                if (!storedHash || storedHash !== inputHash) {
                    await insertQaAuditLog(pool, {
                        req,
                        action: AUDIT_ACTION.USER_PASSWORD_CHANGE,
                        resource_type: 'admin_user',
                        resource_id: String(userId),
                        http_method: 'PATCH',
                        http_path: '/api/me',
                        detail_json: JSON.stringify({ reason: 'current_password_mismatch' }),
                        success: false,
                        error_message: 'current password mismatch',
                    });
                    res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다' });
                    return;
                }
            }

            const fields = [];
            const values = [];
            let idx = 1;
            if (newName !== null) {
                fields.push(`name = $${idx++}`);   // common.users.name (구 admin_users.display_name)
                values.push(newName);
            }
            if (newPassword !== null) {
                fields.push(`password_hash = $${idx++}`);
                values.push(sha256Hex(newPassword));
            }
            values.push(userId);
            await pool.query(`UPDATE common.users SET ${fields.join(', ')} WHERE id = $${idx}`, values);
            // 응답은 /me 와 동일 형태로 재조회(역할/테넌트/부서는 멤버십에서).
            const { rows: updated } = await pool.query(ME_SELECT, [userId]);

            // 세션 캐시도 display_name 만 동기화 (role/org_id 등은 본 라우트에서 손대지 않음).
            if (req.session && newName !== null) {
                req.session.display_name = newName;
            }

            const detail = { changed: [] };
            if (newName !== null) detail.changed.push('display_name');
            if (newPassword !== null) {
                detail.changed.push('password');
                detail.password_changed = true;
            }
            await insertQaAuditLog(pool, {
                req,
                action: newPassword !== null ? AUDIT_ACTION.USER_PASSWORD_CHANGE : AUDIT_ACTION.USER_UPDATE,
                resource_type: 'admin_user',
                resource_id: String(userId),
                http_method: 'PATCH',
                http_path: '/api/me',
                detail_json: JSON.stringify(detail),
                success: true,
            });
            res.json(buildMeResponse(updated[0]));
        } catch (err) {
            console.error('PATCH /api/me error:', err);
            res.status(500).json({ message: 'Failed to update profile.' });
        }
    });

    return router;
}
