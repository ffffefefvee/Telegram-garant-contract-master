#!/usr/bin/env bash
# Restore a pg_dump custom-format archive produced by scripts/db-backup.sh.
#
# SAFETY: refuses to restore into a non-empty database unless FORCE=1 —
# pg_restore with --clean drops objects before recreating them.
#
# Target resolution: DATABASE_URL, then DB_* vars (same as db-backup.sh).
#
# Usage:
#   bash scripts/db-restore.sh backups/garant-20260611T033000Z.dump
#   FORCE=1 bash scripts/db-restore.sh backups/garant-....dump      # overwrite live DB
#
# Quarterly restore drill (docs/DEPLOYMENT_RUNBOOK.md §6): restore the latest
# dump into a scratch database and check row counts — a backup that was never
# restored is not a backup.

set -euo pipefail

DUMP="${1:?usage: db-restore.sh <dump-file>}"
[[ -f "$DUMP" ]] || { echo "[restore] FATAL: $DUMP not found" >&2; exit 1; }

if [[ -f "$DUMP.sha256" ]]; then
  sha256sum -c "$DUMP.sha256" || { echo "[restore] FATAL: checksum mismatch" >&2; exit 1; }
fi

run_psql() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -tAc "$1"
  else
    PGPASSWORD="${DB_PASSWORD:?}" psql -h "${DB_HOST:?}" -p "${DB_PORT:-5432}" \
      -U "${DB_USERNAME:?}" -d "${DB_NAME:?}" -tAc "$1"
  fi
}

TABLES="$(run_psql "select count(*) from information_schema.tables where table_schema='public';")"
if (( TABLES > 0 )) && [[ "${FORCE:-0}" != "1" ]]; then
  echo "[restore] FATAL: target DB has $TABLES tables. Re-run with FORCE=1 to overwrite." >&2
  exit 1
fi

echo "[restore] restoring $DUMP (target tables: $TABLES, FORCE=${FORCE:-0})"
if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"
else
  PGPASSWORD="${DB_PASSWORD:?}" pg_restore --clean --if-exists --no-owner \
    -h "${DB_HOST:?}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:?}" -d "${DB_NAME:?}" "$DUMP"
fi

echo "[restore] done. Quick sanity:"
run_psql "select 'users: '||count(*) from users union all select 'deals: '||count(*) from deals union all select 'payments: '||count(*) from payments;" || true
