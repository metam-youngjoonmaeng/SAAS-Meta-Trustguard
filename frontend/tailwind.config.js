/** @type {import('tailwindcss').Config} */
// 기존 Play CDN(v3) 과 동일한 zero-config 기본 테마. 커스텀 색은 마크업에서 임의값([#055AAF])으로 사용.
export default {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {},
    },
    plugins: [],
};
