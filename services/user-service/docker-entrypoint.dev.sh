#!/bin/sh
set -e
cd /app
if [ ! -x "node_modules/.bin/nest" ]; then
  echo "[user-service dev] Installing npm dependencies (first run or empty volume)..."
  npm install
fi
exec "$@"
