#!/bin/sh
# IPCC xhub 상시 SSH 터널. autossh 가 끊기면 자동 재연결. 비번접속(키접속 불가 박스)이라 sshpass 사용.
# app 은 SELECT 전용 RO계정(xhub_ro)으로 접속 — 쓰기는 DB 권한 단계에서 거부됨.
# 접속정보는 env(IPCC_SSH_*)로 주입. IPCC_SSH_HOST 비면 비활성(대기).
set -e

if [ -z "$IPCC_SSH_HOST" ]; then
  echo "[xhub-tunnel] IPCC_SSH_HOST 미설정 — 터널 비활성(대기). 값 채우면 재기동 시 활성."
  # 컨테이너가 죽지 않게 유지(restart 루프 방지)
  while true; do sleep 3600; done
fi

: "${IPCC_SSH_USER:?IPCC_SSH_USER 필요}"
: "${IPCC_SSH_PASS:?IPCC_SSH_PASS 필요}"
SSH_PORT="${IPCC_SSH_PORT:-21168}"
LOCAL_PORT="${LOCAL_PORT:-13306}"
REMOTE_HOST="${REMOTE_HOST:-127.0.0.1}"
REMOTE_PORT="${REMOTE_PORT:-3306}"

# ── 재연결 루프 (autossh 미사용) ──────────────────────────────────
# 원래 `sshpass -p PW autossh` 였으나, autossh 가 spawn 하는 자식 ssh 를 sshpass 가
# 제대로 못 다뤄 연결이 서질 않았다(직접 `sshpass -e ssh -N -L` 는 정상 인증·포워딩 확인).
# autossh 의 유일한 역할은 끊김 시 재연결 → 단순 while 루프로 대체하고 검증된 `sshpass -e ssh` 사용.
# ServerAlive 로 끊김 감지 → ssh 종료 → 루프가 재접속.
export SSHPASS="$IPCC_SSH_PASS"

echo "[xhub-tunnel] ${IPCC_SSH_USER}@${IPCC_SSH_HOST}:${SSH_PORT} → 0.0.0.0:${LOCAL_PORT} ⇒ ${REMOTE_HOST}:${REMOTE_PORT}"
while :; do
  sshpass -e ssh -N \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    -o NumberOfPasswordPrompts=1 -o ConnectTimeout=30 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -p "$SSH_PORT" \
    -L "0.0.0.0:${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}" \
    "${IPCC_SSH_USER}@${IPCC_SSH_HOST}" || true
  echo "[xhub-tunnel] 연결 종료 — 5초 후 재접속"
  sleep 5
done
