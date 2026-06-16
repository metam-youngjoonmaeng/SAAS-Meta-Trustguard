// 본인 프로필 셀프-편집 라우터.
// - PATCH /api/me           : display_name / password 변경 (본인만, role/org/login_id 변경 불가)
// - POST  /api/me/avatar    : 프로필 이미지 업로드 (multipart, 2MB, jpg/png/webp)
// - DELETE /api/me/avatar   : 프로필 이미지 제거
// - GET   /api/me           : 현재 세션 사용자의 단일 사용자 객체 반환 (login 응답과 동일 형태)
//
// 비밀번호 정책: 영문·숫자·특수문자[@$!%*#?&] 1자 이상씩 + 8~20자.
// must_change_password 플래그가 true 인 사용자는 비번 변경 전까지 다른 API 호출이 차단되지 않지만
// 프론트에서 강제 모달을 띄워 사용자가 즉시 변경하도록 한다.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { AUDIT_ACTION, insertQaAuditLog } from './auditLog.mjs';

export const PASSWORD_POLICY_HINT = '영문, 숫자, 특수문자[ @$!%*#?& ] 포함 8~20자';
const PASSWORD_POLICY_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,20}$/;
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function sha256Hex(s) {
    return crypto.createHash('sha256').update(String(s)).digest('hex');
}

export function isPasswordPolicyOk(pw) {
    return typeof pw === 'string' && PASSWORD_POLICY_RE.test(pw);
}

function extensionForMime(mime) {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return null;
}

function publicUrlFromPath(p) {
    if (!p) return null;
    // DB 에는 상대 경로(profiles/<file>) 만 저장 → URL 은 /uploads/ prefix.
    return `/uploads/${p}`;
}

export function buildMeResponse(row, sessionToken) {
    return {
        user_id: row.user_id,
        login_id: row.login_id,
        display_name: row.display_name,
        role: row.role,
        org_id: row.org_id ?? null,
        department: row.department ?? null,
        profile_image_url: publicUrlFromPath(row.profile_image_path),
        must_change_password: Boolean(row.must_change_password),
        ...(sessionToken ? { session_token: sessionToken } : {}),
    };
}

export function createUserProfileRouter(pool, { uploadsRoot }) {
    const router = express.Router();
    const profilesDir = path.join(uploadsRoot, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
        fileFilter: (_req, file, cb) => {
            if (!AVATAR_ALLOWED_MIME.has(file.mimetype)) {
                cb(new Error('jpg/png/webp 이미지만 업로드 가능합니다.'));
                return;
            }
            cb(null, true);
        },
    });

    router.get('/me', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT user_id, login_id, display_name, role, is_active, org_id, department,
                        profile_image_path, must_change_password
                 FROM public.admin_users
                 WHERE user_id = $1`,
                [req.session.user_id]
            );
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
                `SELECT user_id, login_id, password_hash FROM public.admin_users WHERE user_id = $1`,
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
                fields.push(`display_name = $${idx++}`);
                values.push(newName);
            }
            if (newPassword !== null) {
                fields.push(`password_hash = $${idx++}`);
                values.push(sha256Hex(newPassword));
                // 비번을 본인이 직접 변경했으면 강제 변경 플래그 해제.
                fields.push(`must_change_password = false`);
            }
            fields.push(`updated_at = now()`);
            values.push(userId);
            const { rows: updated } = await pool.query(
                `UPDATE public.admin_users SET ${fields.join(', ')} WHERE user_id = $${idx}
                 RETURNING user_id, login_id, display_name, role, org_id, department,
                           profile_image_path, must_change_password`,
                values
            );

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

    router.post('/me/avatar', (req, res) => {
        upload.single('avatar')(req, res, async (uploadErr) => {
            if (uploadErr) {
                const msg = String(uploadErr?.message || uploadErr);
                const status = msg.includes('File too large') ? 413 : 400;
                res.status(status).json({ message: status === 413 ? '이미지 크기는 2MB 이하만 가능합니다' : msg });
                return;
            }
            if (!req.file) {
                res.status(400).json({ message: 'avatar 파일이 필요합니다' });
                return;
            }
            const ext = extensionForMime(req.file.mimetype);
            if (!ext) {
                res.status(400).json({ message: 'jpg/png/webp 이미지만 업로드 가능합니다.' });
                return;
            }
            const userId = req.session.user_id;
            const fileName = `${userId}_${Date.now()}.${ext}`;
            const relPath = path.posix.join('profiles', fileName);
            const absPath = path.join(profilesDir, fileName);
            try {
                // 같은 사용자의 이전 아바타 파일 삭제 — 디스크 누수 방지.
                const { rows: prev } = await pool.query(
                    `SELECT profile_image_path FROM public.admin_users WHERE user_id = $1`,
                    [userId]
                );
                fs.writeFileSync(absPath, req.file.buffer);
                await pool.query(
                    `UPDATE public.admin_users SET profile_image_path = $1, updated_at = now() WHERE user_id = $2`,
                    [relPath, userId]
                );
                const prevPath = prev[0]?.profile_image_path;
                if (prevPath && prevPath !== relPath) {
                    const prevAbs = path.join(uploadsRoot, prevPath);
                    fs.promises.unlink(prevAbs).catch(() => {});
                }
                await insertQaAuditLog(pool, {
                    req,
                    action: AUDIT_ACTION.USER_UPDATE,
                    resource_type: 'admin_user',
                    resource_id: String(userId),
                    http_method: 'POST',
                    http_path: '/api/me/avatar',
                    detail_json: JSON.stringify({ changed: ['profile_image'], size: req.file.size, mime: req.file.mimetype }),
                    success: true,
                });
                res.json({ ok: true, profile_image_url: publicUrlFromPath(relPath) });
            } catch (err) {
                console.error('POST /api/me/avatar error:', err);
                res.status(500).json({ message: 'Failed to upload avatar.' });
            }
        });
    });

    router.delete('/me/avatar', async (req, res) => {
        const userId = req.session.user_id;
        try {
            const { rows: prev } = await pool.query(
                `SELECT profile_image_path FROM public.admin_users WHERE user_id = $1`,
                [userId]
            );
            const prevPath = prev[0]?.profile_image_path;
            await pool.query(
                `UPDATE public.admin_users SET profile_image_path = NULL, updated_at = now() WHERE user_id = $1`,
                [userId]
            );
            if (prevPath) {
                const prevAbs = path.join(uploadsRoot, prevPath);
                fs.promises.unlink(prevAbs).catch(() => {});
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.USER_UPDATE,
                resource_type: 'admin_user',
                resource_id: String(userId),
                http_method: 'DELETE',
                http_path: '/api/me/avatar',
                detail_json: JSON.stringify({ changed: ['profile_image'], removed: true }),
                success: true,
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('DELETE /api/me/avatar error:', err);
            res.status(500).json({ message: 'Failed to remove avatar.' });
        }
    });

    return router;
}
