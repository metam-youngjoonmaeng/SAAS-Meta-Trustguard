/**
 * AICC 음성봇 MQTT 실시간 STT 스트림(/asr-result) 구독 — 전화(call) 한정. 읽기 전용.
 * (08/TA 의 mqtt_listener.py 와 동일 설계의 Node 포팅)
 *
 * env-gated: MQTT_HOST 비면 전부 no-op. 채우면 자동 활성화.
 *
 * 토픽: /asr-result/<PROJ>:<uid>/<dir>/<role>/<tail>
 *   - <PROJ>:<uid> → proj_cd + uid(= tb_stt.UID, 'METAM:' 만 떼면 동일)
 *   - role = agent/customer/voicebot
 *   - ⚠️ customer tail = 고객 전화번호(PII) → 절대 저장/로깅 안 함 (proj/uid/role 만)
 *
 * payload.state: silent-repeat/append(무시), cut-full/cut-end(확정발화→표시), finish(종료 신호)
 *
 * 용도:
 *   ① 실시간 현황   — 메모리 레지스트리(진행중 통화/라이브 전사), GET /api/realtime/active-calls
 *   ② 종료 즉시 적재 — finish 시 30초 폴링 안 기다리고 그 uid 를 즉시 QA 평가/적재.
 *                      settle 후 END_YN='Y' 게이트로 재시도. 폴러는 안전망으로 병행.
 *                      (TA 입력은 DB(tb_stt) 기준 / 실시간 표시는 MQTT — 소스가 달라 미세차 가능)
 *   ※ 전화(call) 전용 — 채팅/게시판은 안 옴.
 */

import mqtt from 'mqtt';
import { logger } from './logger.mjs';
import { icsEnabled } from './icsSource.mjs';
import { ingestCallByUid, buildIcsQaCfg } from './icsQaPoller.mjs';
import { env } from './util/common.mjs';

function envInt(key, def) {
    const n = Number(env(key));
    return Number.isFinite(n) && n > 0 ? n : def;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FINAL_STATES = new Set(['cut-full', 'cut-end']);
const TRANSCRIPT_MAX = envInt('MQTT_TRANSCRIPT_MAX', 50);
const ACTIVE_TTL_MS = envInt('MQTT_ACTIVE_TTL_SEC', 120) * 1000;

// ───────────── 실시간 활성콜 레지스트리 (표시 전용, PII 미저장) ─────────────
const _calls = new Map(); // key → { proj_cd, uid, agent_ext, started_at, last_seen, ended_at, transcript[] }
const _keyOf = (proj, uid) => `${proj || '-'}:${uid}`;

function observe(proj, uid, role, state, text, agentExt) {
    if (!uid) return;
    const k = _keyOf(proj, uid);
    let st = _calls.get(k);
    const now = new Date().toISOString();
    if (!st) {
        st = { proj_cd: proj, uid, agent_ext: agentExt || null, started_at: now, last_seen: now, ended_at: null, transcript: [] };
        _calls.set(k, st);
    }
    st.last_seen = now;
    if (agentExt && !st.agent_ext) st.agent_ext = agentExt;
    if (FINAL_STATES.has(state) && text && text !== 'None') {
        st.transcript.push({ role, text, at: now });
        if (st.transcript.length > TRANSCRIPT_MAX) st.transcript.shift();
    }
}
function markEnded(proj, uid) {
    const st = _calls.get(_keyOf(proj, uid));
    if (st && !st.ended_at) st.ended_at = new Date().toISOString();
}
function evict() {
    const now = Date.now();
    for (const [k, st] of _calls) {
        const ref = Date.parse(st.ended_at || st.last_seen);
        const ttl = st.ended_at ? ACTIVE_TTL_MS : ACTIVE_TTL_MS * 2;
        if (Number.isFinite(ref) && now - ref > ttl) _calls.delete(k);
    }
}
/** 진행중(+최근 종료) 통화 스냅샷. 전화번호(PII) 없음. */
export function getActiveCalls(includeEnded = true) {
    evict();
    let out = [..._calls.values()].map((st) => ({ ...st, active: st.ended_at === null }));
    if (!includeEnded) out = out.filter((c) => c.active);
    out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return out;
}

// ───────────── 토픽 파싱 ─────────────
function parseTopic(topic) {
    const parts = String(topic || '').split('/').filter((p) => p !== '');
    if (parts.length < 4 || parts[0] !== 'asr-result') return null;
    const projuid = parts[1];
    let proj = null;
    let uid = projuid;
    const i = projuid.indexOf(':');
    if (i >= 0) {
        proj = projuid.slice(0, i);
        uid = projuid.slice(i + 1);
    }
    const role = String(parts[3] || '').toLowerCase();
    const tail = parts[4] ?? null; // customer=전화번호(PII)
    return { proj: proj || null, uid, role, tail };
}

// ───────────── 구독 클라이언트 ─────────────
/**
 * MQTT 리스너 기동. env-gated — MQTT_HOST 없으면 null(no-op).
 * @returns {{stop:()=>void}|null}
 */
export function startMqttListener(pool, { ingestStandardCallFromQaPipeline }) {
    const host = env('MQTT_HOST');
    if (!host) {
        logger.info('[mqtt] MQTT_HOST 미설정 — STT 스트림 구독 비활성(no-op)');
        return null;
    }
    if (!icsEnabled()) {
        logger.warn('[mqtt] ICS_DB_* 미설정 — finish 즉시적재 불가(실시간 현황만 동작)');
    }

    const port = envInt('MQTT_PORT', 1883);
    const topic = env('MQTT_ASR_TOPIC', '/asr-result/#');
    const projFilter = new Set(
        env('MQTT_PROJ_FILTER').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    );
    const settleMs = envInt('MQTT_INGEST_SETTLE_SEC', 3) * 1000;
    const retries = envInt('MQTT_INGEST_RETRIES', 5);
    const retryMs = envInt('MQTT_INGEST_RETRY_INTERVAL_SEC', 3) * 1000;
    const cfg = buildIcsQaCfg();
    const finished = new Set(); // uid 중복 트리거 방지

    const useTls = ['1', 'true', 'yes'].includes(env('MQTT_TLS').toLowerCase());
    const url = `${useTls ? 'mqtts' : 'mqtt'}://${host}:${port}`;
    const client = mqtt.connect(url, {
        clientId: env('MQTT_CLIENT_ID', 'trustguard-qa-asr-stream'),
        username: env('MQTT_USERNAME') || undefined,
        password: process.env.MQTT_PASSWORD || undefined,
        clean: true,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
    });

    client.on('connect', () => {
        client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) logger.error(`[mqtt] subscribe 실패 ${topic}: ${err.message}`);
            else logger.info(`[mqtt] connected — subscribed ${topic}`);
        });
    });
    client.on('reconnect', () => logger.warn('[mqtt] 재연결 시도'));
    client.on('error', (e) => logger.error(`[mqtt] error: ${e?.message || e}`));

    async function ingestSoon(proj, uid) {
        const t0 = Date.now();
        await sleep(settleMs);
        let status = 'pending';
        for (let i = 1; i <= retries; i++) {
            try {
                status = await ingestCallByUid(pool, { ...cfg, projCd: proj || cfg.projCd }, uid, ingestStandardCallFromQaPipeline);
            } catch (e) {
                status = `error:${e?.message || e}`;
            }
            if (status !== 'pending') break;
            await sleep(retryMs);
        }
        logger.info(`[mqtt] finish→ingest proj=${proj} uid=${uid} status=${status} 총${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    client.on('message', (topicStr, payload) => {
        try {
            const t = parseTopic(topicStr);
            if (!t) return;
            if (projFilter.size && !projFilter.has(String(t.proj || '').toUpperCase())) return;
            let msg;
            try {
                msg = JSON.parse(payload.toString('utf8'));
            } catch {
                return;
            }
            const state = String(msg.state || '').trim();
            const text = FINAL_STATES.has(state) ? msg['real-time'] : null;
            const agentExt = t.role === 'agent' ? t.tail : null; // customer tail=전화번호라 안 씀
            observe(t.proj, t.uid, t.role, state, text, agentExt);

            if (state === 'finish') {
                markEnded(t.proj, t.uid);
                const k = _keyOf(t.proj, t.uid);
                if (finished.has(k)) return; // 화자별 finish 2개 → uid 당 1회만
                finished.add(k);
                if (finished.size > 5000) finished.clear();
                if (icsEnabled()) void ingestSoon(t.proj, t.uid);
            }
        } catch {
            /* 개별 메시지 예외는 무시 (루프 보호) */
        }
    });

    logger.info(`[mqtt] connecting ${url} topic=${topic} proj_filter=${[...projFilter].join(',') || 'ALL'} settle=${settleMs}ms`);
    return { stop: () => { try { client.end(true); } catch { /* noop */ } } };
}
