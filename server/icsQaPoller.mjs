/**
 * ICS(mtm30) → 09 QA 폴러.
 *
 * 08(TA)과 동일 주기(기본 30초)로 ICS MariaDB 의 종료 콜(END_YN='Y')을 가져와
 *   1) tb_stt 발화를 조립해 transcript 구성
 *   2) 기존 "표준 18항목 트랙"(ingestStandardCallFromQaPipeline)에 그대로 먹임 → qa-pipeline 평가 → 09 PG 적재
 *   3) (CALL_END_DATE, UID) 워터마크 전진
 * 으로 동작한다. 콜 멱등 적재는 qa_calls PK("ID") + ON CONFLICT 가 담당.
 *
 * 08과 동일 — ICS 접속(ICS_DB_*, SSO와 공유)이 설정돼 있으면 폴링. 별도 on/off 스위치 없음.
 * 미설정이면 no-op. (현재 prod 만 ICS_DB_* 설정 → prod 만 폴링, dev 는 자동 비활성)
 * env(전부 선택, 기본값으로 동작):
 *   ICS_QA_POLL_INTERVAL_MS  폴링 주기 (기본 30000 = 30초, 08과 동일)
 *   ICS_QA_PROJ_CD           대상 PROJ_CD (기본 'METAM')
 *   ICS_QA_ORG_ID            org_id 오버라이드 (기본: organizations.proj_cd 로 DB 조회)
 *   ICS_QA_POLL_LIMIT        1회 최대 처리 건수 (기본 50)
 *   ICS_QA_ID_PREFIX         qa_calls."ID" 네임스페이스 (기본 'ics:METAM:')
 */

import { icsEnabled, listCompletedCalls, fetchTranscript, maxCompletedEndDate, getCallMaster, durationSecFromDates } from './icsSource.mjs';
import { applyManualReviewStamps } from './manualReview.mjs';
import { logger } from './logger.mjs';

function env(key, def = '') {
    return String(process.env[key] ?? def).trim();
}

// PROJ_CD → org_id 매핑을 DB(organizations.proj_cd)에서 해석 — 08 과 동일하게 DB 기준.
// ICS_QA_ORG_ID(숫자)가 명시되면 그 값을 우선(오버라이드). 둘 다 없으면 null → 적재 중단.
async function resolveOrgId(pool, projCd, override) {
    if (override && override > 0) return override;
    const { rows } = await pool.query(
        `SELECT id FROM organizations WHERE upper(proj_cd) = upper($1) LIMIT 1`,
        [projCd]
    );
    return rows.length ? rows[0].id : null;
}

/** ICS QA 적재 공통 설정(폴러·MQTT 공용) — proj/org오버라이드/idPrefix. */
export function buildIcsQaCfg() {
    const projCd = env('ICS_QA_PROJ_CD', 'METAM');
    return {
        projCd,
        orgIdOverride: env('ICS_QA_ORG_ID') ? Number(env('ICS_QA_ORG_ID')) : null,
        idPrefix: env('ICS_QA_ID_PREFIX', `ics:${projCd}:`),
    };
}

/**
 * 단일 UID 즉시 적재 (MQTT finish 트리거용). 폴러 runOnce 의 콜 1건 처리와 동일 로직·동일 call 객체.
 * idPrefix 가 폴러와 같으므로 qa_calls PK(ON CONFLICT) 로 폴러와 멱등(중복 적재 없음).
 * @returns {Promise<'done'|'pending'|'empty'|'no_org'|'fail'>}
 *   pending = 아직 END_YN!='Y'(막판 STT 커밋 전) → 호출측이 settle 후 재시도.
 */
export async function ingestCallByUid(pool, cfg, uid, ingestStandardCallFromQaPipeline) {
    const projCd = cfg.projCd;
    const orgId = await resolveOrgId(pool, projCd, cfg.orgIdOverride);
    if (!orgId) {
        logger.error(`[ics-qa/mqtt] ${projCd}: organizations.proj_cd 매핑 브랜드 없음 — 적재 중단`);
        return 'no_org';
    }
    const master = await getCallMaster(uid, projCd);
    if (!master || String(master.end_yn || '').toUpperCase() !== 'Y') return 'pending';
    const durSec = durationSecFromDates(master.start_dt, master.end_dt);
    // AI 1차 필터: 통화시간 범위 밖이면 평가 건너뜀(비용 절감).
    const gate = await readDurationGate(pool, orgId);
    if (outOfDurationGate(gate, durSec)) {
        logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 통화시간 ${durSec}s — 범위 밖, AI 평가 제외`);
        return 'gate_skip';
    }
    const transcript = await fetchTranscript(uid);
    if (!transcript.length) {
        logger.warn(`[ics-qa/mqtt] ${projCd}/${uid}: 발화 0건 — 건너뜀`);
        return 'empty';
    }
    const call = {
        consultation_id: `${cfg.idPrefix}${uid}`,
        qa_id: `${cfg.idPrefix}${uid}`,
        uid,
        call_seq: uid,
        cdate: master.end_dt,         // 상담 종료시각 = cdate (폴러와 동일)
        org_id: orgId,
        proj_cd: projCd,
        agent_code: master.agent_code ?? null, // 담당 상담사 업무키(user_m.USER_CD)
        io_divi: master.io_divi ?? null,        // 채널구분 'I'(인바운드)/'O'(아웃바운드)
        duration_sec: durSec,                   // 통화 소요시간(초) — 게이트 판정에 쓴 값 재사용
        pipeline_target: 'ec2',
        transcript,
    };
    const result = await ingestStandardCallFromQaPipeline(pool, call, {});
    if (!result || result.ok === false) {
        logger.error(`[ics-qa/mqtt] ${projCd}/${uid}: 적재 실패 — ${result?.message || '미상'}`);
        return 'fail';
    }
    if (result.skipped) {
        logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 포기호/미응대 — 적재 건너뜀 (turns=${transcript.length})`);
        return 'empty';
    }
    logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 적재 OK (score=${result.total_score ?? '?'}, turns=${transcript.length})`);
    return 'done';
}

async function readWatermark(pool, projCd) {
    const { rows } = await pool.query(
        `SELECT last_call_end_date, last_uid FROM ics_qa_poll_watermark WHERE proj_cd = $1`,
        [projCd]
    );
    if (!rows.length) return { endDate: null, uid: null, exists: false };
    return { endDate: rows[0].last_call_end_date, uid: rows[0].last_uid, exists: true };
}

async function writeWatermark(pool, { projCd, orgId, endDate, uid, added }) {
    await pool.query(
        `INSERT INTO ics_qa_poll_watermark (proj_cd, org_id, last_call_end_date, last_uid, processed_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (proj_cd) DO UPDATE SET
            org_id = EXCLUDED.org_id,
            last_call_end_date = EXCLUDED.last_call_end_date,
            last_uid = EXCLUDED.last_uid,
            processed_count = ics_qa_poll_watermark.processed_count + EXCLUDED.processed_count,
            updated_at = now()`,
        [projCd, orgId, endDate, uid, added]
    );
}

/**
 * AI 1차 필터 — 배치 설정(qa_batch_configs)의 통화시간 범위를 평가 게이트로 읽는다.
 * org 우선, 없으면 0(전체/기본). config 자체가 없거나 사실상 무제한(0~∞)이면 null
 * → 게이트 없음(전수평가 유지, 안전 기본값 — 실수로 평가가 멈추지 않도록).
 * @returns {Promise<{minSec:number, maxSec:number|null, freq:string}|null>}
 */
async function readDurationGate(pool, orgId) {
    try {
        const { rows } = await pool.query(
            `SELECT config FROM public.qa_batch_configs
              WHERE org_id = ANY($1) ORDER BY (org_id = $2) DESC LIMIT 1`,
            [[orgId, 0], orgId]
        );
        const scope = rows[0]?.config?.scope;
        if (!scope) return null;
        const minMin = Number(scope.minMin);
        const maxMin = Number(scope.maxMin);
        const minSec = Number.isFinite(minMin) && minMin > 0 ? Math.round(minMin * 60) : 0;
        const maxSec = Number.isFinite(maxMin) && maxMin > 0 ? Math.round(maxMin * 60) : null;
        if (minSec === 0 && maxSec === null) return null; // 무제한 = 게이트 없음
        return { minSec, maxSec, freq: scope.freq || 'realtime' };
    } catch (e) {
        logger.warn(`[ics-qa] 통화시간 게이트 조회 실패(${e?.message || e}) — 게이트 없이 진행`);
        return null;
    }
}

/** 통화시간(초)이 게이트 범위 밖인지. gate=null 이면 항상 false(전수평가). */
function outOfDurationGate(gate, durSec) {
    if (!gate || durSec == null) return false; // 미상(null)은 제외하지 않음 — 안전상 평가
    return durSec < gate.minSec || (gate.maxSec != null && durSec >= gate.maxSec);
}

/**
 * 폴러 1회 실행 — 종료 콜을 워터마크 이후부터 순차 적재.
 * 실패한 콜에서 멈추고(워터마크는 직전 성공까지만) 다음 주기에 재시도한다.
 */
async function runOnce(pool, cfg, ingestStandardCallFromQaPipeline) {
    const { projCd, orgIdOverride, limit, idPrefix } = cfg;

    const orgId = await resolveOrgId(pool, projCd, orgIdOverride);
    if (!orgId) {
        logger.error(`[ics-qa] ${projCd}: organizations.proj_cd 에 매핑된 브랜드 없음 — 적재 중단 (해당 브랜드에 proj_cd='${projCd}' 설정 필요)`);
        return;
    }

    const wm = await readWatermark(pool, projCd);

    // 최초 기동: 과거 전체 백필을 피하려 워터마크를 '현재 최신 완료시각'으로 시드하고 이번 틱 종료
    // → 이후부터 새로 종료되는 콜만 처리 (08 _poll_ics_completed 와 동일).
    if (!wm.exists) {
        const seed = await maxCompletedEndDate(projCd);
        await writeWatermark(pool, { projCd, orgId, endDate: seed, uid: null, added: 0 });
        logger.info(`[ics-qa] ${projCd}: 첫 기동 시드=${seed ?? '없음'} (과거 백필 생략, 이후 신규콜만)`);
        return;
    }

    const calls = await listCompletedCalls(projCd, wm.endDate, wm.uid, limit);
    if (!calls.length) return;

    logger.info(`[ics-qa] ${projCd}: 종료 콜 ${calls.length}건 후보 (after=${wm.endDate ?? '처음'})`);

    // AI 1차 필터: 배치 설정의 통화시간 범위(있으면). 주기마다 1회 읽어 이번 주기 전체에 적용.
    const gate = await readDurationGate(pool, orgId);
    if (gate) logger.info(`[ics-qa] ${projCd}: AI 1차 필터 통화시간 [${gate.minSec}, ${gate.maxSec ?? '∞'}]초 적용`);

    let added = 0;
    let skippedByGate = 0;
    let cursorEnd = wm.endDate;
    let cursorUid = wm.uid;
    const evaluatedIds = []; // 이번 주기에 평가·적재된 qa_id — 수기평가 대상 도장용

    for (const c of calls) {
        const uid = String(c.uid);
        const endDt = c.end_dt; // dateStrings → 'YYYY-MM-DD HH:mm:ss'
        const durSec = durationSecFromDates(c.start_dt, c.end_dt);
        // AI 1차 필터: 통화시간 범위 밖이면 평가 자체를 건너뜀(비용 절감). 커서는 전진(재처리 방지).
        if (outOfDurationGate(gate, durSec)) {
            logger.info(`[ics-qa] ${projCd}/${uid}: 통화시간 ${durSec}s — 범위 밖, AI 평가 제외(전진)`);
            cursorEnd = endDt;
            cursorUid = uid;
            skippedByGate += 1;
            continue;
        }
        try {
            const transcript = await fetchTranscript(uid);
            if (!transcript.length) {
                // END_YN='Y' 인데 발화가 없음 — 빈 콜로 보고 전진(무한 재시도 방지). 내용 생기면 ICS측 이슈.
                logger.warn(`[ics-qa] ${projCd}/${uid}: 발화 0건 — 건너뜀(전진)`);
                cursorEnd = endDt;
                cursorUid = uid;
                continue;
            }
            // department/role 은 넘기지 않는다 — 적재 함수가 "그 org 기존 콜 최다 부서 > 기본('고객지원실')"
            // 으로 알아서 귀속(ingestStandardCallToDb). 폴러가 부서를 고정하지 않음.
            const call = {
                consultation_id: `${idPrefix}${uid}`,
                qa_id: `${idPrefix}${uid}`,
                uid,
                call_seq: uid,
                cdate: endDt,
                org_id: orgId,
                proj_cd: projCd,
                agent_code: c.agent_code ?? null, // 담당 상담사 업무키(user_m.USER_CD) — 적재 시 agent_user_id 해석
                io_divi: c.io_divi ?? null,        // 채널구분 'I'(인바운드)/'O'(아웃바운드)
                duration_sec: durSec,              // 통화 소요시간(초) — 게이트 판정에 쓴 값 재사용
                pipeline_target: 'ec2', // 운영 평가 백엔드 = EC2(54.235.200.151:8081), UI(SampleUpload)와 동일
                transcript,
            };
            const result = await ingestStandardCallFromQaPipeline(pool, call, {});
            if (!result || result.ok === false) {
                logger.error(`[ics-qa] ${projCd}/${uid}: 적재 실패 — ${result?.message || '미상'} (이번 주기 중단, 다음 주기 재시도)`);
                break; // 워터마크를 직전 성공까지만 전진 → 다음 주기 재시도
            }
            // 성공/포기호 공통으로 커서 전진(재처리 방지). 포기호는 적재 없이 건너뜀.
            cursorEnd = endDt;
            cursorUid = uid;
            if (result.skipped) {
                logger.info(`[ics-qa] ${projCd}/${uid}: 포기호/미응대 — 적재 건너뜀(전진, turns=${transcript.length})`);
                continue;
            }
            added += 1;
            evaluatedIds.push(call.qa_id);
            logger.info(`[ics-qa] ${projCd}/${uid}: 적재 OK (score=${result.total_score ?? '?'}, turns=${transcript.length})`);
        } catch (err) {
            logger.error(`[ics-qa] ${projCd}/${uid}: 예외 — ${String(err?.message || err)} (이번 주기 중단)`);
            break;
        }
    }

    if (skippedByGate > 0) logger.info(`[ics-qa] ${projCd}: 통화시간 게이트로 ${skippedByGate}건 AI 평가 제외`);

    // 수기평가 대상 도장 — 이번에 평가된 콜을 카드 조건으로 즉시 표식(실시간 누적).
    if (evaluatedIds.length) {
        try {
            const stamped = await applyManualReviewStamps(pool, orgId, { qaIds: evaluatedIds });
            if (stamped > 0) logger.info(`[ics-qa] ${projCd}: 수기평가 대상 ${stamped}건 도장`);
        } catch (e) { logger.warn(`[ics-qa] 수기평가 도장 실패: ${e?.message || e}`); }
    }

    if (cursorEnd !== wm.endDate || cursorUid !== wm.uid || added > 0) {
        await writeWatermark(pool, { projCd, orgId, endDate: cursorEnd, uid: cursorUid, added });
        if (added > 0) logger.info(`[ics-qa] ${projCd}: ${added}건 적재, 워터마크 → ${cursorEnd}`);
    }
}

/**
 * 폴러 기동. env-gated — 비활성 시 null 반환(no-op).
 * @returns {{stop: () => void}|null}
 */
export function startIcsQaPoller(pool, { ingestStandardCallFromQaPipeline }) {
    // 08과 동일 — ICS 접속(ICS_DB_*)이 설정돼 있으면 폴링한다. 별도 on/off 스위치 없음.
    if (!icsEnabled()) {
        logger.info('[ics-qa] ICS_DB_* 미설정 — ICS QA 폴러 비활성(no-op)');
        return null;
    }

    const cfg = {
        projCd: env('ICS_QA_PROJ_CD', 'METAM'),
        // 매핑은 organizations.proj_cd(DB) 기준. ICS_QA_ORG_ID 는 선택적 오버라이드(보통 비움).
        orgIdOverride: env('ICS_QA_ORG_ID') ? Number(env('ICS_QA_ORG_ID')) : null,
        limit: Number(env('ICS_QA_POLL_LIMIT', '50')) || 50,
        idPrefix: env('ICS_QA_ID_PREFIX', `ics:${env('ICS_QA_PROJ_CD', 'METAM')}:`),
    };
    const intervalMs = Number(env('ICS_QA_POLL_INTERVAL_MS', '30000')) || 30000;

    logger.info(
        `[ics-qa] 폴러 활성 — proj=${cfg.projCd} org=${cfg.orgIdOverride ? `${cfg.orgIdOverride}(override)` : 'DB(proj_cd)'} 주기=${intervalMs}ms limit=${cfg.limit}`
    );

    let running = false;
    const tick = async () => {
        if (running) return; // 직전 주기가 아직 끝나지 않았으면 건너뜀(중첩 방지)
        running = true;
        try {
            await runOnce(pool, cfg, ingestStandardCallFromQaPipeline);
        } catch (err) {
            logger.error(`[ics-qa] 폴링 주기 오류: ${String(err?.message || err)}`);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    // 기동 직후 1회 즉시 실행하지 않고 첫 주기까지 대기 — 부팅 race 회피.
    return { stop: () => clearInterval(timer) };
}
