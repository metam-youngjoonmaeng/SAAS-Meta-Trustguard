/** @type {import('tailwindcss').Config} */
// MetaM DS(@metam/ds v0.1) 토큰 매핑 — 색은 var() 참조라 값 갱신만으로 리스킨된다.
// 마크업 semantic 클래스(bg-primary, bg-primary-tint, border-primary-soft-border 등)는 아래 primary 램프로 해석.
import ds from "./styles/metam-ds/tailwind-v3-theme.cjs";
export default {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            // DS 테마(색·radius·fontFamily{sans,mono}) 스프레드가 단일 소스.
            ...ds,
            // main: primary 램프 클래스(bg-primary-tint/hover, border-primary-soft-border 등)를 유지하되
            // 값은 DS 토큰(app/globals.css :root --primary*)으로 해석 — ds.colors.primary(단일)를 램프로 확장.
            // bg-primary-soft 는 ds 의 top-level 'primary-soft'(→ --primary-soft-flat)가 담당(키 충돌 회피).
            colors: {
                ...ds.colors,
                primary: {
                    DEFAULT: 'var(--primary)',
                    hover: 'var(--primary-light)',
                    accent: 'var(--primary-accent)',
                    tint: 'var(--primary-tint)',
                    'soft-border': 'var(--primary-soft-border)',
                },
            },
            // 등폭(mono) 폰트는 DS fontFamily(...ds)가 단일 소스로 관리한다 — mono → var(--font-mono).
            // main 이 inline 으로 재정의했던 fontFamily.mono(값 == var(--font-mono))는 위 ...ds 스프레드가
            // 동일 토큰으로 이미 제공하므로 생략한다(별도 fontFamily 키를 두면 ds 의 sans 가 덮여 사라짐).
            // .font-mono 유틸 + preflight(code/kbd/samp/pre)가 모두 --font-mono 를 참조하므로,
            // app/globals.css 의 --font-mono 한 줄만 바꾸면 앱 전역 등폭 표기가 일괄 반영된다(2026-07-08 등폭 룩 제거 통일).
        },
    },
    plugins: [],
};
