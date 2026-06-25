// 루브릭 few-shot 항목 토글 설정 — UI 에서 켜고 끄는 "그 항목만 RAG" 상태의 영속 저장소.
//
// 백엔드(qa-pipeline) custom_rubric 경로① 게이트(rubric_fewshot_gate)가 metadata.rubric_id +
// metadata.rubric_fewshot_item_names 로 받아 동작한다. MTG 는 이 설정을 읽어 asdf(또는 다른
// 브랜드) 평가 콜에 해당 값을 주입한다.
//
// ★영속 위치: api 컨테이너는 ./server 를 ro 마운트하므로 server/ 아래엔 못 쓴다. 쓰기 가능한
//   ./data/uploads(→ /app/data/uploads) 볼륨에 저장. env RAG_FEWSHOT_CONFIG_DIR 로 override.
//
// 설정 shape:
//   { "<org_id>": { "rubric_id": "<str>", "item_names": ["설명력", ...], "pure": true } }
//   item_names = 평가항목 "이름" 토큰(부분문자열 매칭). 항목 번호(eval_item_number)가 아니라
//   이름 기반이라 항목 추가/순서변경(재번호)에도 안전.
//   pure = 해당 브랜드를 PURE 트랙(eval_mode=pure)으로 라우팅(coverage/KMS/persona/pentagon 미수행,
//   ~7초). RAG 토글(item_names)과 독립 — RAG 를 꺼도(item_names 비움) pure 는 유지된다.
//   구성된 org 는 기본 pure:true (명시 false 일 때만 해제).

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_DIR = process.env.RAG_FEWSHOT_CONFIG_DIR || '/app/data/uploads';
const CONFIG_PATH = path.join(CONFIG_DIR, 'rag_fewshot_config.json');

// 파일 부재 시 기본 시드 — asdf(org10) 설명력 RAG + METAM(org30) pure 라우팅.
// org30 은 골든셋 미구축이라 RAG 는 no-op(rubric_id 없음)이나 pure 라우팅으로 ~7초 확보.
const DEFAULT_CONFIG = {
    10: { rubric_id: 'rbrc_asdf_org10', item_names: ['설명력'], pure: true },
    30: { rubric_id: '', item_names: [], pure: true },
};

function _normalize(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
    const out = {};
    for (const [k, v] of Object.entries(cfg)) {
        if (!v || typeof v !== 'object') continue;
        const rubricId = String(v.rubric_id || '').trim();
        const itemNames = Array.isArray(v.item_names)
            ? [...new Set(v.item_names.map((s) => String(s).trim()).filter(Boolean))]
            : [];
        // 구성된 org 는 기본 PURE 라우팅 — 명시 false 일 때만 해제. RAG 토글과 독립이라
        // item_names 가 비어도(RAG off) pure 는 보존된다.
        out[String(k)] = { rubric_id: rubricId, item_names: itemNames, pure: v.pure !== false };
    }
    return out;
}

export function loadRagFewshotConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const obj = JSON.parse(raw);
        return _normalize(obj);
    } catch {
        // 파일 부재/파싱 실패 → 기본 시드(읽기 전용 반환, 디스크 미생성).
        return _normalize(DEFAULT_CONFIG);
    }
}

export function saveRagFewshotConfig(cfg) {
    const obj = _normalize(cfg);
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    } catch {
        /* mkdir 실패는 write 에서 드러남 */
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    return obj;
}

// 평가 시 사용 — 해당 org 의 유효 RAG 설정. item_names 비었거나 rubric_id 없으면 null(=게이트 미적용).
export function getOrgFewshot(orgId) {
    const cfg = loadRagFewshotConfig();
    const entry = cfg[String(orgId)];
    if (!entry) return null;
    if (!entry.rubric_id || !Array.isArray(entry.item_names) || !entry.item_names.length) return null;
    return { rubric_id: entry.rubric_id, item_names: entry.item_names };
}

// PURE 라우팅 판정 — 해당 org 가 구성돼 있고 pure 해제(false)가 아니면 true. RAG 토글과
// 독립이라 item_names 가 비어도(RAG off) pure 는 유지된다. 평가 콜에 eval_mode=pure 주입용.
export function getOrgPure(orgId) {
    const cfg = loadRagFewshotConfig();
    const entry = cfg[String(orgId)];
    return Boolean(entry && entry.pure);
}

export { CONFIG_PATH };
