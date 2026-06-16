# Stage 1: Build React App
FROM node:20-alpine AS build

# 개발계 컨테이너 식별용 DEV 배지를 빌드 시점에 활성화 (운영 빌드에서는 미주입 → 미표시)
ARG VITE_DEV_BADGE=""
ENV VITE_DEV_BADGE=$VITE_DEV_BADGE

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev

COPY . .
# Vite 는 .env 파일에서만 VITE_* 를 자동 inline → build ARG 를 .env.production 으로 흘려보냄
RUN if [ -n "$VITE_DEV_BADGE" ]; then echo "VITE_DEV_BADGE=$VITE_DEV_BADGE" > .env.production; fi
RUN npm run build -- --outDir dist && test -d /app/dist

# Stage 2: Serve with Nginx
FROM nginx:1.27-alpine

# Custom Nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Static assets if needed separately (optional if in public/)
# COPY metam_logo.png /usr/share/nginx/html/metam_logo.png

EXPOSE 3006

CMD ["nginx", "-g", "daemon off;"]
