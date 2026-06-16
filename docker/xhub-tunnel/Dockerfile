# IPCC xhub(MariaDB) 상시 SSH 터널 사이드카.
# xhub 는 IPCC 박스의 127.0.0.1:3306 에만 바인드(외부 직접접속 불가) → autossh 로 상시 터널.
# 컨테이너 내부 0.0.0.0:13306 → (ssh) → IPCC 127.0.0.1:3306. 같은 네트워크의 app 이 xhub-tunnel:13306 으로 접속.
FROM alpine:3.20
RUN apk add --no-cache autossh sshpass openssh-client
COPY tunnel.sh /tunnel.sh
RUN chmod +x /tunnel.sh
ENTRYPOINT ["/tunnel.sh"]
