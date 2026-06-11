#!/usr/bin/env bash
# Postgres backup for tg-garant. Produces a compressed pg_dump custom-format
# archive with a checksum, prunes old local backups, and (optionally) uploads
# to S3-compatible storage.
#
# Connection resolution order:
#   1. DATABASE_URL                          (Railway / managed PG)
#   2. DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME   (.env style)
#   3. PG_CONTAINER (docker exec into the compose container, default tg-garant-postgres)
#
# Env knobs:
#   BACKUP_DIR        where to store dumps          (default ./backups)
#   RETENTION_DAYS    delete local dumps older than (default 14)
#   S3_BUCKET         optional, e.g. s3://garant-backups (needs aws cli / rclone-compatible)
#
# Usage:
#   bash scripts/db-backup.sh
#   # cron (daily 03:30):  30 3 * * *  cd /opt/garant && bash scripts/db-backup.sh >> /var/log/garant-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-tg-garant-postgres}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/garant-$STAMP.dump"

echo "[backup] $STAMP starting → $OUT"

if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump --format=custom --compress=6 --no-owner --dbname="$DATABASE_URL" --file="$OUT"
elif [[ -n "${DB_HOST:-}" ]]; then
  PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD required}" pg_dump \
    --format=custom --compress=6 --no-owner \
    -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:?}" -d "${DB_NAME:?}" \
    --file="$OUT"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
  docker exec "$PG_CONTAINER" pg_dump --format=custom --compress=6 --no-owner \
    -U "${DB_USERNAME:-garant_user}" -d "${DB_NAME:-garant_db}" > "$OUT"
else
  echo "[backup] FATAL: no DATABASE_URL, no DB_HOST, no docker container '$PG_CONTAINER'" >&2
  exit 1
fi

sha256sum "$OUT" > "$OUT.sha256"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] done: $OUT ($SIZE)"

# Sanity: a healthy dump is never tiny.
BYTES="$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")"
if (( BYTES < 10240 )); then
  echo "[backup] FATAL: dump is suspiciously small (${BYTES}B) — treat as FAILED" >&2
  exit 1
fi

# Optional off-site copy. Local disk dies together with the DB — off-site is the point.
if [[ -n "${S3_BUCKET:-}" ]]; then
  aws s3 cp "$OUT" "$S3_BUCKET/$(basename "$OUT")" --only-show-errors
  aws s3 cp "$OUT.sha256" "$S3_BUCKET/$(basename "$OUT").sha256" --only-show-errors
  echo "[backup] uploaded to $S3_BUCKET"
fi

# Prune old local dumps.
find "$BACKUP_DIR" -name 'garant-*.dump*' -mtime "+$RETENTION_DAYS" -delete
echo "[backup] pruned local dumps older than ${RETENTION_DAYS}d"
