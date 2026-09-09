/**
 * 기존 qa_calls 의 채널구분(io_divi) 일회성 백필.
 *
 *   qa_calls.UID ──(ICS tb_stt_master.IO_DIVI)──▶ 'I'(인바운드)/'O'(아웃바운드)
 *
 * ICS 콜(proj_cd 존재)만 대상. 비-ICS/시드 콜은 채널 정보가 없어 그대로 둔다(NULL).
 * 멱등: io_divi 가 아직 비어 있는 행만 채운다. ICS 연결정보(ICS_DB_*) + PG(DATABASE_URL) 필요.
 *
 * 실행:  docker exec 09-meta-trustguard-api node /app/server/backfillIoDivi.mjs
 */
import pg from 'pg';
import { icsEnabled, fetchIoDiviByUids, closeIcsPool } from './icsSource.mjs';

const { Pool } = pg;

async function main() {
    if (!icsEnabled()) {
        console.error('[backfill-io] ICS_DB_* 미설정 — ICS 조회 불가. 중단.');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=trustguard,common,public -c timezone=Asia/Seoul' });

    // 통합DB: io_divi/uid=common.calls. proj_cd=upper(tenant_id)(ICS mtm30 조회는 대문자 PROJ_CD).
    const { rows } = await pool.query(
        `SELECT call_id AS id, uid, upper(tenant_id) AS proj_cd
           FROM common.calls
          WHERE io_divi IS NULL AND uid IS NOT NULL`
    );
    console.log(`[backfill-io] 대상 콜 ${rows.length}건`);
    if (!rows.length) { await pool.end(); await closeIcsPool(); return; }

    const byProj = new Map();
    for (const r of rows) {
        if (!byProj.has(r.proj_cd)) byProj.set(r.proj_cd, []);
        byProj.get(r.proj_cd).push(r);
    }

    let filled = 0, miss = 0;
    for (const [projCd, calls] of byProj) {
        const ioMap = await fetchIoDiviByUids(calls.map((c) => c.uid), projCd);
        for (const c of calls) {
            const raw = String(ioMap.get(String(c.uid)) ?? '').trim().toUpperCase();
            const io = raw === 'I' || raw === 'O' ? raw : null;
            if (!io) { miss += 1; continue; }
            await pool.query(`UPDATE common.calls SET io_divi = $2 WHERE call_id = $1`, [c.id, io]);
            filled += 1;
        }
    }
    console.log(`[backfill-io] 완료 — 채움 ${filled}, ICS채널없음 ${miss}`);
    await pool.end();
    await closeIcsPool();
}

main().catch((e) => { console.error('[backfill-io] 실패:', e); process.exit(1); });
