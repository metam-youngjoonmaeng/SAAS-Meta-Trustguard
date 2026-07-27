#!/bin/sh
# MTG 스모크 테스트 — DB 최적화(삭제/병합/개명) 전후 회귀 검증용.
# 사용: sh scripts/smoke_test.sh [baseline|verify]
#   baseline : 현재 응답을 logs/smoke/baseline_*.json 으로 저장
#   verify   : 현재 응답을 baseline 과 비교하여 차이 출력
#
# 검증 대상 = 콜평가 흐름의 읽기 경로 3종(⑦ GET /api/calls, /api/evaluations/:id, /api/analysis/:id)
# + 브랜드/평가항목 관리 경로. 인증은 로컬 admin1 세션 쿠키를 사용한다.

set -u
MODE="${1:-baseline}"
API="${API:-http://127.0.0.1:3027}"
OUT="logs/smoke"
mkdir -p "$OUT"

LOGIN_ID="${LOGIN_ID:-admin1}"
LOGIN_PW="${LOGIN_PW:-admin1234}"
COOKIE="$OUT/cookie.txt"

say() { printf '%s\n' "$*"; }

# ── 로그인 (쿠키 획득) ────────────────────────────────────────
rm -f "$COOKIE"
code=$(curl -s -o "$OUT/_login.json" -w '%{http_code}' -c "$COOKIE" \
  -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"login_id\":\"$LOGIN_ID\",\"password\":\"$LOGIN_PW\"}")
say "[login] HTTP $code"

CURL="curl -s -b $COOKIE"

# ── 대상 엔드포인트 ───────────────────────────────────────────
# 콜 1건을 뽑아 상세/분석까지 검증
QAID=$($CURL "$API/api/calls?limit=1" | sed -n 's/.*"ID":"\([^"]*\)".*/\1/p' | head -1)
[ -z "$QAID" ] && QAID=$($CURL "$API/api/calls?limit=1" | sed -n 's/.*"qa_id":"\([^"]*\)".*/\1/p' | head -1)
say "[probe] qa_id=$QAID"

run() {   # run <name> <path>
  name="$1"; path="$2"
  f="$OUT/${MODE}_${name}.json"
  http=$($CURL -o "$f" -w '%{http_code}' "$API$path")
  bytes=$(wc -c < "$f" | tr -d ' ')
  say "  $name  HTTP $http  ${bytes}B  $path"
  printf '%s\t%s\t%s\n' "$name" "$http" "$bytes" >> "$OUT/${MODE}_summary.tsv"
}

rm -f "$OUT/${MODE}_summary.tsv"
say "[$MODE] 엔드포인트 수집"
run calls          "/api/calls?limit=50"
run calls_org      "/api/calls?limit=50&org_id=30"
run brands         "/api/brands"
run domains        "/api/domains"
run agents         "/api/agents"
run notifications  "/api/notifications"
[ -n "$QAID" ] && run evaluations "/api/evaluations/$QAID"
[ -n "$QAID" ] && run analysis    "/api/analysis/$QAID"

# ── 비교 ──────────────────────────────────────────────────────
if [ "$MODE" = "verify" ]; then
  say ""
  say "[diff] baseline 대비 비교"
  fail=0
  while IFS=$(printf '\t') read -r name http bytes; do
    b_http=$(awk -F'\t' -v n="$name" '$1==n{print $2}' "$OUT/baseline_summary.tsv" 2>/dev/null)
    b_bytes=$(awk -F'\t' -v n="$name" '$1==n{print $3}' "$OUT/baseline_summary.tsv" 2>/dev/null)
    if [ "$http" != "$b_http" ]; then
      say "  [FAIL] $name  HTTP $b_http -> $http"; fail=1
    elif ! diff -q "$OUT/baseline_${name}.json" "$OUT/verify_${name}.json" >/dev/null 2>&1; then
      say "  [DIFF] $name  HTTP $http  bytes $b_bytes -> $bytes  (내용 상이 — 아래 확인)"
      diff "$OUT/baseline_${name}.json" "$OUT/verify_${name}.json" | head -6
      fail=1
    else
      say "  [OK]   $name  HTTP $http  ${bytes}B 동일"
    fi
  done < "$OUT/verify_summary.tsv"
  say ""
  [ "$fail" -eq 0 ] && say "RESULT: PASS (전 엔드포인트 동일)" || say "RESULT: 차이 있음 — 위 항목 검토 필요"
  exit "$fail"
fi
say "[baseline] 저장 완료 → $OUT/"
