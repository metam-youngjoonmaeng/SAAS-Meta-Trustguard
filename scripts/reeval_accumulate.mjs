// 데모 콜 재평가 누적 롤링 (자립형 — MTG 코어 무수정) —
//   원본 N건(오래된 순)을 qa-pipeline 으로 재평가하여 "새 유니크 ID"로 새 행 적재.
//
// 자립형: 이 스크립트가 PK 를 직접 `원본ID~YYYYMMDD-HHMMSS`(KST)로 만들어 넘긴다.
//   → 컨테이너의 기존 ingestStandardCallFromQaPipeline 을 "그대로" 호출(코어 수정·재기동 불필요).
//   새 ID 라 ON CONFLICT 미발동 = 순수 INSERT. 원본 자식은 DELETE 대상이 없어 무손상.
//
// 특성:
//   * 원본 절대 미변경(보존) — 소스는 원본만 선택('~' 복사본 제외 → 복사본의 복사본 방지)
//   * 매 실행 새 행 누적(덮어쓰기 없음) — run 당 단일 stamp 공유
//   * 복사본 보존정책: CDATE 가 ROLL_RETAIN_DAYS 일 이전인 '~' 복사본만 자동 삭제(원본 미삭제)
//
// 실행(api 컨테이너 안 · 크론/수동 공통) — 컨테이너에 scripts/ 미마운트라 stdin 주입:
//   docker exec -i -e ROLL_ORG=48 -e ROLL_PAT='%-0720' -e ROLL_PIPELINE_TARGET=ec2 -e ROLL_APPLY=1 \
//     09-meta-trustguard-api node --input-type=module - < reeval_accumulate.mjs
//
// 파라미터(env):
//   ROLL_ORG(51 로컬 은행 / 48 10.13 은행) ROLL_PAT(원본 ID 패턴) ROLL_N(회당, 기본 10)
//   ROLL_RETAIN_DAYS(복사본 보존일, 기본 30) ROLL_APPLY(1 일 때만 실제 평가/적재/정리 — 기본 dry-run)
//   ROLL_PIPELINE_TARGET('ec2' 면 원격 EC2 백엔드로 평가 — 로컬 8081 없는 10.13 필수. 빈값=기본 해석)
import pg from 'pg';
import { ingestStandardCallFromQaPipeline } from '/app/server/qaPipelineIngest.mjs';

const ORG = Number(process.env.ROLL_ORG || 51);
const PAT = process.env.ROLL_PAT || 'BANK-%';
const N = Number(process.env.ROLL_N || 10);
const RETAIN_DAYS = Number(process.env.ROLL_RETAIN_DAYS || 30);
const APPLY = process.env.ROLL_APPLY === '1';
const PIPELINE_TARGET = (process.env.ROLL_PIPELINE_TARGET || '').trim(); // 'ec2' = 원격 EC2 평가
const SEP = '~'; // 누적 PK 구분자 (URL-safe, 기존 ID 미사용 확인). PK = 원본ID~stamp

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); // 'YYYY-MM-DD HH:mm:ss'
const stamp = nowLocal.replace(/[-:]/g, '').replace(' ', '-'); // 'YYYYMMDD-HHMMSS' — run 당 공유

// 원본만(복사본 '~' 제외) 오래된 순 N건. 복사본을 소스로 재선택하지 않아 '복사본의 복사본' 방지.
const { rows: calls } = await pool.query(
  `SELECT "ID" AS id, "UID" AS uid, "CALL_SEQ" AS call_seq, "CDATE" AS cdate, proj_cd,
          agent_code, io_divi, duration_sec, department, role
     FROM public.qa_calls
    WHERE org_id=$1 AND "ID" LIKE $2 AND "ID" NOT LIKE '%'||$3||'%'
    ORDER BY "CDATE" ASC LIMIT $4`,
  [ORG, PAT, SEP, N]
);

console.log(`[reeval-accumulate] org=${ORG} pat=${PAT} n=${N} retain=${RETAIN_DAYS}d target=${PIPELINE_TARGET || 'local'} apply=${APPLY} stamp=${stamp} — 원본 대상 ${calls.length}건`);
for (const c of calls) console.log(`  ${c.id}  →  ${c.id}${SEP}${stamp}`);

if (!APPLY) {
  console.log('(dry-run — 평가/적재/정리 없음. 반영하려면 ROLL_APPLY=1)');
  await pool.end();
  process.exit(0);
}

let ok = 0;
for (const c of calls) {
  const { rows: turns } = await pool.query(
    `SELECT speaker, text FROM public.qa_call_transcript WHERE "ID"=$1 ORDER BY turn_no ASC`, [c.id]);
  const transcript = turns.map((t) => ({ speaker: t.speaker, text: t.text }));
  if (!transcript.length) { console.log(`  ${c.id}: 전사 0턴 — skip`); continue; }

  const newId = `${c.id}${SEP}${stamp}`; // ← 스크립트가 직접 유니크 ID 생성(코어 무의존)
  const call = {
    consultation_id: newId, qa_id: newId,
    uid: c.uid, call_seq: c.call_seq,
    cdate: nowLocal, org_id: ORG, proj_cd: c.proj_cd,
    agent_code: c.agent_code, io_divi: c.io_divi, duration_sec: c.duration_sec,
    department: c.department, role: c.role,
    ...(PIPELINE_TARGET ? { pipeline_target: PIPELINE_TARGET } : {}), // 10.13: 'ec2'
    transcript,
  };
  try {
    const r = await ingestStandardCallFromQaPipeline(pool, call, {});
    if (r && r.ok !== false) { ok += 1; console.log(`  ${newId}: OK raw=${r.raw_total}/${r.max_total} (${r.elapsed_sec}s)`); }
    else console.log(`  ${newId}: FAIL ${r?.message || '미상'}`);
  } catch (e) {
    console.log(`  ${newId}: ERROR ${e?.message || e}`);
  }
}

// 보존정책: '~' 복사본 중 원본부분이 패턴에 맞고 CDATE 가 RETAIN_DAYS 이전인 것만 삭제(원본 절대 미삭제)
const { rows: delRows } = await pool.query(
  `DELETE FROM public.qa_calls
    WHERE org_id=$1
      AND "ID" LIKE '%'||$2||'%'
      AND split_part("ID",$2,1) LIKE $3
      AND LEFT("CDATE",10) < to_char(((now() AT TIME ZONE 'Asia/Seoul')::date - ($4||' days')::interval), 'YYYY-MM-DD')
   RETURNING "ID"`,
  [ORG, SEP, PAT, RETAIN_DAYS]
);
console.log(`[reeval-accumulate] 완료 — 신규 적재 ${ok}/${calls.length}, 보존정책 삭제 ${delRows.length}건`);
if (delRows.length) console.log('  삭제:', delRows.map((r) => r.ID).join(', '));
await pool.end();
