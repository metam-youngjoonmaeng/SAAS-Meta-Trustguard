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
//   { "<org_id>": { "rubric_id": "<str>", "item_names": ["설명력", ...] } }
//   item_names = 평가항목 "이름" 토큰(부분문자열 매칭). 항목 번호(eval_item_number)가 아니라
//   이름 기반이라 항목 추가/순서변경(재번호)에도 안전.

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_DIR = process.env.RAG_FEWSHOT_CONFIG_DIR || '/app/data/uploads';
const CONFIG_PATH = path.join(CONFIG_DIR, 'rag_fewshot_config.json');

// 파일 부재 시 기본 시드 — 기존 asdf(org10) 설명력 실험 상태 보존.
const DEFAULT_CONFIG = {
    10: { rubric_id: 'rbrc_asdf_org10', item_names: ['설명력'] },
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
        out[String(k)] = { rubric_id: rubricId, item_names: itemNames };
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

// 평가 시 사용 — 해당 org 의 유효 설정. item_names 비었거나 rubric_id 없으면 null(=게이트 미적용).
export function getOrgFewshot(orgId) {
    const cfg = loadRagFewshotConfig();
    const entry = cfg[String(orgId)];
    if (!entry) return null;
    if (!entry.rubric_id || !Array.isArray(entry.item_names) || !entry.item_names.length) return null;
    return { rubric_id: entry.rubric_id, item_names: entry.item_names };
}

export { CONFIG_PATH };
