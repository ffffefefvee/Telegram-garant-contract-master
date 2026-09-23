// Read-only diagnostic for the isolated local staging PostgreSQL cluster.
require('reflect-metadata');
const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { Client } = require('pg');
const { getMetadataArgsStorage } = require('typeorm');

const root = resolve(__dirname, '..');
const moduleRoot = join(root, 'dist', 'src', 'modules');

function loadEntities(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) loadEntities(file);
    else if (entry.name.endsWith('.entity.js')) require(file);
  }
}

async function main() {
  loadEntities(moduleRoot);
  const config = JSON.parse(readFileSync(join(root, '.local-e2e', 'staging-stack.json'), 'utf8'));
  const client = new Client({ host: '127.0.0.1', port: 55432, user: 'garant_user', password: config.pgPassword, database: 'garant_staging' });
  await client.connect();
  try {
    const result = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const actual = new Map();
    for (const { table_name, column_name } of result.rows) {
      if (!actual.has(table_name)) actual.set(table_name, new Set());
      actual.get(table_name).add(column_name);
    }
    const metadata = getMetadataArgsStorage();
    for (const table of metadata.tables) {
      const tableName = table.name || table.target.name;
      const actualColumns = actual.get(tableName);
      if (!actualColumns) { console.log(`${tableName}: TABLE MISSING`); continue; }
      const missing = metadata.columns
        .filter((column) => column.target === table.target)
        .map((column) => column.options.name || column.propertyName)
        .filter((name) => !actualColumns.has(name));
      if (missing.length) {
        const mapped = missing.map((name) => {
          const snake = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
          return actualColumns.has(snake) ? `${name}->${snake}` : `${name}->UNRESOLVED`;
        });
        console.log(`${tableName}: ${mapped.join(', ')}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
