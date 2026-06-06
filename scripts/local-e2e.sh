#!/usr/bin/env bash
# Local end-to-end smoke. Boots a throwaway Postgres in Docker, runs
# migrations, boots user-service in stub-blockchain / stub-telegram mode, then
# runs the smoke scenario in scripts/local-e2e-smoke.mjs.
#
# Requires: node >=18, npm, docker. No need for an existing postgres / hardhat
# / cryptomus / telegram setup — the script provisions everything.
#
# Usage:
#   bash scripts/local-e2e.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="$ROOT/services/user-service"
LOG="$ROOT/.local-e2e/backend.log"
PIDFILE="$ROOT/.local-e2e/backend.pid"
PG_CONTAINER="tg-garant-e2e-postgres"

mkdir -p "$ROOT/.local-e2e"

set -a
# shellcheck disable=SC1091
. "$ROOT/scripts/local-e2e.env"
set +a

PORT="${USER_SERVICE_PORT:-3099}"

cleanup() {
  local rc=$?
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  if [[ "${E2E_KEEP_DB:-0}" != "1" ]]; then
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "[fatal] docker not found in PATH" >&2
  exit 2
fi

echo "[setup] (re)starting postgres on :${DB_PORT}"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$PG_CONTAINER" \
  -e POSTGRES_USER="$DB_USERNAME" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "${DB_PORT}:5432" \
  postgres:15-alpine >/dev/null

echo "[setup] waiting for postgres"
for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$DB_USERNAME" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ ! -d "$SVC/dist" ]]; then
  echo "[setup] backend dist/ missing — running 'npm run build'"
  (cd "$SVC" && npm run build >/dev/null)
fi

# Schema is created via TypeOrm synchronize:true (entity-driven). The
# repo's TypeORM 0.3 migrations are unrelated to the runtime path used here
# and are skipped on purpose.

echo "[boot] starting backend on :$PORT (logs -> $LOG)"
(
  cd "$SVC"
  : >"$LOG"
  node dist/main.js >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
)

export E2E_BASE_URL="http://localhost:$PORT/api"
echo "[smoke] running scripts/local-e2e-smoke.mjs"
if node "$ROOT/scripts/local-e2e-smoke.mjs"; then
  echo "[done] smoke passed"
else
  rc=$?
  echo "[fail] smoke exited with $rc — last 100 lines of backend log:"
  tail -n 100 "$LOG" || true
  exit "$rc"
fi
