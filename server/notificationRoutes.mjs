// 알림(notifications) 라우터 — 수신자 본인의 알림 목록/읽음/삭제 + 수신 선호(notification_prefs).
// 원래 server/index.js 에 있던 8 라우트를 그대로 옮긴 것. 경로·메서드·응답 형상 불변.
//
// 스코프: 전 라우트가 req.session.user_id(= recipient_user_id) 로만 필터한다. 브랜드
//   컨텍스트(X-Active-Brand-Id)나 관리자 게이트(requireAdmin)를 쓰지 않으므로 pool 외 주입이 없다.
//   세션은 index.js 의 앱 레벨 인증 미들웨어가 채우므로(마운트보다 먼저 등록) 여기선 존재만 확인한다.
//
// 발송(INSERT) 쪽은 여기 없다 — createNotification() 은 검수·코칭 라우트가 쓰는 index.js 헬퍼로 남아 있다.

import express from 'express';

const NOTIF_WINDOW_DAYS = 30;

function toNotificationRow(r) {
    return {
        id: Number(r.id),
        type: r.type,
        title: r.title,
        body: r.body ?? null,
        resource_type: r.resource_type ?? null,
        resource_id: r.resource_id ?? null,
        actor_name: r.actor_name ?? null,
        read: r.read_at != null,
        created_at: r.created_at,
    };
}

export function createNotificationRouter(pool) {
    const router = express.Router();

    router.get('/notifications', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.json([]); return; }
            const scope = String(req.query.scope || 'all');
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
            const params = [uid, `${NOTIF_WINDOW_DAYS} days`];
            let where = `recipient_user_id = $1 AND created_at >= now() - $2::interval`;
            if (scope === 'current') where += ` AND read_at IS NULL`;
            params.push(limit);
            const { rows } = await pool.query(
                `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
                params
            );
            res.json(rows.map(toNotificationRow));
        } catch (error) {
            console.error('GET /api/notifications error:', error);
            res.status(500).json({ message: 'Failed to load notifications.' });
        }
    });

    router.get('/notifications/unread-count', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.json({ count: 0 }); return; }
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL`,
                [uid]
            );
            res.json({ count: rows[0]?.count ?? 0 });
        } catch (error) {
            console.error('GET /api/notifications/unread-count error:', error);
            res.status(500).json({ count: 0 });
        }
    });

    router.post('/notifications/read', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            await pool.query(
                `UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL`,
                [uid]
            );
            res.json({ ok: true });
        } catch (error) {
            console.error('POST /api/notifications/read error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    router.post('/notifications/:id/read', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            const id = Number(req.params.id);
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            if (!Number.isFinite(id)) { res.status(400).json({ message: 'invalid id' }); return; }
            await pool.query(
                `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_user_id = $2`,
                [id, uid]
            );
            res.json({ ok: true });
        } catch (error) {
            console.error('POST /api/notifications/:id/read error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    router.delete('/notifications/:id', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            const id = Number(req.params.id);
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            if (!Number.isFinite(id)) { res.status(400).json({ message: 'invalid id' }); return; }
            const { rowCount } = await pool.query(
                `DELETE FROM notifications WHERE id = $1 AND recipient_user_id = $2`,
                [id, uid]
            );
            res.json({ ok: true, deleted: rowCount });
        } catch (error) {
            console.error('DELETE /api/notifications/:id error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    router.delete('/notifications', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            const { rowCount } = await pool.query(
                `DELETE FROM notifications WHERE recipient_user_id = $1`,
                [uid]
            );
            res.json({ ok: true, deleted: rowCount });
        } catch (error) {
            console.error('DELETE /api/notifications error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    // 알림 수신 선호 조회 — { prefs: { "<type>": false, ... } } (미기재 유형 = 수신 on). 설정 > 알림 설정.
    router.get('/notifications/prefs', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            const { rows } = await pool.query(
                `SELECT prefs FROM notification_prefs WHERE user_id = $1`, [uid]
            );
            res.json({ prefs: rows[0]?.prefs || {} });
        } catch (error) {
            console.error('GET /api/notifications/prefs error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    // 알림 수신 선호 저장 — body { prefs: { "<type>": bool } }. 전체 맵 upsert(프론트가 끈 유형만 false 로 정리).
    router.put('/notifications/prefs', async (req, res) => {
        try {
            const uid = req.session?.user_id;
            if (uid == null) { res.status(401).json({ message: 'login required' }); return; }
            const prefs = (req.body && typeof req.body.prefs === 'object' && req.body.prefs) || {};
            await pool.query(
                `INSERT INTO notification_prefs (user_id, prefs, updated_at)
                 VALUES ($1, $2::jsonb, now())
                 ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
                [uid, JSON.stringify(prefs)]
            );
            res.json({ ok: true, prefs });
        } catch (error) {
            console.error('PUT /api/notifications/prefs error:', error);
            res.status(500).json({ message: 'failed' });
        }
    });

    return router;
}
