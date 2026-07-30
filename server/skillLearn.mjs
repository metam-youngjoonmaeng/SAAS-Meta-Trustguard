/**
 * LLM 스킬 학습 체인 — 검수자 정정 케이스('낮음'/'높음') 기반 브랜드×항목별 보완 룰(overlay) 생성.
 *
 * 골든 RAG 체인(qaPipelineIngest.ingestGoldenSetToRag)의 완전 동형 미러:
 *   ① rubric_id 해석 = getOrgFewshot(rag_rubric_id) || inline-org{N} — 생성·조회 키 정합
 *   ② buildRubricFromDefs 로 order_no→item_number(RUBRIC_ITEM_BASE+index)/max_score 맵 산출
 *      + 루브릭 파일스토어 사전 등록(POST /v2/rubrics, 멱등·실패 무시)
 *   ③ 정정 케이스 수집(qa_call_item_score ⋈ qa_calls — 승인콜·비샌드박스,
 *      manual_eval_option ∈ '낮음'|'높음') + 콜단위 검수사유(qa_call_review_event 최신 1건, 일괄 조회)
 *   ④ POST {base}/v2/mtg-skill/{rubric_id}/generate (auto_activate) — 버전 생성·저장·활성화는
 *      qa-pipeline 담당(MTG 는 프록시·수집만)
 *
 * DB 는 SELECT 만(스키마 불변) — 실행 상태는 index.js 인메모리 Map, 버전 저장은 qa-pipeline 파일.
 * base URL 은 골든 학습과 동일(EC2 타깃 기본, QA_PIPELINE_FORCE_LOCAL 이 우선).
 */

import { resolvePipelineBaseUrl } from './qaPipelineIngest.mjs';
import { buildRubricFromDefs } from './rubricSync.mjs';
import { getOrgFewshot } from './ragFewshotConfig.mjs';
import { logger } from './logger.mjs';

// 루브릭 트랙 항목 번호 기준값 — eval_item_number = RUBRIC_ITEM_BASE + index (qaPipelineIngest 와 동일).
const RUBRIC_ITEM_BASE = 5000;
const GENERATE_TIMEOUT_MS = 600_000; // overlay 생성(LLM 다건) 타임아웃
const PROXY_TIMEOUT_MS = 15_000; // 버전 조회/활성화/설정 프록시 타임아웃
const RUBRIC_REGISTER_TIMEOUT_MS = 30_000; // 루브릭 사전 등록(멱등) 타임아웃
const EVIDENCE_CAP = 1000; // 근거 발화(agent_utterance) 상한
const CALL_REASON_CAP = 500; // 콜단위 검수사유 상한
const DEFAULT_CASE_LIMIT = 200; // 케이스 수집 기본 상한(최신순)

function safeStr(value) {
    return value === null || value === undefined ? '' : String(value);
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** 스킬 학습 base URL — 골든 학습(ingestGoldenSetToRag)과 동일하게 EC2 타깃 기본. */
function resolveSkillBaseUrl(opts = {}) {
    return resolvePipelineBaseUrl({ pipeline_target: 'ec2' }, opts).replace(/\/+$/, '');
}

/** rubric_id 해석 — 골든 색인과 동일 규칙(getOrgFewshot.rubric_id → inline-org{N} 폴백). */
async function resolveSkillRubricId(pool, orgId) {
    try {
        const fx = await getOrgFewshot(pool, orgId);
        return fx && fx.rubric_id ? fx.rubric_id : `inline-org${orgId}`;
    } catch {
        return `inline-org${orgId}`;
    }
}

/** 루브릭 파일스토어 등록(멱등) — 파이프라인 load_rubric 게이트 충족용. 항목 없으면 false. */
async function registerRubricForOrg(pool, orgId, rubricId, base) {
    const { rubric } = await buildRubricFromDefs(pool, orgId);
    if (!rubric || !(rubric.items && rubric.items.length)) return false;
    const resp = await fetch(`${base}/v2/rubrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rubric, rubric_id: rubricId, name: rubric.name || `org${orgId}` }),
        signal: AbortSignal.timeout(RUBRIC_REGISTER_TIMEOUT_MS),
    });
    return resp.ok;
}

/**
 * 격리키 변경 자동 이관(auto-heal) — RAG few-shot 설정 저장/해제로 rubric_id 해석이 바뀌면
 * (예: inline-org42 → rbrc_org42) 기존 스킬 버전이 옛 키 아래 미아가 된다. 현재 키에 버전이
 * 없을 때 옛 후보 키(qa_skill_store 의 이 org 행 + 규칙상 두 형태)를 뒤져 버전이 있으면
 * 파이프라인 adopt 로 스토어를 통째 이관하고 qa_skill_store 행 키도 승계한다.
 * @returns {Promise<boolean>} 이관 발생 여부
 */
async function adoptLegacySkillStore(pool, orgId, rubricId, base, { register = true } = {}) {
    const candidates = new Set([`rbrc_org${orgId}`, `inline-org${orgId}`]);
    try {
        const { rows } = await pool.query('SELECT rubric_id FROM qa_skill_store WHERE tenant_id = $1', [orgId]);
        for (const r of rows) candidates.add(safeStr(r.rubric_id).trim());
    } catch {
        /* 메모리 테이블 조회 실패 — 규칙 후보만으로 진행 */
    }
    candidates.delete(rubricId);
    candidates.delete('');
    for (const cand of candidates) {
        const alt = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(cand)}/versions`);
        if (!Array.isArray(alt?.versions) || !alt.versions.length) continue;
        // 새 키가 루브릭 레지스트리에 없으면 /versions 가 rubric_not_found 라 등록을 선행(멱등).
        //   등록 불가(항목 없음 — 예: 삭제된 브랜드)면 이관해도 새 키로 조회가 안 되므로 중단.
        if (register) {
            try {
                const registered = await registerRubricForOrg(pool, orgId, rubricId, base);
                if (!registered) {
                    logger.warn(`[skill-learn] rubric 등록 불가(org ${orgId} 항목 없음) — 격리키 이관 생략`);
                    continue;
                }
            } catch (e) {
                logger.warn(`[skill-learn] 이관 전 rubric 등록 실패 — 격리키 이관 생략: ${e?.message || e}`);
                continue;
            }
        }
        const mig = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/adopt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_rubric_id: cand }),
        });
        if (mig?.ok) {
            // 메모리 행 키 승계 — 새 키 행이 이미 있으면(학습이 새 키로 이미 돈 경우) 보존, 옛 행 유지.
            try {
                await pool.query(
                    `UPDATE qa_skill_store
                        SET rubric_id = $2,
                            memory = jsonb_set(memory, '{rubric_id}', to_jsonb($2::text))
                      WHERE rubric_id = $1
                        AND NOT EXISTS (SELECT 1 FROM qa_skill_store m2 WHERE m2.rubric_id = $2)`,
                    [cand, rubricId]
                );
            } catch (e) {
                logger.warn(`[skill-learn] 메모리 키 이관 실패(버전 이관은 유효): ${e?.message || e}`);
            }
            logger.info(
                `[skill-learn] 스킬 스토어 격리키 이관 — org ${orgId}: ${cand} → ${rubricId} (버전 ${mig.version_count ?? '?'}개)`
            );
            return true;
        }
    }
    return false;
}

/**
 * order_no → item_number/만점 맵 — ingestGoldenSetToRag 의 매핑 로직 동일 미러.
 * buildRubricFromDefs 는 items[].eval_item_number 를 부여하지 않고(백엔드 normalize_rubric 이
 * 5000+index 로 부여) items/rowMeta 가 동일 루프 index 정합이므로 RUBRIC_ITEM_BASE+index 로 산출.
 * 만점은 rubric.items[i].max_score(eval_item_defs) 우선, rowMeta[i].max_score 폴백.
 */
function buildOrderMaps(rubric, rowMeta) {
    const orderToItemNum = {};
    const orderToMaxScore = {};
    (rowMeta || []).forEach((m, i) => {
        const o = asNumber(m && m.order_no);
        if (o !== null) {
            orderToItemNum[o] = RUBRIC_ITEM_BASE + i;
            const mx = asNumber((rubric.items[i] && rubric.items[i].max_score) ?? (m && m.max_score));
            if (mx !== null && mx > 0) orderToMaxScore[o] = mx;
        }
    });
    return { orderToItemNum, orderToMaxScore };
}

/** 'YYYY-MM-DD HH:mm' 표기 — pg 타임스탬프(Date)·문자열 모두 수용, 실패 시 null(필드 생략). */
function fmtDateTime(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 16);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 라벨용 KST 현재 시각('YYYY-MM-DD HH:mm') — 스케줄러 시간버킷과 동일하게 UTC+9 고정. */
function kstNowLabel() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    return kst.toISOString().slice(0, 16).replace('T', ' ');
}

/** 배치 설정의 스킬 제외 항목(config.skill.excluded, order_no 배열). org 우선, 없으면 0(전체). */
async function readSkillExcludedOrders(pool, orgId) {
    try {
        const { rows } = await pool.query(
            `SELECT config FROM qa_batch_configs
              WHERE tenant_id = ANY($1) ORDER BY (tenant_id = $2) DESC LIMIT 1`,
            [[orgId, '__default__'], orgId]
        );
        const ex = rows[0]?.config?.skill?.excluded;
        return Array.isArray(ex) ? ex.map(Number).filter(Number.isFinite) : [];
    } catch (e) {
        logger.warn(`[skill-learn] 스킬 제외 항목 조회 실패(제외 없이 진행): ${e?.message || e}`);
        return [];
    }
}

/**
 * 정정 케이스 수집 — 승인(review_status='approved')·비샌드박스 콜의 항목행 중 검수자가
 * '낮음'(AI 과소평가)/'높음'(AI 과대평가) 정정 판단을 내린 행. 근거 발화는 qa_call_item_score.agent_utterance
 * (같은 order_no) LEFT JOIN, 콜단위 검수사유는 qa_call_review_event 최신 1건(qa_id 묶음 일괄 조회).
 * @returns {Promise<{rows:Array, callReasons:Object}>}
 */
export async function collectSkillCases(pool, orgId, { limit = DEFAULT_CASE_LIMIT } = {}) {
    const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.trunc(Number(limit)) : DEFAULT_CASE_LIMIT;
    // 통합DB: 헤더=common.calls(source_id/tenant_id/cdate), 평가=trustguard.qa_evaluations(review_status/is_sandbox), 항목=eval_item_score(call_id).
    //   외부 케이스 식별자 qa_id=source_id, 검수사유는 eval_review_event(call_id) → source_id 로 재키.
    const { rows } = await pool.query(
        `SELECT c.source_id AS qa_id, c.call_id AS call_id, er.order_no, er.category, er.item,
                er.ai_eval, er.manual_eval_option, er.reason_text,
                er.agent_utterance, c.tenant_id AS org_id, c.cdate AS "CDATE"
           FROM eval_item_score er
           JOIN common.calls c ON c.call_id = er.call_id
           JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
          WHERE e.review_status = 'approved' AND e.is_sandbox = false
            AND c.tenant_id = $1 AND er.manual_eval_option IN ('낮음','높음')
            AND er.skill_excluded_at IS NULL
          ORDER BY c.cdate DESC LIMIT $2`,
        [orgId, lim]
    );
    if (!rows.length) return { rows: [], callReasons: {} };
    // 콜단위 검수사유 — call_id 묶음 1회 조회(call_id 별 최신 1건) 후 source_id 로 재키. 없으면 생략.
    const callReasons = {};
    try {
        const callIds = [...new Set(rows.map((r) => r.call_id))];
        const { rows: ev } = await pool.query(
            `SELECT DISTINCT ON (call_id) call_id, reason
               FROM eval_review_event
              WHERE call_id = ANY($1::bigint[]) AND reason IS NOT NULL
              ORDER BY call_id, id DESC`,
            [callIds]
        );
        const reasonByCall = new Map(ev.map((e) => [String(e.call_id), safeStr(e.reason).trim()]));
        for (const r of rows) {
            const reason = reasonByCall.get(String(r.call_id));
            if (reason) callReasons[String(r.qa_id)] = reason;
        }
    } catch (e) {
        logger.warn(`[skill-learn] 콜단위 검수사유 조회 실패(생략하고 진행): ${e?.message || e}`);
    }
    return { rows, callReasons };
}

/**
 * 스킬 학습 실행 본체 — 계약 §4 흐름 1~6.
 *   1) rubric_id 해석(골든과 동일) → 2) 루브릭 사전 등록(멱등) → 3) 케이스 수집(0건이면 조기 반환)
 *   → 4) POST /v2/mtg-skill/{rubric}/generate (auto_activate:true, label='{source} {KST시각}')
 * onProgress(선택): { stage:'collect'|'generate'|'memory', ... } 단계 전이 통지 — 호출측 로그/상태용.
 *   memory 단계는 message 완성문 동봉(로드/저장/미반환 3종) — 호출측은 그대로 스킬 로그에 적재.
 * @returns {Promise<{ok:boolean, org_id:number, rubric_id:string, version_id?:string|null,
 *                    case_count:number, items_changed?:Array, activated?:boolean, error?:string}>}
 */
/**
 * qa_skill_store 에서 브랜드 메모리(memory.json 전체 blob) 로드 — 부재/오류 시 빈 골격.
 * 파이프라인 load_memory(rubric_id) 와 정합하는 스키마({schema_version, rubric_id, items}).
 */
async function loadSkillMemory(pool, rubricId) {
    try {
        const { rows } = await pool.query('SELECT memory FROM qa_skill_store WHERE rubric_id = $1', [rubricId]);
        const mem = rows[0]?.memory;
        if (mem && typeof mem === 'object' && !Array.isArray(mem)) return mem;
    } catch (e) {
        logger.warn(`[skill-learn] 메모리 로드 실패(빈 골격으로 진행): ${e?.message || e}`);
    }
    return { schema_version: 1, rubric_id: rubricId, items: {} };
}

/**
 * 학습 응답의 최종 메모리(blob)를 qa_skill_store 에 UPSERT — rubric_id 단위 통째 교체.
 * 쓰기 주체가 학습 마감 1회뿐 + 동시 학습 already_running 가드라 blob 통째 저장이라도 경합 없음.
 */
async function saveSkillMemory(pool, rubricId, orgId, memory) {
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return false;
    try {
        await pool.query(
            `INSERT INTO qa_skill_store (rubric_id, tenant_id, memory, updated_at)
                 VALUES ($1, $2, $3::jsonb, now())
             ON CONFLICT (rubric_id) DO UPDATE
                SET memory = EXCLUDED.memory, tenant_id = EXCLUDED.tenant_id, updated_at = now()`,
            [rubricId, orgId, JSON.stringify(memory)]
        );
        return true;
    } catch (e) {
        logger.warn(`[skill-learn] 메모리 저장 실패(학습 결과는 유효): ${e?.message || e}`);
        return false;
    }
}

/**
 * 메모리 blob 통계 — 스킬 로그 표기용. 항목 수·누적 정정 수·모순 의심 노트 수.
 * 파이프라인 note_contested 가 남기는 journal note prefix("[검수 기준 불일치 의심]") 카운트.
 */
function skillMemoryStats(mem) {
    const items = mem && typeof mem === 'object' && mem.items && typeof mem.items === 'object' ? mem.items : {};
    let itemCount = 0;
    let caseCount = 0;
    let contested = 0;
    for (const it of Object.values(items)) {
        if (!it || typeof it !== 'object') continue;
        itemCount += 1;
        caseCount += Array.isArray(it.cases) ? it.cases.length : 0;
        const journal = Array.isArray(it.journal) ? it.journal : [];
        contested += journal.filter((e) => String(e?.note || '').startsWith('[검수 기준 불일치 의심]')).length;
    }
    return { itemCount, caseCount, contested };
}

// 메모리 요약 캡 — 실시간 로그 토글 조회 페이로드 상한(blob 자체 캡: evidence 500 등과 별개).
const MEM_SUMMARY_CASES = 20; // 항목당 최근 케이스
const MEM_SUMMARY_JOURNAL = 5; // 항목당 최근 학습 기록(journal)

/**
 * 브랜드 에이전트 메모리 요약 — 실시간 로그 '메모리' 행 토글 조회용(읽기 전용, SELECT 만).
 * qa_skill_store blob 을 항목별로 정리: 방향 통계·최근 케이스·패턴·journal·last_learned·effect.
 * 항목명 매핑(buildRubricFromDefs) 실패는 무해 — 번호만 표시.
 */
export async function fetchSkillMemorySummary(pool, orgId) {
    const rubricId = await resolveSkillRubricId(pool, orgId);
    let mem = null;
    let updatedAt = null;
    try {
        const { rows } = await pool.query('SELECT memory, updated_at FROM qa_skill_store WHERE rubric_id = $1', [rubricId]);
        mem = rows[0]?.memory ?? null;
        updatedAt = rows[0]?.updated_at ?? null;
    } catch (e) {
        return { ok: false, rubric_id: rubricId, error: String(e?.message || e) };
    }
    const numToName = {};
    try {
        const { rubric } = await buildRubricFromDefs(pool, orgId);
        for (const it of rubric?.items || []) numToName[Number(it.eval_item_number)] = safeStr(it.name);
    } catch {
        /* 항목명 매핑 실패 — 번호만 표시 */
    }
    const src = mem && typeof mem === 'object' && mem.items && typeof mem.items === 'object' ? mem.items : {};
    const items = Object.entries(src)
        .map(([no, it]) => {
            if (!it || typeof it !== 'object') return null;
            const cases = (Array.isArray(it.cases) ? it.cases : []).filter((c) => c && typeof c === 'object');
            const journal = (Array.isArray(it.journal) ? it.journal : []).filter((j) => j && typeof j === 'object');
            return {
                item_number: asNumber(no),
                item_name: numToName[Number(no)] || '',
                case_count: cases.length,
                dir_high: cases.filter((c) => safeStr(c.direction).trim() === '높음').length,
                dir_low: cases.filter((c) => safeStr(c.direction).trim() === '낮음').length,
                contested: journal.filter((j) => safeStr(j.note).startsWith('[검수 기준 불일치 의심]')).length,
                // blob 은 call_at 오름차순 유지 — 최근 N 건을 최신순으로.
                cases: cases.slice(-MEM_SUMMARY_CASES).reverse(),
                patterns: Array.isArray(it.patterns) ? it.patterns : [],
                journal: journal.slice(-MEM_SUMMARY_JOURNAL).reverse(),
                last_learned: it.last_learned && typeof it.last_learned === 'object' ? it.last_learned : null,
                effect: it.effect && typeof it.effect === 'object' ? it.effect : {},
            };
        })
        .filter(Boolean)
        .sort((a, b) => (a.item_number ?? 0) - (b.item_number ?? 0));
    return { ok: true, rubric_id: rubricId, updated_at: updatedAt, items };
}

/* ── 스킬셋 버전 DB 영속(qa_skill_store) ─────────────────────────────
 * 배경(2026-07-07): 스킬 버전·룰 원문은 파이프라인 디스크 파일로만 저장되어 배포 스왑 시
 * 소실(org4 사고). 변이(학습/활성화/설정) 후 파이프라인 store-dump 를 받아 PG 에 통째 보관하고,
 * 파이프라인 스토어가 비어 있으면 보관본을 store-restore 로 되밀어 자가 복원한다.
 * 소유 모델은 qa_skill_store 와 동일 — DB(=이 서버의 PG)가 생존 계층, 파이프라인 파일은 작업 사본. */

let _skillVersionsTableReady = null;
function ensureSkillVersionsTable(_pool) {
    // 통합DB: trustguard.qa_skill_store(tenant_id citext) 는 통합 init(20_qa.sql)이 소유·생성.
    //   런타임 CREATE TABLE(구 org_id/public.organizations 스키마)은 통합에서 유해 → no-op.
    if (!_skillVersionsTableReady) _skillVersionsTableReady = Promise.resolve();
    return _skillVersionsTableReady;
}

/** PG 보관본({store, files, manifests}) 로드 — 부재/오류 시 null. */
async function loadSkillStoreBackup(pool, rubricId) {
    try {
        await ensureSkillVersionsTable(pool);
        const { rows } = await pool.query('SELECT store FROM qa_skill_store WHERE rubric_id = $1', [rubricId]);
        const s = rows[0]?.store;
        if (s && typeof s === 'object' && !Array.isArray(s)) return s;
    } catch (e) {
        logger.warn(`[skill-learn] 스킬셋 보관본 로드 실패: ${e?.message || e}`);
    }
    return null;
}

/** 파이프라인 store-dump → PG 통째 upsert. 버전 0건 dump 는 저장하지 않음(빈 스토어가 보관본을 덮는 사고 방지). */
async function persistSkillStore(pool, orgId, rubricId, base) {
    try {
        const dump = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/store-dump`);
        if (dump?.ok !== true || !dump.store || !Array.isArray(dump.store.versions) || !dump.store.versions.length) {
            return false;
        }
        await ensureSkillVersionsTable(pool);
        await pool.query(
            `INSERT INTO qa_skill_store (rubric_id, tenant_id, store, updated_at)
                 VALUES ($1, $2, $3::jsonb, now())
             ON CONFLICT (rubric_id) DO UPDATE
                SET store = EXCLUDED.store, tenant_id = EXCLUDED.tenant_id, updated_at = now()`,
            [rubricId, orgId, JSON.stringify({ store: dump.store, files: dump.files || {}, manifests: dump.manifests || {} })]
        );
        return true;
    } catch (e) {
        logger.warn(`[skill-learn] 스킬셋 DB 영속 실패(기능 무영향): ${e?.message || e}`);
        return false;
    }
}

/** PG 보관본 → 파이프라인 무조건 되밀기(멱등 merge — 누락 버전만 복원, 기존 무손상).
 *  MTG DB 소유 모델의 주입 경로: DB 가 원본, 파이프라인 파일은 작업 사본. 성공(ok) 여부 반환. */
async function pushSkillStoreBackup(pool, rubricId, base) {
    const backup = await loadSkillStoreBackup(pool, rubricId);
    if (!backup?.store || !Array.isArray(backup.store.versions) || !backup.store.versions.length) return false;
    const r = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/store-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
    });
    if (r?.ok === true && Array.isArray(r.restored_versions) && r.restored_versions.length > 0) {
        logger.info(`[skill-learn] 스킬셋 보관본 주입 — ${rubricId}: ${r.restored_versions.join(', ')}`);
    }
    return r?.ok === true;
}

/** 파이프라인 버전 0건 & PG 보관본 존재 → store-restore 자가 복원. 복원했으면 true. */
async function restoreSkillStoreIfEmpty(pool, rubricId, base) {
    const cur = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/versions`);
    if (Array.isArray(cur?.versions) && cur.versions.length) return false;
    return pushSkillStoreBackup(pool, rubricId, base);
}

/**
 * 활성 스킬 overlay 맵 — MTG DB 보관본(qa_skill_store)에서 직접 산출(파이프라인 무조회).
 * 평가 요청 동봉(metadata.skill_overlays)용: {item_number(str): overlay md}. 학습 제외 항목 제외.
 * 활성 버전 부재/보관본 부재/오류 전부 null — 호출측은 미동봉(기존 거동)으로 폴백.
 */
export async function getActiveSkillOverlays(pool, orgId) {
    try {
        const rubricId = await resolveSkillRubricId(pool, orgId);
        const backup = await loadSkillStoreBackup(pool, rubricId);
        const store = backup?.store;
        const active = store?.active_version_id;
        if (!active) return null;
        const entry = (store.versions || []).find((v) => v && v.version_id === String(active));
        const itemsMap = entry && typeof entry.items === 'object' ? entry.items : null;
        if (!itemsMap) return null;
        const excluded = new Set((store.excluded_items || []).map((n) => String(n)));
        const overlays = {};
        for (const [no, info] of Object.entries(itemsMap)) {
            if (excluded.has(String(no))) continue;
            const rel = info && typeof info === 'object' ? info.file : null;
            const md = rel ? backup.files?.[String(rel)] : null;
            if (typeof md === 'string' && md.trim()) overlays[String(no)] = md;
        }
        return Object.keys(overlays).length ? { rubric_id: rubricId, version_id: String(active), overlays } : null;
    } catch (e) {
        logger.warn(`[skill-learn] 활성 overlay 산출 실패(평가 미동봉으로 폴백): ${e?.message || e}`);
        return null;
    }
}

export async function runSkillLearn(pool, orgId, opts = {}) {
    const source = opts.source || 'manual';
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const emit = (payload) => {
        if (!onProgress) return;
        try {
            onProgress(payload);
        } catch {
            /* UI 훅 예외는 학습에 무영향 */
        }
    };
    const base = resolveSkillBaseUrl(opts);

    // ① rubric_id — 골든 색인과 동일 규칙(생성·평가 조회 키 정합).
    const rubricId = await resolveSkillRubricId(pool, orgId);

    // ② 루브릭 빌드 + order_no→item_number/만점 맵 (골든 ② 미러).
    const { rubric, rowMeta } = await buildRubricFromDefs(pool, orgId);
    if (!rubric || !(rubric.items && rubric.items.length)) {
        return { ok: false, org_id: orgId, rubric_id: rubricId, case_count: 0, error: 'no_rubric_items' };
    }
    const { orderToItemNum, orderToMaxScore } = buildOrderMaps(rubric, rowMeta);

    // 루브릭 파일스토어 사전 등록(load_rubric 게이트 충족 — 멱등, 실패 무시. 골든과 동일 패턴).
    try {
        await fetch(`${base}/v2/rubrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...rubric, rubric_id: rubricId, name: rubric.name || `org${orgId}` }),
            signal: AbortSignal.timeout(RUBRIC_REGISTER_TIMEOUT_MS),
        });
    } catch (e) {
        logger.warn(`[skill-learn] rubric 등록 실패(무시 — generate 응답에서 확인): ${e?.message || e}`);
    }

    // 격리키 변경 자동 이관 — 옛 키에 미아가 된 버전/메모리를 현재 키로 승계(부모 lineage 유지).
    //   위에서 등록을 이미 마쳤으므로 register:false.
    try {
        await adoptLegacySkillStore(pool, orgId, rubricId, base, { register: false });
    } catch (e) {
        logger.warn(`[skill-learn] 격리키 이관 시도 실패(신규 키로 진행): ${e?.message || e}`);
    }

    // 스킬셋 보관본 주입 — MTG DB(qa_skill_store)가 원본, 파이프라인 파일은 작업 사본.
    //   빈 스토어 여부와 무관하게 항상 되밀어(멱등 merge — 누락 버전만 복원) 버전 lineage
    //   (v1→v2…)를 이어서 학습(배포 스왑 소실·부분 소실 모두 커버).
    try {
        await pushSkillStoreBackup(pool, rubricId, base);
    } catch (e) {
        logger.warn(`[skill-learn] 스킬셋 보관본 주입 실패(현재 스토어로 진행): ${e?.message || e}`);
    }

    // ③ 정정 케이스 수집 — order_no→item_number 매핑 불가(비활성/미존재 항목) 행은 제외.
    emit({ stage: 'collect' });
    const { rows, callReasons } = await collectSkillCases(pool, orgId, { limit: opts.limit });
    const cases = rows
        .map((r) => {
            const orderNo = asNumber(r.order_no);
            const itemNumber = orderNo === null ? null : orderToItemNum[orderNo];
            if (itemNumber == null) return null;
            const c = {
                consultation_id: String(r.qa_id),
                item_number: itemNumber,
                item_name: safeStr(r.item),
                ai_score: asNumber(r.ai_eval),
                max_score: orderToMaxScore[orderNo] ?? null,
                direction: safeStr(r.manual_eval_option),
                ai_reason: safeStr(r.reason_text),
                evidence: safeStr(r.agent_utterance).slice(0, EVIDENCE_CAP),
            };
            const callReason = callReasons[String(r.qa_id)];
            if (callReason) c.call_reason = callReason.slice(0, CALL_REASON_CAP);
            const dt = fmtDateTime(r.CDATE);
            if (dt) c.call_datetime = dt;
            return c;
        })
        .filter(Boolean);
    if (!cases.length) {
        return { ok: false, org_id: orgId, rubric_id: rubricId, case_count: 0, error: 'no_correction_cases' };
    }

    // 스킬 제외 항목(order_no) → excluded_items(item_number) — 케이스와 같은 매핑으로 변환 동봉.
    const excludedOrders = await readSkillExcludedOrders(pool, orgId);
    const excludedItems = excludedOrders.map((o) => orderToItemNum[o]).filter((n) => n != null);

    // ④ overlay 생성 위임 — 버전 생성·활성화(auto_activate)는 qa-pipeline 이 수행.
    //    학습 대상 항목 breakdown(어떤 항목·정정 몇 건) 동봉 → 진행 표시에 노출.
    const byItem = {};
    for (const c of cases) {
        if (!byItem[c.item_number]) byItem[c.item_number] = { item_number: c.item_number, item_name: c.item_name, count: 0 };
        byItem[c.item_number].count += 1;
    }
    const targetItems = Object.values(byItem).sort((a, b) => a.item_number - b.item_number);
    emit({ stage: 'generate', case_count: cases.length, target_items: targetItems, rubric_id: rubricId });

    // 메모리 소유 = MTG DB(qa_skill_store). 누적 메모리를 동봉 → 파이프라인이 학습 입력으로 사용,
    //   응답 memory 로 최종본을 돌려받아 DB 에 UPSERT(SSOT). 로드 실패해도 빈 골격으로 진행(무해).
    const skillMemory = await loadSkillMemory(pool, rubricId);
    const memBefore = skillMemoryStats(skillMemory);
    emit({
        stage: 'memory',
        rubric_id: rubricId,
        message: `메모리 로드 — 항목 ${memBefore.itemCount}개 · 누적 정정 ${memBefore.caseCount}건`,
    });

    let resp;
    let j = {};
    try {
        resp = await fetch(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                org_id: orgId,
                label: `${source} ${kstNowLabel()}`,
                auto_activate: true,
                excluded_items: excludedItems,
                memory: skillMemory,
                cases,
            }),
            signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
        });
        try {
            j = await resp.json();
        } catch {
            /* 비-JSON 응답 */
        }
    } catch (e) {
        return { ok: false, org_id: orgId, rubric_id: rubricId, case_count: cases.length, error: String(e?.message || e) };
    }
    const ok = j.ok === true;
    // 응답 최종 메모리(blob) 를 DB 로 영속. ok 여부로 게이트하지 않는 것은 의도적:
    //   · 에러 경로(생성 예외)는 파이프라인이 memory 를 아예 미첨부 → 여기 도달해도 j.memory 부재.
    //   · ok:false=no_eligible(학습 자격 미달)이라도 유입 케이스 누적분은 저장돼야 다음 배치 자격의
    //     토대가 됨(파일 기반 _persist_mem_best_effort 와 동일 의미). blob 은 항상 입력 ⊇ 라 손실 없음.
    if (j.memory && typeof j.memory === 'object') {
        const savedOk = await saveSkillMemory(pool, rubricId, orgId, j.memory);
        const memAfter = skillMemoryStats(j.memory);
        const added = Math.max(0, memAfter.caseCount - memBefore.caseCount);
        emit({
            stage: 'memory',
            rubric_id: rubricId,
            message: savedOk
                ? `메모리 저장 — 항목 ${memAfter.itemCount}개 · 누적 정정 ${memAfter.caseCount}건${added ? ` (+신규 ${added}건)` : ''}${memAfter.contested ? ` · 모순 의심 노트 ${memAfter.contested}건` : ''}`
                : '메모리 저장 실패 — DB UPSERT 오류 (학습 결과는 유효, 서버 로그 확인)',
        });
    } else if (ok) {
        // 정상 학습인데 memory 미반환 = 파이프라인 메모리 스위치 OFF(legacy_mode) 신호 — 운영 카나리.
        emit({
            stage: 'memory',
            rubric_id: rubricId,
            message: '메모리 미반환 — 백엔드 메모리 스위치 OFF(legacy_mode) 의심 (QA_MTG_SKILL_MEMORY_ENABLED 확인 필요)',
        });
    }
    // 스킬셋(버전·룰 원문) DB 영속 — 학습 성공 시 dump 를 PG 에 보관(배포 스왑 생존 계층).
    if (ok) {
        await persistSkillStore(pool, orgId, rubricId, base);
    }
    const result = {
        ok,
        org_id: orgId,
        rubric_id: rubricId,
        version_id: j.version_id ?? null,
        case_count: asNumber(j.case_count) ?? cases.length,
        items_changed: Array.isArray(j.items_changed) ? j.items_changed : [],
        skipped_items: Array.isArray(j.skipped_items) ? j.skipped_items : [],
        activated: !!j.activated,
        active_version_id: j.active_version_id ?? null,
    };
    if (!ok) result.error = safeStr(j.error).trim() || `http_${resp.status}`;
    return result;
}

/**
 * 스킬 생성 진행률 프록시 — 파이프라인 status 의 generating {done,total} 반환.
 * 생성 중이 아니거나(필드 부재) 조회 실패면 null — 호출측(status 라우트)이 진행바 생략.
 */
export async function fetchSkillGenProgress(rubricId, opts = {}) {
    if (!rubricId) return null;
    const base = resolveSkillBaseUrl(opts);
    const j = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/status`);
    const g = j && typeof j === 'object' ? j.generating : null;
    return g && typeof g === 'object' && g.total ? g : null;
}

/** 파이프라인 JSON 호출 공통 — 실패/비-JSON 도 throw 없이 {ok:false, error} 로 수렴(무회귀). */
async function pipelineJson(url, init = {}) {
    try {
        const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
        let j = null;
        try {
            j = await resp.json();
        } catch {
            /* 비-JSON 응답 */
        }
        if (j && typeof j === 'object') return j; // 404(rubric_not_found) 등도 body 의 ok/error 그대로 전달
        return { ok: false, error: `http_${resp.status}` };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}

/** 보관본(store blob) → 버전 목록 응답 렌더 — 파이프라인 /versions 응답과 동일 스키마(최신순). */
function renderVersionsFromBackup(backup) {
    const versions = [...(backup.store.versions || [])]
        .reverse()
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
            version_id: v.version_id,
            label: v.label ?? '',
            created_at: v.created_at ?? null,
            model_id: v.model_id ?? '',
            case_count: v.case_count ?? null,
            items_changed: v.items_changed ?? [],
            item_count: v.item_count ?? null,
            parent_version_id: v.parent_version_id ?? null,
            source: v.source ?? '',
        }));
    return {
        ok: true,
        active_version_id: backup.store.active_version_id ?? null,
        excluded_items: backup.store.excluded_items || [],
        versions,
    };
}

/** 버전 목록 — MTG DB(qa_skill_store) 단독 조회(소유 모델: DB=원본, 조회 경로에 EC2 없음).
 *  보관본 부재 = "학습된 버전 없음"이 정답. DB 영속 도입 전 파이프라인 파일에만 남은 옛 버전은
 *  다음 학습이 그 위에서 lineage 를 이어 결과를 DB 로 영속하며 자연 회수된다. */
export async function fetchSkillVersions(pool, orgId) {
    const rubricId = await resolveSkillRubricId(pool, orgId);
    const backup = await loadSkillStoreBackup(pool, rubricId);
    if (backup?.store && Array.isArray(backup.store.versions) && backup.store.versions.length) {
        return { org_id: orgId, rubric_id: rubricId, ...renderVersionsFromBackup(backup), source: 'db' };
    }
    return {
        org_id: orgId,
        rubric_id: rubricId,
        ok: true,
        active_version_id: null,
        excluded_items: [],
        versions: [],
        source: 'db',
    };
}

/** 버전 상세(생성 근거 케이스 포함) — MTG DB 보관본(store+files+manifests) 단독 재구성.
 *  목록이 DB 에서만 나오므로 미보유 버전 요청은 version_not_found 가 정답(파이프라인 무조회). */
export async function fetchSkillVersionDetail(pool, orgId, versionId) {
    const rubricId = await resolveSkillRubricId(pool, orgId);
    const backup = await loadSkillStoreBackup(pool, rubricId);
    const entry = (backup?.store?.versions || []).find((v) => v && String(v.version_id) === String(versionId));
    if (!entry) {
        return {
            org_id: orgId,
            rubric_id: rubricId,
            ok: false,
            error: 'version_not_found',
            version_id: String(versionId),
        };
    }
    const manifest = backup.manifests?.[String(versionId)] || {};
    const casesBy = manifest.cases_by_item && typeof manifest.cases_by_item === 'object' ? manifest.cases_by_item : {};
    const itemsMap = entry.items && typeof entry.items === 'object' ? entry.items : {};
    const items = Object.keys(itemsMap)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({
            item_number: Number(k),
            item_name: itemsMap[k]?.item_name || '',
            changed: Boolean(itemsMap[k]?.changed),
            overlay_md: (itemsMap[k]?.file && backup.files?.[String(itemsMap[k].file)]) || '',
            cases: Array.isArray(casesBy[k]) ? casesBy[k] : [],
        }))
        .filter((it) => Number.isFinite(it.item_number));
    return {
        org_id: orgId,
        rubric_id: rubricId,
        ok: true,
        version_id: String(versionId),
        label: entry.label ?? '',
        created_at: entry.created_at ?? null,
        model_id: entry.model_id ?? '',
        parent_version_id: entry.parent_version_id ?? null,
        case_count: entry.case_count ?? null,
        active: String(backup.store?.active_version_id ?? '') === String(versionId),
        items,
        source: 'db',
    };
}

/** 버전 활성화/롤백(version_id) 또는 전체 비활성(null) — MTG DB 보관본을 직접 갱신(소유 모델).
 *  평가 주입(skill_overlays 동봉)·조회 모두 DB 기준이므로 DB 갱신 = 실효 반영.
 *  파이프라인 작업 사본 동기는 베스트에포트(불통이어도 성공). 보관본 없는 브랜드만 기존 프록시. */
export async function activateSkillVersion(pool, orgId, versionId, opts = {}) {
    const base = resolveSkillBaseUrl(opts);
    const rubricId = await resolveSkillRubricId(pool, orgId);
    const vid = versionId === null || versionId === undefined ? null : String(versionId);
    const backup = await loadSkillStoreBackup(pool, rubricId);
    const known = vid === null || (backup?.store?.versions || []).some((v) => v && String(v.version_id) === vid);
    if (backup?.store && known) {
        try {
            await pool.query(
                `UPDATE qa_skill_store
                    SET store = jsonb_set(store, '{store,active_version_id}', $2::jsonb, true), updated_at = now()
                  WHERE rubric_id = $1`,
                [rubricId, JSON.stringify(vid)]
            );
        } catch (e) {
            return { ok: false, org_id: orgId, rubric_id: rubricId, error: String(e?.message || e) };
        }
        // 파이프라인 작업 사본 동기 — 실패 무해(원본=DB). pipelineJson 은 throw 하지 않음.
        await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version_id: vid }),
        });
        return { ok: true, org_id: orgId, rubric_id: rubricId, active_version_id: vid, source: 'db' };
    }
    const j = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: vid }),
    });
    // 활성 상태 변경도 보관본에 반영(복원 시 활성 버전까지 승계).
    if (j?.ok === true) {
        await persistSkillStore(pool, orgId, rubricId, base);
    }
    return { org_id: orgId, rubric_id: rubricId, ...j };
}

/**
 * 스킬 설정 동기화 — skill.excluded(order_no 배열)를 케이스와 동일 매핑으로 item_number 로 변환해
 * PUT /v2/mtg-skill/{rubric}/settings 에 반영. 배치 설정 저장 후 fire-and-forget 용(실패 무회귀).
 */
export async function pushSkillSettings(pool, orgId, excludedOrders, opts = {}) {
    const base = resolveSkillBaseUrl(opts);
    const rubricId = await resolveSkillRubricId(pool, orgId);
    let excludedItems = [];
    try {
        const { rubric, rowMeta } = await buildRubricFromDefs(pool, orgId);
        if (rubric && rubric.items && rubric.items.length) {
            const { orderToItemNum } = buildOrderMaps(rubric, rowMeta);
            excludedItems = (Array.isArray(excludedOrders) ? excludedOrders : [])
                .map((o) => orderToItemNum[asNumber(o)])
                .filter((n) => n != null);
        }
    } catch (e) {
        return { ok: false, org_id: orgId, rubric_id: rubricId, error: String(e?.message || e) };
    }
    // MTG DB 보관본에 직접 반영(소유 모델) — 조회·평가 동봉(getActiveSkillOverlays)이 DB 기준이라
    // 파이프라인 불통이어도 제외 설정이 즉시 실효. 보관본 없는 브랜드는 UPDATE no-op(무해).
    try {
        await ensureSkillVersionsTable(pool);
        await pool.query(
            `UPDATE qa_skill_store
                SET store = jsonb_set(store, '{store,excluded_items}', $2::jsonb, true), updated_at = now()
              WHERE rubric_id = $1`,
            [rubricId, JSON.stringify(excludedItems)]
        );
    } catch (e) {
        logger.warn(`[skill-learn] 제외 설정 DB 반영 실패(파이프라인 반영은 계속): ${e?.message || e}`);
    }
    const j = await pipelineJson(`${base}/v2/mtg-skill/${encodeURIComponent(rubricId)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded_items: excludedItems }),
    });
    return { org_id: orgId, rubric_id: rubricId, excluded_items: excludedItems, ...j };
}
