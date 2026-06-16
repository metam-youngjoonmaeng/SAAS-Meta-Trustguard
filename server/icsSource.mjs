/**
 * ICS MariaDB(mtm30) 입력 소스 — 읽기 전용.
 *
 * 08(TA, services/ics/source.py)과 동일한 계약/패턴을 Node(mysql2)로 옮긴 것.
 * 계약(08 docs/ICS_입력데이터_계약.md):
 *   - tb_stt_master : 콜 마스터 (UID UNIQUE, END_YN 'N'→'Y', PROJ_CD, CALL_END_DATE)  ← 종료 트리거
 *   - tb_stt        : 발화 상세 (UID, STT_SEQ, SPEAKER, DATA/DATA_LM)                 ← 대화 원천
 *   - tb_call_his   : 통화 메타 (UID, USER_ID(상담원), CHANNEL_TYPE)                   ← 보조(선택)
 * 모든 테이블은 UID(녹취키)로 묶인다. 전화 1건 = UID 1개.
 *
 * 연결정보는 09가 ICS SSO 용으로 이미 쓰는 ICS_DB_* 를 그대로 재사용한다(중복 설정 방지):
 *   ICS_DB_HOST / ICS_DB_PORT(3306) / ICS_DB_NAME(mtm30) / ICS_DB_USER / ICS_DB_PW
 * env-gated: ICS_DB_HOST 가 비어 있으면 icsEnabled()=false → 폴러가 no-op.
 * (단, 폴링 자체의 on/off 마스터 스위치는 폴러의 ICS_QA_POLL_ENABLED 이다.)
 *
 * 날짜는 dateStrings:true 로 문자열('YYYY-MM-DD HH:mm:ss') 수신 → 워터마크/CDATE 를 텍스트로 안전 보관.
 * (SSO 풀과 독립된 작은 읽기 전용 풀.)
 */

import mysql from 'mysql2/promise';
import { logger } from './logger.mjs';

function env(key, def = '') {
    return String(process.env[key] ?? def).trim();
}

/** ICS DB 접속정보(HOST)가 채워져야 활성. 미설정 시 전체 no-op. (icsSso.icsEnabled 와 동일 기준) */
export function icsEnabled() {
    return Boolean(env('ICS_DB_HOST'));
}

let _pool = null;

/** ICS MariaDB 풀(lazy, 읽기 전용 용도). 미설정 시 호출부는 icsEnabled() 로 가드. */
function getPool() {
    if (!icsEnabled()) throw new Error('ICS DB 연결정보 미설정 (ICS_DB_* 환경변수)');
    if (_pool === null) {
        _pool = mysql.createPool({
            host: env('ICS_DB_HOST'),
            port: Number(env('ICS_DB_PORT', '3306')) || 3306,
            database: env('ICS_DB_NAME', 'mtm30'),
            user: env('ICS_DB_USER'),
            password: process.env.ICS_DB_PW ?? '',
            charset: 'utf8mb4',
            waitForConnections: true,
            connectionLimit: Number(env('ICS_QA_DB_POOL', '4')) || 4,
            connectTimeout: 5000,
            dateStrings: true, // datetime 을 문자열로 받아 타임존 왜곡 방지 (CDATE/워터마크 텍스트 보관)
        });
        logger.info(
            `[ics-source] ICS MariaDB 읽기풀 생성 — ${env('ICS_DB_USER')}@${env('ICS_DB_HOST')}:${env('ICS_DB_PORT', '3306')}/${env('ICS_DB_NAME', 'mtm30')}`
        );
    }
    return _pool;
}

/**
 * 종료된(END_YN='Y') 콜을 (CALL_END_DATE, UID) 오름차순으로 — 워터마크 이후만.
 * 실시간/배치 폴러용 (트리거 = 콜 종료). tb_stt_master 한 행 = 콜 1건.
 *
 * 커서 = (afterEndDate, afterUid) 복합 → 같은 초에 끝난 콜이 여럿이어도 누락/중복 없이 전진.
 * END_YN='Y' 면 STT 적재가 완료된 상태이므로 별도 유예 없이 바로 대상(08과 동일).
 *
 * @param {string|null} projCd       PROJ_CD (null이면 전체)
 * @param {string|null} afterEndDate 'YYYY-MM-DD HH:mm:ss' (null이면 처음부터)
 * @param {string|null} afterUid     동일 CALL_END_DATE 내 커서 (afterEndDate 없으면 무시)
 * @param {number} limit
 * @returns {Promise<Array<{uid, start_dt, end_dt, proj_cd, user_id}>>}
 */
export async function listCompletedCalls(projCd, afterEndDate, afterUid, limit = 50) {
    const sql = `
        SELECT m.UID             AS uid,
               m.CALL_START_DATE AS start_dt,
               m.CALL_END_DATE   AS end_dt,
               m.PROJ_CD         AS proj_cd,
               m.USER_ID         AS user_id,
               u.USER_CD         AS agent_code
          FROM tb_stt_master m
          LEFT JOIN user_m u ON u.USER_ID = m.USER_ID AND u.PROJ_CD = m.PROJ_CD
         WHERE m.END_YN = 'Y'
           AND m.UID IS NOT NULL AND m.UID <> ''
           AND (? IS NULL OR m.PROJ_CD = ?)
           AND (? IS NULL OR m.CALL_END_DATE > ? OR (m.CALL_END_DATE = ? AND m.UID > ?))
         ORDER BY m.CALL_END_DATE ASC, m.UID ASC
         LIMIT ?`;
    const proj = projCd || null;
    const after = afterEndDate || null;
    const aUid = afterUid || null;
    const [rows] = await getPool().query(sql, [proj, proj, after, after, after, aUid, Number(limit) || 50]);
    return rows;
}

/**
 * 해당 PROJ_CD 의 현재 최신 종료콜 CALL_END_DATE (없으면 null).
 * 최초 기동 시 워터마크 초기값으로 사용 → 백로그를 건너뛰고 "이후 신규콜만" 처리.
 * @returns {Promise<string|null>} 'YYYY-MM-DD HH:mm:ss'
 */
export async function maxCompletedEndDate(projCd) {
    const sql = `
        SELECT MAX(CALL_END_DATE) AS max_end
          FROM tb_stt_master
         WHERE END_YN = 'Y'
           AND (? IS NULL OR PROJ_CD = ?)`;
    const proj = projCd || null;
    const [rows] = await getPool().query(sql, [proj, proj]);
    return rows?.[0]?.max_end ?? null;
}

/**
 * 단일 UID 의 tb_stt_master 한 행 — { uid, start_dt, end_dt, end_yn }. 없으면 null.
 * MQTT finish 즉시적재 시 완료 게이트(END_YN='Y') + 상담 시작/종료 시각을 한 번에 얻는다.
 * @returns {Promise<{uid, start_dt, end_dt, end_yn}|null>}
 */
export async function getCallMaster(uid, projCd) {
    // 담당 상담사도 함께 해석: tb_stt_master.USER_ID(상담원ID) → user_m.USER_CD(업무키).
    // m.USER_ID 는 varchar, u.USER_ID 는 bigint 라 MySQL 암묵 형변환으로 매칭된다.
    const sql = `
        SELECT m.UID             AS uid,
               m.CALL_START_DATE AS start_dt,
               m.CALL_END_DATE   AS end_dt,
               m.END_YN          AS end_yn,
               m.USER_ID         AS agent_ext_id,
               u.USER_CD         AS agent_code
          FROM tb_stt_master m
          LEFT JOIN user_m u ON u.USER_ID = m.USER_ID AND u.PROJ_CD = m.PROJ_CD
         WHERE m.UID = ? AND (? IS NULL OR m.PROJ_CD = ?)
         LIMIT 1`;
    const proj = projCd || null;
    const [rows] = await getPool().query(sql, [uid, proj, proj]);
    return rows?.[0] ?? null;
}

/**
 * 여러 UID 의 담당 상담사 코드를 한 번에 조회(백필용). UID → {agent_ext_id, agent_code}.
 * @param {string[]} uids
 * @param {string|null} projCd
 * @returns {Promise<Map<string,{agent_ext_id:string|null, agent_code:string|null}>>}
 */
export async function fetchAgentsByUids(uids, projCd) {
    const out = new Map();
    const list = (uids || []).filter(Boolean);
    if (!list.length) return out;
    const placeholders = list.map(() => '?').join(',');
    const proj = projCd || null;
    const sql = `
        SELECT m.UID AS uid, m.USER_ID AS agent_ext_id, u.USER_CD AS agent_code
          FROM tb_stt_master m
          LEFT JOIN user_m u ON u.USER_ID = m.USER_ID AND u.PROJ_CD = m.PROJ_CD
         WHERE m.UID IN (${placeholders}) AND (? IS NULL OR m.PROJ_CD = ?)`;
    const [rows] = await getPool().query(sql, [...list, proj, proj]);
    for (const r of rows) {
        out.set(String(r.uid), { agent_ext_id: r.agent_ext_id ?? null, agent_code: r.agent_code ?? null });
    }
    return out;
}

// tb_stt.SPEAKER 코드 → 내부 라벨. 표준 적재(ingestStandardCallToDb)가 '고객' 포함 여부로
// 화자를 판별하므로, ICS 영문 코드를 여기서 한글 라벨로 확정해 넘긴다(08 SPEAKER_LABEL 과 동일 의도).
//   customer/client → 고객, agent/voicebot/그 외 → 상담사.
function speakerLabel(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s.includes('cust') || s.includes('client') || s.includes('고객')) return '고객';
    return '상담사';
}

/**
 * UID 의 발화를 STT_SEQ 순으로 조립 → 표준 트랙 transcript 포맷.
 * 텍스트는 LM 후처리(DATA_LM) 우선, 없으면 원문(DATA).
 * @returns {Promise<Array<{turn_no, speaker:'고객'|'상담사', text}>>}
 */
export async function fetchTranscript(uid) {
    const sql = `
        SELECT STT_SEQ AS seq,
               SPEAKER AS speaker,
               COALESCE(NULLIF(TRIM(DATA_LM), ''), DATA) AS text
          FROM tb_stt
         WHERE UID = ?
         ORDER BY STT_SEQ ASC`;
    const [rows] = await getPool().query(sql, [uid]);
    const turns = [];
    let turnNo = 1;
    for (const r of rows) {
        const text = String(r.text ?? '').trim();
        if (!text) continue;
        turns.push({ turn_no: turnNo++, speaker: speakerLabel(r.speaker), text });
    }
    return turns;
}

/** 풀 종료(graceful shutdown 용). */
export async function closeIcsPool() {
    if (_pool) {
        const p = _pool;
        _pool = null;
        await p.end().catch(() => {});
    }
}
