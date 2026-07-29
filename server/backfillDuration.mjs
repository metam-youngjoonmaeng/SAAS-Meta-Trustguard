/**
 * 기존 qa_calls 의 통화 소요시간(duration_sec) 일회성/멱등 백필.
 *
 *   qa_calls.UID ──(ICS tb_stt_master: CALL_END_DATE-CALL_START_DATE)──▶ duration_sec(초)
 *
 * ICS 콜(proj_cd 존재)만 대상. 비-ICS/시드 콜은 통화시각이 없어 그대로 둔다(NULL).
 * 멱등: duration_sec 가 아직 비어 있는 행만 채운다. ICS(ICS_DB_*) + PG(DATABASE_URL) 필요.
 *
 * 실행:  docker exec 09-meta-trustguard-api node /app/server/backfillDuration.mjs
 */
import pg from 'pg';
import { icsEnabled, fetchDurationByUids, closeIcsPool } from './icsSource.mjs';

const { Pool } = pg;

async function main() {
    if (!icsEnabled()) {
        console.error('[backfill-dur] ICS_DB_* 미설정 — ICS 조회 불가. 중단.');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=trustguard,common,public' });

    const { rows } = await pool.query(
        `SELECT "ID" AS id, "UID" AS uid, proj_cd
           FROM qa_calls
          WHERE duration_sec IS NULL AND proj_cd IS NOT NULL AND "UID" IS NOT NULL`
    );
    console.log(`[backfill-dur] 대상 콜 ${rows.length}건`);
    if (!rows.length) { await pool.end(); await closeIcsPool(); return; }

    const byProj = new Map();
    for (const r of rows) {
        if (!byProj.has(r.proj_cd)) byProj.set(r.proj_cd, []);
        byProj.get(r.proj_cd).push(r);
    }

    let filled = 0, miss = 0;
    for (const [projCd, calls] of byProj) {
        const durMap = await fetchDurationByUids(calls.map((c) => c.uid), projCd);
        for (const c of calls) {
            const dur = durMap.get(String(c.uid));
            if (dur === null || dur === undefined || !Number.isFinite(dur)) { miss += 1; continue; }
            await pool.query(`UPDATE qa_calls SET duration_sec = $2 WHERE "ID" = $1`, [c.id, Math.round(dur)]);
            filled += 1;
        }
    }
    console.log(`[backfill-dur] 완료 — 채움 ${filled}, ICS소요시간없음 ${miss}`);
    await pool.end();
    await closeIcsPool();
}

main().catch((e) => { console.error('[backfill-dur] 실패:', e); process.exit(1); });
