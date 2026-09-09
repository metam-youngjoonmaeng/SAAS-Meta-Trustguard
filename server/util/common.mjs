// 서버 공용 소형 헬퍼 — 2026-09-03 중복 정의 통합.
//   round1 (index.js · collectionCallIngest · qaPipelineIngest ×3 동일) · safeStr / asNumber (qaPipelineIngest · rubricSync · skillLearn ×3 동일)
//   env (icsSource · icsQaPoller · mqttListener · taSource · xhubSource ×5 동일) · sha256Hex (brandRoutes · userProfile · routes/auth ×3 동일)
// 본문은 원본 그대로다. 여기 하나만 고치면 전부에 반영된다.
import crypto from 'node:crypto';

/** 소수 1자리 반올림. 숫자가 아니면 0. */
export function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

/** null/undefined → '' , 그 외 String(). */
export function safeStr(value) {
    return value === null || value === undefined ? '' : String(value);
}

/** 유한수만 number, 아니면 null. */
export function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** process.env[key] 를 trim 한 문자열로. 미설정이면 def. */
export function env(key, def = '') {
    return String(process.env[key] ?? def).trim();
}

/** sha256 hex (utf8). 세션 토큰 해시·비밀번호 해시 비교에 사용. */
export function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
