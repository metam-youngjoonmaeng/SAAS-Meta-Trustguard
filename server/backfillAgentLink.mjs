/**
 * 기존 qa_calls 의 담당 상담사 연결(agent_code/agent_user_id) 일회성 백필.
 *
 *   qa_calls.UID  ──(ICS tb_stt_master)──▶ USER_ID ──(user_m)──▶ USER_CD(=agent_code)
 *                                                   └─ admin_users(login_id='{code}@{proj}') ─▶ agent_user_id
 *
 * ICS 콜(proj_cd 존재)만 대상. 비-ICS/시드 콜은 상담사 정보가 없어 그대로 둔다(미지정).
 * 멱등: agent_code 가 아직 비어 있는 행만 채운다. ICS 연결정보(ICS_DB_*) + PG(DATABASE_URL) 필요.
 *
 * 실행:  docker exec 09-meta-trustguard-api node /app/server/backfillAgentLink.mjs
 */
import pg from 'pg';
import { icsEnabled, fetchAgentsByUids, closeIcsPool } from './icsSource.mjs';

const { Pool } = pg;

async function main() {
    if (!icsEnabled()) {
        console.error('[backfill] ICS_DB_* 미설정 — ICS 조회 불가. 중단.');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=trustguard,common,public' });

    // agent_code 미지정 + proj_cd 있는(=ICS) 콜만
    const { rows } = await pool.query(
        `SELECT "ID" AS id, "UID" AS uid, proj_cd
           FROM qa_calls
          WHERE agent_code IS NULL AND proj_cd IS NOT NULL AND "UID" IS NOT NULL`
    );
    console.log(`[backfill] 대상 콜 ${rows.length}건`);
    if (!rows.length) { await pool.end(); await closeIcsPool(); return; }

    // proj_cd 별로 UID 묶어 ICS 일괄조회
    const byProj = new Map();
    for (const r of rows) {
        if (!byProj.has(r.proj_cd)) byProj.set(r.proj_cd, []);
        byProj.get(r.proj_cd).push(r);
    }

    let linked = 0, codeOnly = 0, miss = 0;
    for (const [projCd, calls] of byProj) {
        const agentMap = await fetchAgentsByUids(calls.map((c) => c.uid), projCd);
        for (const c of calls) {
            const a = agentMap.get(String(c.uid));
            const agentCode = a?.agent_code ?? null;
            if (!agentCode) { miss += 1; continue; }
            // admin_users 매칭(icsSso 규칙: login_id = lower('{code}@{proj}'))
            const { rows: ur } = await pool.query(
                `SELECT user_id FROM admin_users WHERE lower(login_id) = lower($1) LIMIT 1`,
                [`${agentCode}@${projCd}`]
            );
            const agentUserId = ur?.[0]?.user_id ?? null;
            await pool.query(
                `UPDATE qa_calls SET agent_code = $2, agent_user_id = $3 WHERE "ID" = $1`,
                [c.id, agentCode, agentUserId]
            );
            if (agentUserId) linked += 1; else codeOnly += 1;
        }
    }
    console.log(`[backfill] 완료 — 계정연결 ${linked}, 코드만(계정없음) ${codeOnly}, ICS상담사없음 ${miss}`);
    await pool.end();
    await closeIcsPool();
}

main().catch((e) => { console.error('[backfill] 실패:', e); process.exit(1); });
