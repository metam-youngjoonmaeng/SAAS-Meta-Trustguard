#!/usr/bin/env bash
#
# QA Dashboard (고객사 PoC) — 배포 스크립트
#
# 사용법:
#   ./deploy.sh           # 처음 배포 (소스에서 빌드)
#   ./deploy.sh --reset   # DB 볼륨까지 초기화 후 재배포 (주의: 데이터 삭제됨)
#
# 화면 수정이 끝나고 폐쇄망 배포용 .tar 이미지를 만들면,
# 02-hanwha-QA_Dashboard 의 deploy.sh 와 같이 docker load 단계를 추가하면 됩니다.
#

set -euo pipefail

cd "$(dirname "$0")"

# Docker 명령 결정 (sudo 없이 docker가 동작하면 그대로, 아니면 sudo)
if docker info >/dev/null 2>&1; then
  DOCKER="docker"
  COMPOSE="docker compose"
else
  DOCKER="sudo docker"
  COMPOSE="sudo docker compose"
fi

if [[ "${1:-}" == "--reset" ]]; then
  echo "==> 1/2 기존 컨테이너 + DB 볼륨 제거"
  $COMPOSE down -v
else
  echo "==> 1/2 기존 컨테이너 정리 (DB 볼륨 보존)"
  $COMPOSE down || true
fi

echo "==> 2/2 컨테이너 빌드 및 기동"
$COMPOSE up -d --build

echo
echo "==> 상태 확인"
$COMPOSE ps

echo
echo "배포 완료."
echo "  대시보드:   http://<서버IP>:3026"
echo "  API:        http://<서버IP>:3027/api/health"
echo "  PostgreSQL: <서버IP>:5434  (자격증명은 .env 의 POSTGRES_USER / POSTGRES_PASSWORD 참조)"
echo
echo "초기 관리자 계정: admin1 (샌드박스: test1)"
echo "  비밀번호는 DB 시드 시점의 값을 사용하며, 최초 로그인 직후 변경 필수."
