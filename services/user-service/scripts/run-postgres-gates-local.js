// Runs every gated PostgreSQL suite in a fresh, disposable database on the
// portable loopback PostgreSQL cluster started by staging:local.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { Client } = require('pg');

const root = resolve(__dirname, '..');
const localConfig = JSON.parse(readFileSync(join(root, '.local-e2e', 'staging-stack.json'), 'utf8'));
const testDatabase = `garant_gate_${randomBytes(8).toString('hex')}`;
const baseConnection = {
  host: '127.0.0.1',
  port: 55432,
  user: 'garant_user',
  password: localConfig.pgPassword,
  database: 'postgres',
};

async function adminQuery(sql) {
  const client = new Client(baseConnection);
  await client.connect();
  try { await client.query(sql); }
  finally { await client.end(); }
}

function runJest() {
  return new Promise((done, fail) => {
    const args = [
      join(root, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--runInBand', '--forceExit',
      'modules/deal/ton-jetton-phase3.postgres.spec.ts',
      'modules/deal/multichain-phase4.postgres.spec.ts',
      'modules/blockchain/polygon-phase5.postgres.spec.ts',
      'modules/arbitration/evidence-phase6.postgres.spec.ts',
    ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_USE_SQLITE: 'false', DB_HOST: baseConnection.host,
        DB_PORT: String(baseConnection.port), DB_USERNAME: baseConnection.user,
        DB_PASSWORD: baseConnection.password, DB_NAME: testDatabase,
        DB_SYNCHRONIZE: 'false', DB_MIGRATIONS_RUN: 'false',
        MONEY_EGRESS_ENABLED: 'false',
        RUN_PHASE3_POSTGRES: 'true', RUN_PHASE4_POSTGRES: 'true',
        RUN_PHASE5_POSTGRES: 'true', RUN_PHASE6_POSTGRES: 'true',
      },
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) => done(code ?? 1));
  });
}

async function main() {
  if (!/^[a-z0-9_]+$/.test(testDatabase)) throw new Error('Invalid generated database name');
  await adminQuery(`CREATE DATABASE "${testDatabase}"`);
  console.log(`Created isolated test database ${testDatabase}`);
  let result = 1;
  try { result = await runJest(); }
  finally {
    await adminQuery(`DROP DATABASE "${testDatabase}" WITH (FORCE)`);
    console.log(`Removed isolated test database ${testDatabase}`);
  }
  process.exitCode = result;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
