FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Native deps for sqlite3 (local dev only; production uses Postgres)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --no-fund --no-audit

COPY . .

RUN npm run build

RUN npm prune --omit=dev

# --- Runtime stage ---
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/locales ./locales
COPY --from=builder /app/src/config ./src/config
COPY --from=builder /app/src/migrations ./src/migrations
COPY --from=builder --chown=node:node /app/src/database ./src/database

# Drop root after OS packages and application files are installed.
RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["node", "dist/main"]
