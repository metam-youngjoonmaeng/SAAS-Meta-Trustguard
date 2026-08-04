#!/bin/sh
# QA Dashboard — 마이그레이션 적용 + 조건부 시드 적재 (고객사 PoC)
#
# 1단계: /seed/migrations/02_*.sql 이후 마이그레이션을 매 기동마다 idempotent 적용.
#        (postgres docker-entrypoint-initdb.d 는 빈 볼륨 첫 부팅에만 실행되므로,
#         기존 볼륨 유지 상태에서 신규 마이그레이션 누락 → 컬럼 미적용 → 로그인 500 등 장애 방지)
#        01_init.sql 은 초기 스키마라 여기서 다루지 않는다.
# 2단계: qa_calls 가 비어 있을 때만 data/seed/load.sql 을 실행.
#        한번 운영 데이터가 들어가면 재기동 시 자동 적재되지 않아 수기 평가·업로드 데이터 보존.
# 강제 재시드: `docker compose run --rm qa-ai-seeder --reset`

set -eu

PGHOST="${PGHOST:-qa-ai-postgres}"
PGPORT="${PGPORT:-5432}"
: "${PGUSER:?PGUSER 미설정}"
: "${PGPASSWORD:?PGPASSWORD 미설정}"
PGDATABASE="${PGDATABASE:-qa_dashboard}"
export PGPASSWORD

echo "[seed] target: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"

# postgres healthcheck 통과 후에도 짧은 race 윈도우가 있어 명시적으로 대기
i=0
until psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c 'SELECT 1' >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 30 ]; then
    echo "[seed] postgres 연결 실패 (30회 시도)" >&2
    exit 1
  fi
  sleep 1
done

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/seed/migrations}"
if [ -d "$MIGRATIONS_DIR" ]; then
  applied=0
  for f in "$MIGRATIONS_DIR"/[0-9][0-9]_*.sql; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    case "$base" in
      01_*) continue ;;  # 01_init.sql 은 초기 스키마 — 빈 볼륨 첫 부팅에만 적용
    esac
    echo "[migrate] apply: $base"
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
      -v ON_ERROR_STOP=1 -f "$f"
    applied=$((applied+1))
  done
  echo "[migrate] $applied 개 마이그레이션 적용 완료 (idempotent)"
else
  echo "[migrate] $MIGRATIONS_DIR 없음 — 건너뜀"
fi

FORCE_RESET="${1:-}"

cd /seed
# ★ load.sql 존재 확인을 qa_calls 카운트보다 먼저 한다.
#   baseline 시드는 폐기돼 load.sql 이 없는데, 순서가 반대면 `SELECT COUNT(*) FROM qa_calls`
#   가 먼저 돌아 통합DB 스키마(qa_calls 없음 — common.calls⋈trustguard.qa_evaluations)에서
#   실패하고, set -eu 때문에 시더가 매 기동 에러 종료한다(1단계 마이그레이션은 이미 끝난 뒤라
#   기능 영향은 없지만 부팅마다 빨간 에러가 남는다).
if [ ! -f data/seed/load.sql ]; then
  echo "[seed] data/seed/load.sql 없음 — baseline 시드 폐기됨, 적재 건너뜀 (마이그레이션만 적용)"
  exit 0
fi

if [ "$FORCE_RESET" = "--reset" ]; then
  echo "[seed] --reset: 무조건 시드 재적재"
else
  # 통합DB 스키마에는 qa_calls 가 없다(콜 원장=common.calls, 평가=trustguard.qa_evaluations).
  # ★ 한 쿼리 안의 CASE 로는 안 된다 — 플래너가 안 타는 가지의 테이블까지 파싱해
  #   `relation "public.qa_calls" does not exist` 로 실패한다. 테이블명을 먼저 확정한 뒤 센다.
  CALLS_TBL=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc \
    "SELECT COALESCE(to_regclass('common.calls')::text, to_regclass('public.qa_calls')::text, '');")
  if [ -n "$CALLS_TBL" ]; then
    count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT COUNT(*) FROM $CALLS_TBL;")
  else
    echo "[seed] 콜 원장 테이블 없음 — 시드 건너뜀"
    exit 0
  fi
  if [ "$count" != "0" ]; then
    echo "[seed] 콜 원장에 이미 $count 행 존재 — 시드 건너뜀 (운영 데이터 보존)"
    exit 0
  fi
  echo "[seed] 콜 원장 비어 있음 — baseline 시드 적재 진행"
fi

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f data/seed/load.sql

echo "[seed] 완료"
