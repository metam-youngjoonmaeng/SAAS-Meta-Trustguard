/**
 * IPCC `xhub.call_logs` 읽기 전용 — call(전화) 응답률/포기호. (08/TA ipcc/source.py 의 Node 포팅)
 *
 * 연결: autossh 사이드카('xhub-tunnel') 경유 → IPCC_DB_HOST(xhub-tunnel):13306.
 * env-gated: IPCC_DB_HOST 비면 ipccEnabled()=false → 모든 함수 no-op(null).
 * 계정: SELECT 전용 RO계정 xhub_ro (쓰기는 DB 권한 단계에서 ERROR 1142 거부).
 *
 * 포기호 정의(IPCC 공식 일치): center_id=<METAM> AND call_type='Inbound' AND is_end=1 AND seq=0 AND is_ans=0.
 * 테넌트 매핑: 우리 proj_cd ↔ centers.memo 또는 centers.userid. 조인키 call_logs.uid == mtm30.tb_stt.UID. TZ=KST.
 */

import mysql from 'mysql2/promise';
import { logger } from './logger.mjs';
import { env } from './util/common.mjs';


/** IPCC_DB_HOST 설정 시 활성. 미설정 시 전체 no-op. */
export function ipccEnabled() {
    return Boolean(env('IPCC_DB_HOST'));
}

let _pool = null;

function getPool() {
    if (!ipccEnabled()) throw new Error('IPCC 연결정보 미설정 (IPCC_DB_* 환경변수)');
    if (_pool === null) {
        _pool = mysql.createPool({
            host: env('IPCC_DB_HOST'),
            port: Number(env('IPCC_DB_PORT', '13306')) || 13306,
            user: env('IPCC_DB_USER'),
            password: process.env.IPCC_DB_PASSWORD ?? '',
            database: env('IPCC_DB_NAME', 'xhub'),
            charset: 'utf8mb4',
            waitForConnections: true,
            connectionLimit: Number(env('IPCC_DB_POOL', '3')) || 3,
            connectTimeout: 8000,
            dateStrings: true,
        });
        logger.info(
            `[ipcc] xhub 읽기풀 생성 — ${env('IPCC_DB_USER')}@${env('IPCC_DB_HOST')}:${env('IPCC_DB_PORT', '13306')}/${env('IPCC_DB_NAME', 'xhub')}`
        );
    }
    return _pool;
}

// 인입 완료콜(첫 세그먼트) 모집단 — 응답/포기 모두 여기서 계산.
const _BASE_WHERE = "call_type = 'Inbound' AND is_end = 1 AND seq = 0";

/**
 * call(인입전화) 응답률/포기호 집계 — xhub.call_logs 기준.
 * @returns {Promise<null|{total,responded,abandoned,abandon_ivr,abandon_ring,abandon_queue,answer_rate,abandon_rate}>}
 *   total=인입완료콜, responded=is_ans1(상담원연결), abandoned=is_ans0(포기). 미설정/오류 시 null.
 */
export async function callAnswerStats(projCd, dateFrom = null, dateTo = null) {
    if (!ipccEnabled()) return null;
    const proj = projCd || null;
    const sql = `
        SELECT
          COUNT(*)                                                                 AS total,
          SUM(is_ans = 1)                                                          AS responded,
          SUM(is_ans = 0)                                                          AS abandoned,
          SUM(is_ans = 0 AND queue_id IS NULL)                                     AS abandon_ivr,
          SUM(is_ans = 0 AND queue_id IS NOT NULL AND is_cbk = 0 AND user_id <> 0) AS abandon_ring,
          SUM(is_ans = 0 AND queue_id IS NOT NULL AND NOT(is_cbk = 0 AND user_id <> 0)) AS abandon_queue
        FROM call_logs
        WHERE ${_BASE_WHERE}
          AND (? IS NULL OR created_at >= ?)
          AND (? IS NULL OR created_at <  ?)
          AND (? IS NULL OR center_id IN (SELECT id FROM centers WHERE memo = ? OR userid = ?))`;
    try {
        const [rows] = await getPool().query(sql, [dateFrom, dateFrom, dateTo, dateTo, proj, proj, proj]);
        const r = rows && rows[0];
        if (!r) return null;
        const n = (v) => Number(v || 0);
        const total = n(r.total), responded = n(r.responded), abandoned = n(r.abandoned);
        return {
            total, responded, abandoned,
            abandon_ivr: n(r.abandon_ivr),
            abandon_ring: n(r.abandon_ring),
            abandon_queue: n(r.abandon_queue),
            answer_rate: total ? Math.round((responded / total) * 10000) / 10000 : null,
            abandon_rate: total ? Math.round((abandoned / total) * 10000) / 10000 : null,
        };
    } catch (e) {
        logger.error(`[ipcc] callAnswerStats 실패: ${e?.message || e}`);
        return null;
    }
}
