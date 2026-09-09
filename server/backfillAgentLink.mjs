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
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=trustguard,common,public -c timezone=Asia/Seoul' });

    // 통합DB: agent_code/uid=common.calls. proj_cd=upper(tenant_id)(ICS mtm30 조회는 대문자 PROJ_CD).
    const { rows } = await pool.query(
        `SELECT call_id AS id, uid, upper(tenant_id) AS proj_cd
           FROM common.calls
          WHERE agent_code IS NULL AND uid IS NOT NULL`
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
            // 통합DB: common.users.email 직접매칭(ICS 규약 {userCd}@{projCd}.ics, citext).
            const { rows: ur } = await pool.query(
                `SELECT id AS user_id FROM common.users WHERE email = $1 LIMIT 1`,
                [`${agentCode}@${projCd}.ics`]
            );
            const agentUserId = ur?.[0]?.user_id ?? null;
            await pool.query(
                `UPDATE common.calls SET agent_code = $2, agent_user_id = $3 WHERE call_id = $1`,
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
