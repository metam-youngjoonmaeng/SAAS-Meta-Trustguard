/** @type {import('tailwindcss').Config} */
// 브랜드 색은 여기 테마 토큰으로만 정의(단일 소스 = index.css 의 CSS 변수 참조).
// 마크업에서는 임의값([#055AAF]) 대신 semantic 클래스(bg-primary, text-primary, border-primary-soft 등)를 사용.
export default {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                // MetaM 핵심 블루 계열 — 값은 index.css :root 의 --primary* 가 유일 소스.
                primary: {
                    DEFAULT: 'var(--primary)',        // #055AAF — 버튼/아이콘/활성/강조 텍스트
                    hover: 'var(--primary-light)',    // #1E70E0 — primary hover
                    accent: 'var(--primary-accent)',  // #3E90FF — 밝은 강조(그라디언트 등)
                    tint: 'var(--primary-tint)',      // #E3F0FF — 채움/hover 배경(살짝 진한 톤)
                    soft: 'var(--primary-soft)',      // #EEF4FB — 기본 소프트 배경/칩
                    'soft-border': 'var(--primary-soft-border)', // #B2DDFF — 소프트 테두리
                },
            },
        },
    },
    plugins: [],
};
