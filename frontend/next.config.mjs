import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */

// 백엔드(express qa-ai-api) 프록시 대상.
//   - dev: localhost:3007 (기존 vite proxy 와 동일)
//   - prod(docker): API_PROXY_TARGET=http://qa-ai-api:3007 환경변수로 주입
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:3007';

const nextConfig = {
    reactStrictMode: true,
    // Docker 배포용 — node server.js 단독 실행 가능한 최소 번들 생성.
    output: 'standalone',
    // 상위 디렉터리(루트 server 용 package-lock)와 lockfile 이 2개라 워크스페이스 루트를 명시.
    outputFileTracingRoot: __dirname,
    // 기존 SPA 와 동일하게 상대경로 /api/* 호출을 백엔드로 프록시한다.
    async rewrites() {
        return [
            { source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` },
        ];
    },
};

export default nextConfig;
