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
import { ingestGoldenSetToRag } from './qaPipelineIngest.mjs';
import { runSkillLearn } from './skillLearn.mjs';

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
        logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 미적재 — ${gateSkipReason(gate, durSec)} (통화시간 게이트)`);
        return 'gate_skip';
    }
    const transcript = await fetchTranscript(uid);
    if (!transcript.length) {
        logger.warn(`[ics-qa/mqtt] ${projCd}/${uid}: 미적재 — 발화 0건(상담사·고객 모두 없음)`);
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
        logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 미적재 — 포기호/미응대 (turns=${transcript.length})`);
        return 'empty';
    }
    logger.info(`[ics-qa/mqtt] ${projCd}/${uid}: 적재 OK (score=${result.total_score ?? '?'}, turns=${transcript.length}${result.elapsed_sec != null ? `, 검수 ${result.elapsed_sec}s` : ''})`);
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

/** 게이트 탈락 사유 — 최소/최대 어느 조건에 걸렸는지 로그용 문자열. */
function gateSkipReason(gate, durSec) {
    if (!gate || durSec == null) return '통화시간 미상';
    if (durSec < gate.minSec) return `통화시간 ${durSec}s < 최소 ${gate.minSec}s`;
    if (gate.maxSec != null && durSec >= gate.maxSec) return `통화시간 ${durSec}s ≥ 최대 ${gate.maxSec}s`;
    return `통화시간 ${durSec}s`;
}

/**
 * 배치 '주기' 설정(freq/time) — 수기평가 도장을 언제 찍을지. org 우선, 없으면 0.
 * 미설정/실패 시 realtime/02:00 기본. (통화시간 게이트와 별개 — 게이트 없어도 freq 는 유효)
 * @returns {Promise<{freq:string, time:string}>}
 */
async function readSchedule(pool, orgId) {
    try {
        const { rows } = await pool.query(
            `SELECT config FROM public.qa_batch_configs
              WHERE org_id = ANY($1) ORDER BY (org_id = $2) DESC LIMIT 1`,
            [[orgId, 0], orgId]
        );
        const scope = rows[0]?.config?.scope || {};
        return { freq: scope.freq || 'realtime', time: scope.time || '02:00' };
    } catch (e) {
        logger.warn(`[ics-qa] 배치주기 조회 실패(${e?.message || e}) — realtime 기본`);
        return { freq: 'realtime', time: '02:00' };
    }
}

/**
 * 골든셋 "학습 배치" 주기(freq/time) — 에이전트에 골든셋 학습을 언제 트리거할지. (도장 스케줄과 별개)
 * config.scope.goldenFreq/goldenTime 에 저장. 미설정 시 manual(자동 트리거 없음) 기본 → 기존 브랜드 무영향.
 * @returns {Promise<{freq:string, time:string}>}  freq ∈ hourly|daily|manual
 */
async function readGoldenSchedule(pool, orgId) {
    try {
        const { rows } = await pool.query(
            `SELECT config FROM public.qa_batch_configs
              WHERE org_id = ANY($1) ORDER BY (org_id = $2) DESC LIMIT 1`,
            [[orgId, 0], orgId]
        );
        const scope = rows[0]?.config?.scope || {};
        return { freq: scope.goldenFreq || 'manual', time: scope.goldenTime || '02:00' };
    } catch (e) {
        logger.warn(`[ics-qa] 골든셋 배치주기 조회 실패(${e?.message || e}) — manual 기본`);
        return { freq: 'manual', time: '02:00' };
    }
}

// 정기 도장(매시간/매일) 실행 시점 판정 — 30초 틱을 스케줄러로 재사용. 시각은 KST(UTC+9, 한국 무 DST).
// 인메모리 마커(구간키)로 같은 구간 1회만 실행. 재기동으로 마커가 리셋돼도 도장은 멱등이라 중복 무해.
const _lastStampKey = new Map(); // projCd → 마지막 실행 구간키
function dueForScheduledStamp(projCd, freq, time) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const dateKey = kst.toISOString().slice(0, 10); // YYYY-MM-DD (KST)
    const hour = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    let key;
    if (freq === 'hourly') {
        key = `${dateKey} ${String(hour).padStart(2, '0')}`; // 시간 버킷 — 매시간 정각 직후 1회
    } else if (freq === 'daily') {
        const [th, tm] = String(time || '02:00').split(':').map((n) => Number(n) || 0);
        if (hour < th || (hour === th && min < tm)) return false; // 아직 지정시각 전
        key = dateKey; // 일 버킷 — 지정시각 이후 첫 틱 1회
    } else {
        return false; // realtime/manual 은 정기 패스 대상 아님
    }
    if (_lastStampKey.get(projCd) === key) return false;
    _lastStampKey.set(projCd, key);
    return true;
}

/**
 * LLM 스킬 "학습 배치" 주기(freq/time) — 검수 정정 기반 스킬 학습을 언제 트리거할지. (골든과 별개)
 * config.scope.skillFreq/skillTime 에 저장. 미설정 시 manual(자동 트리거 없음) 기본 → 기존 브랜드 무영향.
 * @returns {Promise<{freq:string, time:string}>}  freq ∈ hourly|daily|manual
 */
async function readSkillSchedule(pool, orgId) {
    try {
        const { rows } = await pool.query(
            `SELECT config FROM public.qa_batch_configs
              WHERE org_id = ANY($1) ORDER BY (org_id = $2) DESC LIMIT 1`,
            [[orgId, 0], orgId]
        );
        const scope = rows[0]?.config?.scope || {};
        return { freq: scope.skillFreq || 'manual', time: scope.skillTime || '02:00' };
    } catch (e) {
        logger.warn(`[ics-qa] 스킬 배치주기 조회 실패(${e?.message || e}) — manual 기본`);
        return { freq: 'manual', time: '02:00' };
    }
}

// 골든셋 학습 배치 — 전용 스케줄러(startGoldenLearnScheduler)가 브랜드별 마커맵으로 같은 구간 1회만 발화.
const _lastGoldenKey = new Map(); // 'org:'+orgId → 마지막 골든셋 학습 실행 구간키
function dueForGoldenLearn(markerKey, freq, time) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const dateKey = kst.toISOString().slice(0, 10);
    const hour = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    let key;
    if (freq === 'hourly') {
        key = `${dateKey} ${String(hour).padStart(2, '0')}`;
    } else if (freq === 'daily') {
        const [th, tm] = String(time || '02:00').split(':').map((n) => Number(n) || 0);
        if (hour < th || (hour === th && min < tm)) return false;
        key = dateKey;
    } else {
        return false; // manual 은 정기 패스 대상 아님
    }
    if (_lastGoldenKey.get(markerKey) === key) return false;
    _lastGoldenKey.set(markerKey, key);
    return true;
}

// LLM 스킬 학습 배치 — 골든과 분리된 전용 마커맵(같은 구간 1회만 발화, 판정 로직은 골든 미러).
const _lastSkillKey = new Map(); // 'org:'+orgId → 마지막 스킬 학습 실행 구간키
function dueForSkillLearn(markerKey, freq, time) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const dateKey = kst.toISOString().slice(0, 10);
    const hour = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    let key;
    if (freq === 'hourly') {
        key = `${dateKey} ${String(hour).padStart(2, '0')}`;
    } else if (freq === 'daily') {
        const [th, tm] = String(time || '02:00').split(':').map((n) => Number(n) || 0);
        if (hour < th || (hour === th && min < tm)) return false;
        key = dateKey;
    } else {
        return false; // manual 은 정기 패스 대상 아님
    }
    if (_lastSkillKey.get(markerKey) === key) return false;
    _lastSkillKey.set(markerKey, key);
    return true;
}

/**
 * 정기 도장 패스 — tick 레벨에서 매 주기 호출(runOnce 조기 return 과 무관).
 * 매시간/매일 주기이고 실행 시점이면 in-scope 전체 미도장 대상에 도장(멱등·누적).
 */
async function scheduledStampTick(pool, cfg) {
    try {
        const orgId = await resolveOrgId(pool, cfg.projCd, cfg.orgIdOverride);
        if (!orgId) return;
        const sched = await readSchedule(pool, orgId);
        if ((sched.freq === 'hourly' || sched.freq === 'daily') && dueForScheduledStamp(cfg.projCd, sched.freq, sched.time)) {
            const stamped = await applyManualReviewStamps(pool, orgId, { qaIds: null });
            const label = sched.freq === 'daily' ? `매일 ${sched.time}` : '매시간';
            logger.info(`[ics-qa] ${cfg.projCd}: [${label}] 정기 도장 패스 실행 — ${stamped}건`);
        }
    } catch (e) {
        logger.warn(`[ics-qa] 정기 도장 패스 실패: ${e?.message || e}`);
    }
}

/**
 * 골든셋 학습 트리거 — 브랜드 골든셋을 백엔드 MTG 전용 RAG 인덱스(AOSS qa-mtg-golden)에 색인하는 단일 창구.
 * 실제 색인 본체는 qaPipelineIngest.ingestGoldenSetToRag (qa_golden_set ⋈ 전사 → 백엔드 색인 엔드포인트 호출,
 * golden_set 코어 무수정). dryRun(opts.dryRun) 지원 — AOSS 미기록 프리뷰. 과거 콜 재평가 아님(골든셋=학습용).
 * 호출원: 전용 스케줄러(startGoldenLearnScheduler) + 수동(POST /api/golden-learn/run).
 * @returns {Promise<{ok:boolean, triggered:boolean, ...}>}
 */
export async function triggerGoldenLearn(pool, orgId, opts = {}) {
    const projCd = opts.projCd || '';
    const tag = `org=${orgId}${projCd ? ` proj=${projCd}` : ''}${opts.source ? ` (${opts.source})` : ''}`;
    // 실제 골든셋 학습 = 브랜드 골든셋을 백엔드 MTG 전용 RAG 인덱스(qa-mtg-golden)에 색인.
    // 구현 본체는 qaPipelineIngest.ingestGoldenSetToRag (기존 백엔드 엔드포인트만 호출 — golden_set 코어 무수정).
    // dryRun(opts.dryRun) 지원 — '지금 실행' 검증 시 AOSS 미기록 프리뷰. 과거 콜 재평가 아님(골든셋=학습용).
    try {
        const result = await ingestGoldenSetToRag(pool, orgId, { dryRun: !!opts.dryRun, onProgress: opts.onProgress });
        logger.info(
            `[golden-learn] ${tag} — 골든 ${result.golden_count ?? '?'}건 → rubric=${result.rubric_id}` +
                `${result.dry_run ? ' (dry_run)' : ''} records=${result.records ?? '-'} saved=${result.saved ?? '-'} ok=${result.ok}`
        );
        return { ...result, org_id: orgId, source: opts.source };
    } catch (e) {
        logger.error(`[golden-learn] ${tag} 트리거 실패: ${e?.message || e}`);
        return { ok: false, triggered: false, reason: String(e?.message || e), org_id: orgId };
    }
}

// 골든셋 학습 전용 스케줄러 주기(약 60초). ICS 폴링 주기와 독립.
const GOLDEN_LEARN_INTERVAL_MS = 60000;

/**
 * 골든셋 학습 전용 스케줄러 — ICS 폴러(setInterval)와 독립된 자체 타이머(약 60초).
 * 매 틱마다 qa_batch_configs 에서 config.scope.goldenFreq ∈ {hourly,daily} 로 명시된 모든
 * 브랜드(org_id<>0)를 조회하고, 브랜드별 freq/time(readGoldenSchedule)으로 dueForGoldenLearn 판정
 * → 충족 org 만 triggerGoldenLearn 발화. 브랜드별로 따로따로 발화하며, ICS 접속(ICS_DB_*) 유무와
 * 무관하게 모든 배포에서 동작. goldenFreq 가 명시되지 않은 브랜드(기본 manual)는 자동 발화 안 함.
 * 한 org 실패가 전체를 멈추지 않게 org 별 try/catch. 부트 직후 1회 즉시 + 이후 주기 실행.
 * 재기동 시 인메모리 마커(_lastGoldenKey) 리셋으로 같은 버킷 재발화 가능하나, 색인
 * (ingestGoldenSetToRag) 이 skip_existing 멱등이라 중복 색인은 무해.
 *
 * hooks(선택) — 자동 발화를 대시보드에 실시간 노출하기 위한 UI 콜백(스케줄러는 UI 무지):
 *   onRunStart(orgId, sched)  발화 직전 — index.js 가 goldenLearnStatus=running 로 세팅.
 *   onProgress(orgId, p)      청크별 진척({processed,total,saved,...}) — 진행바 실시간 반영.
 *   onRunDone(orgId, result)  완료 — goldenLearnStatus=done + 알림 센터 통지.
 * 훅 예외는 학습 자체에 영향 주지 않게 삼킨다(색인은 이미 수행됨).
 * @returns {{stop: () => void}}
 */
export function startGoldenLearnScheduler(pool, hooks = {}) {
    let running = false;
    const tick = async () => {
        if (running) return; // 직전 틱이 끝나지 않았으면 건너뜀(동시중복 방지)
        running = true;
        try {
            // organizations JOIN — 삭제된 브랜드의 고아 설정 행(qa_batch_configs 잔존)은 자동 발화 제외.
            //   (예: org 38 hourly 잔존 → 매시 no_rubric_items 실패 알림 재발 방지)
            const { rows } = await pool.query(
                `SELECT c.org_id FROM public.qa_batch_configs c
                  JOIN public.organizations o ON o.id = c.org_id
                  WHERE c.org_id <> 0 AND (c.config #>> '{scope,goldenFreq}') IN ('hourly', 'daily')`
            );
            for (const row of rows) {
                const orgId = row.org_id;
                try {
                    const sched = await readGoldenSchedule(pool, orgId);
                    if ((sched.freq === 'hourly' || sched.freq === 'daily') && dueForGoldenLearn(`org:${orgId}`, sched.freq, sched.time)) {
                        const label = sched.freq === 'daily' ? `매일 ${sched.time}` : '매시간';
                        logger.info(`[golden-learn] org=${orgId}: [${label}] 정기 학습 트리거 발화`);
                        try { hooks.onRunStart?.(orgId, sched); } catch { /* UI 훅 실패는 학습에 무영향 */ }
                        const result = await triggerGoldenLearn(pool, orgId, {
                            source: `schedule:${sched.freq}`,
                            onProgress: typeof hooks.onProgress === 'function' ? (p) => hooks.onProgress(orgId, p) : undefined,
                        });
                        try { hooks.onRunDone?.(orgId, result); } catch { /* UI 훅 실패는 학습에 무영향 */ }
                    }
                } catch (e) {
                    logger.warn(`[golden-learn] org=${orgId} 정기 학습 패스 실패: ${e?.message || e}`);
                }
            }
        } catch (e) {
            logger.warn(`[golden-learn] 스케줄러 대상 조회 실패: ${e?.message || e}`);
        } finally {
            running = false;
        }
    };

    logger.info('[golden-learn] 골든셋 학습 스케줄러 활성 — 60초 주기(브랜드별 goldenFreq hourly/daily 발화)');
    // 부트 직후 1회 즉시 확인 + 이후 주기 실행.
    tick();
    const timer = setInterval(tick, GOLDEN_LEARN_INTERVAL_MS);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
}

/**
 * LLM 스킬 학습 트리거 — 검수 정정('낮음'/'높음') 케이스를 모아 백엔드에 항목별 보완 룰(overlay)
 * 생성을 위임하는 단일 창구. 실제 본체는 skillLearn.runSkillLearn (케이스 수집 → POST
 * /v2/mtg-skill/{rubric_id}/generate — 버전 저장·활성화는 qa-pipeline 담당, MTG DB 는 SELECT 만).
 * 호출원: 전용 스케줄러(startSkillLearnScheduler) + 수동(POST /api/skill-learn/run).
 * @returns {Promise<{ok:boolean, org_id:number, rubric_id?:string, version_id?:string|null,
 *                    case_count?:number, items_changed?:Array, activated?:boolean, error?:string}>}
 */
export async function triggerSkillLearn(pool, orgId, opts = {}) {
    const tag = `org=${orgId}${opts.source ? ` (${opts.source})` : ''}`;
    try {
        const result = await runSkillLearn(pool, orgId, { source: opts.source, onProgress: opts.onProgress });
        logger.info(
            `[skill-learn] ${tag} — 케이스 ${result.case_count ?? '?'}건 → rubric=${result.rubric_id}` +
                ` version=${result.version_id ?? '-'} changed=${(result.items_changed || []).length}` +
                ` activated=${!!result.activated} ok=${result.ok}${result.error ? ` error=${result.error}` : ''}`
        );
        return { ...result, org_id: orgId, source: opts.source };
    } catch (e) {
        logger.error(`[skill-learn] ${tag} 트리거 실패: ${e?.message || e}`);
        return { ok: false, error: String(e?.message || e), org_id: orgId, source: opts.source };
    }
}

// 스킬 학습 전용 스케줄러 주기(약 60초). 골든 스케줄러·ICS 폴링 주기와 독립.
const SKILL_LEARN_INTERVAL_MS = 60000;

/**
 * LLM 스킬 학습 전용 스케줄러 — startGoldenLearnScheduler 미러(자체 60초 타이머, 마커맵만 분리).
 * 매 틱마다 qa_batch_configs 에서 config.scope.skillFreq ∈ {hourly,daily} 로 명시된 모든
 * 브랜드(org_id<>0)를 조회하고, 브랜드별 freq/time(readSkillSchedule)으로 dueForSkillLearn 판정
 * → 충족 org 만 triggerSkillLearn 발화. skillFreq 미설정 브랜드(기본 manual)는 자동 발화 안 함.
 * 한 org 실패가 전체를 멈추지 않게 org 별 try/catch. 부트 직후 1회 즉시 + 이후 주기 실행.
 * 재기동 시 인메모리 마커(_lastSkillKey) 리셋으로 같은 버킷 재발화 가능하나, 생성은 새 버전
 * 추가일 뿐(활성 버전 교체) 평가 정합을 깨지 않는다.
 *
 * hooks(선택) — 자동 발화를 대시보드에 노출하기 위한 UI 콜백(골든 hooks 패턴 미러):
 *   onRunStart(orgId, sched)  발화 직전 — index.js 가 skillLearnStatus=running + 로그 적재.
 *   onProgress(orgId, p)      단계 전이({stage:'collect'|'generate', ...}) — 스킬 로그 적재.
 *   onRunDone(orgId, result)  완료 — skillLearnStatus=done/error + 로그 적재.
 * 훅 예외는 학습 자체에 영향 주지 않게 삼킨다.
 * @returns {{stop: () => void}}
 */
export function startSkillLearnScheduler(pool, hooks = {}) {
    let running = false;
    const tick = async () => {
        if (running) return; // 직전 틱이 끝나지 않았으면 건너뜀(동시중복 방지)
        running = true;
        try {
            // organizations JOIN — 삭제된 브랜드의 고아 설정 행은 자동 발화 제외(골든 스케줄러와 동일 가드).
            const { rows } = await pool.query(
                `SELECT c.org_id FROM public.qa_batch_configs c
                  JOIN public.organizations o ON o.id = c.org_id
                  WHERE c.org_id <> 0 AND (c.config #>> '{scope,skillFreq}') IN ('hourly', 'daily')`
            );
            for (const row of rows) {
                const orgId = row.org_id;
                try {
                    const sched = await readSkillSchedule(pool, orgId);
                    if ((sched.freq === 'hourly' || sched.freq === 'daily') && dueForSkillLearn(`org:${orgId}`, sched.freq, sched.time)) {
                        const label = sched.freq === 'daily' ? `매일 ${sched.time}` : '매시간';
                        logger.info(`[skill-learn] org=${orgId}: [${label}] 정기 학습 트리거 발화`);
                        try { hooks.onRunStart?.(orgId, sched); } catch { /* UI 훅 실패는 학습에 무영향 */ }
                        const result = await triggerSkillLearn(pool, orgId, {
                            source: `schedule:${sched.freq}`,
                            onProgress: typeof hooks.onProgress === 'function' ? (p) => hooks.onProgress(orgId, p) : undefined,
                        });
                        try { hooks.onRunDone?.(orgId, result); } catch { /* UI 훅 실패는 학습에 무영향 */ }
                    }
                } catch (e) {
                    logger.warn(`[skill-learn] org=${orgId} 정기 학습 패스 실패: ${e?.message || e}`);
                }
            }
        } catch (e) {
            logger.warn(`[skill-learn] 스케줄러 대상 조회 실패: ${e?.message || e}`);
        } finally {
            running = false;
        }
    };

    logger.info('[skill-learn] 스킬 학습 스케줄러 활성 — 60초 주기(브랜드별 skillFreq hourly/daily 발화)');
    // 부트 직후 1회 즉시 확인 + 이후 주기 실행.
    tick();
    const timer = setInterval(tick, SKILL_LEARN_INTERVAL_MS);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
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
    let skippedEmpty = 0;       // 발화 0건
    let skippedAbandoned = 0;   // 포기호/미응대
    let cursorEnd = wm.endDate;
    let cursorUid = wm.uid;
    const evaluatedIds = []; // 이번 주기에 평가·적재된 qa_id — 수기평가 대상 도장용

    for (const c of calls) {
        const uid = String(c.uid);
        const endDt = c.end_dt; // dateStrings → 'YYYY-MM-DD HH:mm:ss'
        const durSec = durationSecFromDates(c.start_dt, c.end_dt);
        // AI 1차 필터: 통화시간 범위 밖이면 평가 자체를 건너뜀(비용 절감). 커서는 전진(재처리 방지).
        if (outOfDurationGate(gate, durSec)) {
            logger.info(`[ics-qa] ${projCd}/${uid}: 미적재 — ${gateSkipReason(gate, durSec)} (통화시간 게이트, 커서 전진)`);
            cursorEnd = endDt;
            cursorUid = uid;
            skippedByGate += 1;
            continue;
        }
        try {
            const transcript = await fetchTranscript(uid);
            if (!transcript.length) {
                // END_YN='Y' 인데 발화가 없음 — 빈 콜로 보고 전진(무한 재시도 방지). 내용 생기면 ICS측 이슈.
                logger.warn(`[ics-qa] ${projCd}/${uid}: 미적재 — 발화 0건(상담사·고객 모두 없음, 커서 전진)`);
                cursorEnd = endDt;
                cursorUid = uid;
                skippedEmpty += 1;
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
                logger.info(`[ics-qa] ${projCd}/${uid}: 미적재 — 포기호/미응대(전진, turns=${transcript.length})`);
                skippedAbandoned += 1;
                continue;
            }
            added += 1;
            evaluatedIds.push(call.qa_id);
            logger.info(`[ics-qa] ${projCd}/${uid}: 적재 OK (score=${result.total_score ?? '?'}, turns=${transcript.length}${result.elapsed_sec != null ? `, 검수 ${result.elapsed_sec}s` : ''})`);
        } catch (err) {
            logger.error(`[ics-qa] ${projCd}/${uid}: 예외 — ${String(err?.message || err)} (이번 주기 중단)`);
            break;
        }
    }

    const skippedTotal = skippedByGate + skippedEmpty + skippedAbandoned;
    if (skippedTotal > 0) {
        logger.info(`[ics-qa] ${projCd}: 미적재 ${skippedTotal}건 (통화시간게이트 ${skippedByGate}, 발화0건 ${skippedEmpty}, 포기호 ${skippedAbandoned})`);
    }

    // 수기평가 대상 도장 — '실시간' 주기일 때만 이번에 평가된 콜을 즉시 표식(누적).
    //   매시간/매일은 tick 의 scheduledStampTick(정기 패스)이, 수동은 '지금 실행'(POST /api/batch/run)이 담당.
    if (evaluatedIds.length) {
        try {
            const sched = await readSchedule(pool, orgId);
            if (sched.freq === 'realtime') {
                const stamped = await applyManualReviewStamps(pool, orgId, { qaIds: evaluatedIds });
                if (stamped > 0) logger.info(`[ics-qa] ${projCd}: [실시간] 수기평가 대상 ${stamped}건 도장`);
            }
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
            // 정기 도장(매시간/매일)은 신규 콜 유무와 무관하게 매 틱 시점 확인. (ICS 전용)
            // 골든셋 학습 배치는 ICS 와 무관하게 startGoldenLearnScheduler(전용 스케줄러)가 단독 소유.
            await scheduledStampTick(pool, cfg);
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
