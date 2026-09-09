export function formatDuration(sec) {
    const s = Number(sec || 0);
    return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

// 상담일시·기록시각 표기는 브라우저 로컬 TZ 가 아니라 항상 한국 시간(KST, UTC+9 무 DST).
// 해외/타임존 오설정 PC 에서도 같은 값이 보이게 고정. 서버는 timestamptz(절대 시각)를 ISO 로 준다.
export const DISPLAY_TIME_ZONE = "Asia/Seoul";

const KST_PARTS = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

// Date → { year, month, day, hour, minute, second } (KST). 불량 값은 null.
function kstParts(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    const out = {};
    for (const { type, value } of KST_PARTS.formatToParts(d)) out[type] = value;
    return out;
}

export function formatTime(ts) {
    if (!ts) return "-";
    const p = kstParts(ts);
    if (!p) return ts;
    return `${p.hour}:${p.minute}:${p.second}`;
}

export function formatDateTime(ts) {
    if (!ts) return "-";
    const p = kstParts(ts);
    if (!p) return ts;
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
