# ─────────────────────────────────────────────────────────────
# 대시보드 프론트엔드 — Next.js 15 (standalone) + Tailwind v4
#   기존 Vite→nginx 정적 서빙을 Next 단독 노드 서버로 교체.
#   /api/* 는 next.config 의 rewrites 가 qa-ai-api:3007 로 프록시.
#   (rewrites 목적지는 빌드 시점 고정 → API_PROXY_TARGET 을 build ARG 로 주입)
# ─────────────────────────────────────────────────────────────

# Stage 1: build
FROM node:20-slim AS build

WORKDIR /app

# /api 프록시 대상 — 운영 compose 네트워크의 API 서비스명. (build 시점 inline)
ARG API_PROXY_TARGET=http://qa-ai-api:3007
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# 개발계 식별용 DEV 배지(선택) — 운영 빌드에서는 미주입 → 미표시
ARG NEXT_PUBLIC_DEV_BADGE=""
ENV NEXT_PUBLIC_DEV_BADGE=$NEXT_PUBLIC_DEV_BADGE
ENV NEXT_TELEMETRY_DISABLED=1

# 네이티브 바인딩(@tailwindcss/oxide)을 빌드 플랫폼(linux-x64-gnu)에 맞춰 받기 위해
# lock 없이 fresh install (Dockerfile.api 와 동일 전략).
COPY frontend/package.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: runtime (standalone)
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone 산출물 = server.js + 최소 node_modules trace
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
