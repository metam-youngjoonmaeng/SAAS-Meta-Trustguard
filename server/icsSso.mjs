/**
 * ICS SSO 로그인 — 05-AI-Tutor-ICS backend/auth/{ics_db.py,ics_service.py} 포팅.
 *
 * ICS 어드민(MetaHUB) 메뉴 팝업에서 넘어온 userId(=USER_CD@PROJ_CD)를 ICS 운영
 * MariaDB(mtm30, 읽기전용)로 검증하고, 검증되면 admin_users 에 JIT 프로비저닝한 뒤
 * 일반 로그인과 동일한 세션 토큰을 발급한다.
 *
 * 신뢰 모드(Trust mode): ICS 메뉴 팝업은 비번을 넘기지 못한다(USER_INFO 세션에 password
 * 없음, 치환토큰 {{userCd}}@{{projCd}}만 가능). 메뉴는 ICS 인증 사용자에게만 렌더되므로
 * userCd 를 신뢰하고 비번 검증을 스킵한다(8444/내부망 전용 임베드와 동일 신뢰 모델).
 *
 * ICS_DB_HOST 가 비어 있으면 SSO 비활성(연결 시도 안 함) — postgres 만으로 앱 기동.
 */
import crypto from 'crypto';
import express from 'express';
import mysql from 'mysql2/promise';

// AUTH_NM(한글 역할명) → 로컬 role 매핑. S-코드는 테넌트마다 달라 한글명 기준(공백 제거 매칭).
const AUTH_NM_TO_ROLE = {
    '시스템관리자': 'super_admin', // 최고관리자
    '센터관리자': 'admin',         // 관리자
    '상담원': 'agent',             // 상담사
    '상담사': 'agent',             // 실측상 '상담원'/'상담사' 혼용 → 둘 다 agent
};
const ROLE_RANK = { agent: 0, admin: 1, super_admin: 2 };
const ALLOWED_STATUS = new Set(['NORMAL']); // 그 외(PWD_LOCK, 탈퇴 등)는 거부

let _icsPool = null;

export function icsEnabled() {
    return Boolean(String(process.env.ICS_DB_HOST || '').trim());
}

// mtm30 읽기전용 풀 (지연 생성, 작은 풀).
function getIcsPool() {
    if (_icsPool) return _icsPool;
    _icsPool = mysql.createPool({
        host: process.env.ICS_DB_HOST,
        port: Number(process.env.ICS_DB_PORT || 3306),
        user: process.env.ICS_DB_USER,
        password: process.env.ICS_DB_PW,
        database: process.env.ICS_DB_NAME,
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 3,
        connectTimeout: 5000,
    });
    return _icsPool;
}

// ICS AUTH_NM 목록 → 로컬 role. 매칭 없으면 agent. 여러 개면 최강 선택.
function mapRole(authNms) {
    let best = 'agent';
    for (const nm of authNms || []) {
        const key = String(nm || '').replace(/\s+/g, '').trim();
        const role = AUTH_NM_TO_ROLE[key];
        if (role && ROLE_RANK[role] > ROLE_RANK[best]) best = role;
    }
    return best;
}

// ICS 날짜(JOIN_DATE/RETIRE_DATE) → 'YYYY-MM-DD' 정규화. 빈값/0 → null.
export function normalizeIcsDate(v) {
    if (v == null) return null;
    if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    const s = String(v).trim();
    if (!s) return null;
    const digits = s.replace(/\D/g, '');
    if (!digits || /^0+$/.test(digits)) return null; // 0값(0000-00-00, 00000000 등) → 미설정
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    return null;
}

// USER_M 계정 1건 + AUTH_TYPE='S' 역할 한글명(AUTH_NM) 목록 조회. 미존재 시 null.
async function fetchIcsUser(projCd, userCd) {
    const pool = getIcsPool();
    const [urows] = await pool.query(
        `SELECT USER_ID, USER_CD, PROJ_CD, USER_PS, USER_STATUS,
                USER_NM, EMAIL, TEAM_CD, STATION, JOIN_DATE, RETIRE_DATE, DUP_LOGIN_YN
           FROM USER_M WHERE PROJ_CD = ? AND USER_CD = ?`,
        [projCd, userCd]
    );
    if (!urows || urows.length === 0) return null;
    const u = urows[0];
    // AUTH_M PK = (PROJ_CD, AUTH_TYPE, AUTH_CD) → 반드시 PROJ_CD 매칭.
    // USER_AUTH_M.USER_ID 는 varchar 로 숫자 USER_ID 를 문자열 보관 → String() 비교.
    const [arows] = await pool.query(
        "SELECT a.AUTH_NM AS auth_nm FROM USER_AUTH_M ua " +
            "JOIN AUTH_M a ON a.PROJ_CD = ua.PROJ_CD AND a.AUTH_CD = ua.AUTH_CD " +
            "AND a.AUTH_TYPE = 'S' AND a.USE_YN = 'Y' " +
            'WHERE ua.PROJ_CD = ? AND ua.USER_ID = ?',
        [u.PROJ_CD, String(u.USER_ID)]
    );
    return {
        user_id: u.USER_ID,
        user_cd: u.USER_CD,
        proj_cd: u.PROJ_CD,
        user_status: u.USER_STATUS,
        auth_nms: (arows || []).map((r) => r.auth_nm).filter(Boolean),
        // 인사 필드(우리 trainee_registrations 로 동기화)
        user_nm: u.USER_NM || null,
        email: u.EMAIL || null,
        team_cd: u.TEAM_CD || null,
        extension: u.STATION != null && String(u.STATION).trim() !== '' ? String(u.STATION).trim() : null,
        hire_date: normalizeIcsDate(u.JOIN_DATE),
        leave_date: normalizeIcsDate(u.RETIRE_DATE),
        dup_login_yn: String(u.DUP_LOGIN_YN || '').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
    };
}

/**
 * /api/auth/ics-sso 라우터. index.js 에서 app.use('/api', createIcsSsoRouter(pool, { createSession })) 로 마운트.
 * createSession 은 index.js 의 세션 발급 함수(주입).
 */
export function createIcsSsoRouter(pool, { createSession }) {
    const router = express.Router();

    router.post('/auth/ics-sso', async (req, res) => {
        if (!icsEnabled()) {
            res.status(503).json({ message: 'ICS SSO가 비활성화되어 있습니다' });
            return;
        }
        // userId = USER_CD@PROJ_CD
        const raw = String(req.body?.userId || '').trim();
        if (/[{}$]/.test(raw)) {
            res.status(400).json({ message: 'userId 치환 오류 — ICS 메뉴 URL 토큰 확인 필요' });
            return;
        }
        const at = raw.lastIndexOf('@');
        if (at <= 0) {
            res.status(400).json({ message: 'userId 형식 오류 (USER_CD@PROJ_CD)' });
            return;
        }
        const userCd = raw.slice(0, at).trim();
        const projCd = raw.slice(at + 1).trim();
        if (!userCd || !projCd) {
            res.status(400).json({ message: 'userId 형식 오류 (USER_CD@PROJ_CD)' });
            return;
        }

        let icsUser;
        try {
            icsUser = await fetchIcsUser(projCd, userCd);
        } catch (e) {
            console.error('[ics-sso] mtm30 조회 실패:', e?.message || e);
            res.status(502).json({ message: 'ICS 계정 DB 접근 실패' });
            return;
        }
        if (!icsUser) {
            res.status(401).json({ message: '존재하지 않는 ICS 계정입니다' });
            return;
        }
        const status = String(icsUser.user_status || '').trim().toUpperCase();
        if (!ALLOWED_STATUS.has(status)) {
            res.status(403).json({ message: `로그인할 수 없는 계정 상태입니다 (${status || 'UNKNOWN'})` });
            return;
        }

        const role = mapRole(icsUser.auth_nms);
        const loginId = `${userCd}@${projCd}`.toLowerCase();
        // ICS USER_NM/EMAIL 은 암호화 저장(복호화 키 없음) → 표시명은 userCd 유지.
        const displayName = userCd;
        const defaultOrgId = Number(process.env.ICS_SSO_DEFAULT_ORG_ID || 0) || null;
        // ICS 사용자는 SSO 전용 — 직접 로그인 불가하도록 랜덤(매칭 불가) 해시. 비번변경 팝업 없음(must_change=false).
        const randomHash = crypto.randomBytes(32).toString('hex');

        const returningCols =
            'user_id, login_id, display_name, role, org_id, department, must_change_password';
        let row;
        try {
            // admin_users 는 twin 스키마에서 INSTEAD OF 트리거 뷰(users+trainee_registrations 로 라우팅).
            // 뷰에는 unique 제약이 없어 ON CONFLICT 불가 → 수동 upsert: 먼저 UPDATE, 매칭 없으면 INSERT.
            const upd = await pool.query(
                `UPDATE public.admin_users SET
                    display_name = $2,
                    role = $3,
                    is_active = 1,
                    org_id = COALESCE(org_id, $4),
                    updated_at = now()
                 WHERE login_id = $1
                 RETURNING ${returningCols}`,
                [loginId, displayName, role, defaultOrgId]
            );
            if (upd.rows[0]) {
                row = upd.rows[0];
            } else {
                const ins = await pool.query(
                    `INSERT INTO public.admin_users
                        (login_id, password_hash, display_name, role, is_active, org_id, must_change_password, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, 1, $5, false, now(), now())
                     RETURNING ${returningCols}`,
                    [loginId, randomHash, displayName, role, defaultOrgId]
                );
                row = ins.rows[0];
            }
        } catch (e) {
            console.error('[ics-sso] admin_users JIT upsert 실패:', e?.message || e);
            res.status(500).json({ message: 'ICS 사용자 프로비저닝 실패' });
            return;
        }

        // 인사 필드(입사·퇴사·내선·중복로그인) ICS → 우리 테이블 동기화. 뷰 UPDATE 트리거가 trainee_registrations 로 라우팅.
        // (INSERT 트리거는 인사 필드를 다루지 않으므로 upsert 직후 별도 UPDATE 로 일원화.)
        try {
            await pool.query(
                `UPDATE public.admin_users
                    SET hire_date = $2, leave_date = $3, extension = $4, dup_login_yn = $5, updated_at = now()
                  WHERE login_id = $1`,
                [loginId, icsUser.hire_date, icsUser.leave_date, icsUser.extension, icsUser.dup_login_yn]
            );
        } catch (e) {
            console.error('[ics-sso] 인사 필드 동기화 실패(무시):', e?.message || e);
        }

        const sessionToken = createSession(row);
        res.json({
            ok: true,
            user: {
                user_id: row.user_id,
                login_id: row.login_id,
                display_name: row.display_name,
                role: row.role,
                org_id: row.org_id ?? null,
                department: row.department ?? null,
                must_change_password: false,
                auth_source: 'ics', // 프론트: ICS 임베드 세션 표시(로그아웃 숨김 + 직접접속 분리)
                session_token: sessionToken,
            },
        });
    });

    return router;
}
