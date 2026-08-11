/**
 * 임시 스크립트 — 로컬 3조건 평가 결과 번들을 MTG DB(org50)에 적재.
 *
 * 직접 INSERT 하지 않고 서버 정식 함수 `ingestStandardCallToDb` 를 그대로 호출한다
 * (qa_calls + qa_call_transcript + qa_call_item_score 를 한 트랜잭션으로 처리,
 *  '스킬 학습 제외' 지정 보존까지 동일 로직). MTG 소스 무수정.
 *
 * 입력: qa-pipeline 의 scripts/export_ab3_for_mtg.py 산출 번들 JSON.
 * 실행 후 이 파일은 삭제한다.
 *
 * 사용: node _tmp_ingest_ab3_bundle.mjs <bundle.json> [--dry]
 */
import fs from 'node:fs';

import pg from 'pg';

import { ingestStandardCallToDb } from './qaPipelineIngest.mjs';

const [, , bundlePath, ...flags] = process.argv;
const DRY = flags.includes('--dry');
if (!bundlePath) {
    console.error('사용: node _tmp_ingest_ab3_bundle.mjs <bundle.json> [--dry]');
    process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
console.log(`번들 ${bundle.length}콜 · dry=${DRY}`);

// 서버 본체(index.js:503)와 동일하게 DATABASE_URL 하나로 접속 — 개별 PG* env 는 컨테이너에 없다.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL 환경변수가 필요합니다.');
    process.exit(1);
}
const pool = new pg.Pool({ connectionString: databaseUrl });

let ok = 0;
let skipped = 0;
let failed = 0;
const problems = [];

for (const entry of bundle) {
    const qaId = entry?.call?.qa_id;
    if (DRY) {
        console.log(`  [dry] ${qaId} · 항목 ${entry.mapped.item_count} · 총점 ${entry.mapped.raw_total} · 턴 ${entry.call.transcript.length}`);
        ok += 1;
        continue;
    }
    try {
        const r = await ingestStandardCallToDb(pool, entry.call, entry.mapped);
        if (!r?.ok) {
            failed += 1;
            problems.push(`${qaId}: ${r?.message || 'unknown'}`);
        } else if (r.skipped) {
            skipped += 1;
            problems.push(`${qaId}: skipped — ${r.reason}`);
        } else {
            ok += 1;
            if (ok % 15 === 0) console.log(`  ... ${ok}콜 적재`);
        }
    } catch (e) {
        failed += 1;
        problems.push(`${qaId}: ${e?.message || e}`);
    }
}

console.log(`\n적재 ok=${ok} · skipped=${skipped} · failed=${failed}`);
if (problems.length) {
    console.log('문제:');
    for (const p of problems.slice(0, 20)) console.log(`  - ${p}`);
}

await pool.end();
