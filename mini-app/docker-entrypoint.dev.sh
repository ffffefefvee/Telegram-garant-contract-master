#!/bin/sh
set -e
cd /app
if [ ! -x "node_modules/.bin/vite" ]; then
  echo "[mini-app dev] Installing npm dependencies (first run or empty volume)..."
  npm install
fi
exec "$@"
