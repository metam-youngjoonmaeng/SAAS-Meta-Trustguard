/**
 * @metam/ds v0.1 — Tailwind v3용 theme.extend 프래그먼트.
 * css/tailwind-v4.css의 @theme inline 블록과 동일 범위를 v3 문법으로 미러링한다.
 * synced-from: ics-3.0-metam-ds@149727c (2026-07-07)
 *
 * 사용 (tailwind.config.js):
 *   const ds = require("@metam/ds/tailwind-v3-theme");
 *   module.exports = { theme: { extend: ds }, ... };
 * 앱 고유 확장이 필요하면 { ...ds, colors: { ...ds.colors, 앱색상 } } 로 병합.
 */
module.exports = {
  colors: {
    /* surfaces */
    background: "var(--background)",
    "background-soft": "var(--background-soft)",
    foreground: "var(--foreground)",
    card: "var(--card)",
    panel: "var(--panel)",
    muted: "var(--muted)",
    "muted-foreground": "var(--muted-foreground)",
    /* ink ramp */
    "ink-900": "var(--ink-900)",
    "ink-700": "var(--ink-700)",
    "ink-500": "var(--ink-500)",
    "ink-400": "var(--ink-400)",
    "ink-300": "var(--ink-300)",
    /* borders */
    border: "var(--border)",
    "border-strong": "var(--border-strong)",
    "table-border": "var(--table-border)",
    /* brand / action */
    primary: "var(--primary)",
    "primary-foreground": "var(--primary-foreground)",
    "primary-soft": "var(--primary-soft-flat)",
    navy: "var(--brand-navy)",
    /* state */
    destructive: "var(--destructive)",
    "destructive-soft": "var(--destructive-soft)",
    success: "var(--success)",
    "success-soft": "var(--success-soft)",
    warning: "var(--warning)",
    "warning-soft": "var(--warning-soft)",
    /* point (live/urgent) */
    point: "var(--point)",
    "point-soft": "var(--point-soft)",
    /* AI (예약 — AI 표면 전용) */
    "ai-violet": "var(--ai-violet)",
    "ai-cyan": "var(--ai-cyan)",
    "ai-tint": "var(--ai-tint)",
    "ai-border": "var(--ai-border)",
    /* category colors */
    "cat-payment": "var(--cat-payment)",
    "cat-delivery": "var(--cat-delivery)",
    "cat-product": "var(--cat-product)",
    "cat-account": "var(--cat-account)",
    "cat-tech": "var(--cat-tech)",
    "cat-claim": "var(--cat-claim)",
    "cat-policy": "var(--cat-policy)",
    "cat-service": "var(--cat-service)",
  },
  borderRadius: {
    sm: "var(--r-sm)",
    md: "var(--r-md)",
    lg: "var(--r-lg)",
    xl: "var(--r-xl)",
    "2xl": "var(--r-2xl)",
  },
  fontFamily: {
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
  },
};
