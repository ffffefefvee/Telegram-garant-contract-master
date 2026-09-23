// Local-only staging stack: isolated PostgreSQL, Redis, mock IdP, and API.
const { spawn, execFile } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { get } = require('node:https');
const { get: getHttp } = require('node:http');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { promisify } = require('node:util');
const { createMockIdp } = require('./mock-idp');
const { Client } = require('pg');

const exec = promisify(execFile);
const serviceRoot = resolve(__dirname, '..');
const localRoot = join(serviceRoot, '.local-e2e');
// The Windows PostgreSQL binary cannot initialize a cluster below a Cyrillic path.
const pgRoot = join(tmpdir(), 'garant-staging-local');
const pgDir = join(pgRoot, 'postgres');
const pgNative = join(pgRoot, 'native');
const configPath = join(localRoot, 'staging-stack.json');
const redisExe = join(localRoot, 'redis-7.4.9', 'Redis-7.4.9-Windows-x64-msys2', 'redis-server.exe');
const redisArchive = join(localRoot, 'redis-7.4.9.zip');
const redisSha256 = '98af6511ca35601cc8d8200a92318e00f9d2d5425a9f7f3e8f699d3bdd59dcf6';
const redisUrl = 'https://github.com/redis-windows/redis-windows/releases/download/7.4.9/Redis-7.4.9-Windows-x64-msys2.zip';
const pgSource = join(serviceRoot, 'node_modules', '@embedded-postgres', 'windows-x64', 'native');
const pgBin = join(pgNative, 'bin');
const pgCtl = join(pgBin, 'pg_ctl.exe');
const initdb = join(pgBin, 'initdb.exe');
const pgPort = 55432;
const redisPort = 56379;
const apiPort = 3001;
const dbName = 'garant_staging';
const testUsers = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'admin@local.test', telegramId: 990000001, role: 'admin' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'arbitrator@local.test', telegramId: 990000002, role: 'arbitrator' },
];

function checkLocalTarget(path, name) {
  const parent = name === 'PostgreSQL data' ? pgRoot : localRoot;
  if (!resolve(path).startsWith(`${parent}\u005c`)) throw new Error(`${name} escaped the isolated staging directory`);
}

function readHealth(url, client, options = {}) {
  return new Promise((done) => {
    const request = client(url, options, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { done(response.statusCode === 200 ? JSON.parse(body) : null); }
        catch { done(null); }
      });
    });
    request.setTimeout(2000, () => request.destroy());
    request.on('error', () => done(null));
  });
}

async function waitForApi(backend) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backend.exitCode !== null) throw new Error(`Backend exited before readiness with code ${backend.exitCode}`);
    const health = await readHealth(`http://127.0.0.1:${apiPort}/api/health`, getHttp);
    if (health?.status === 'ok' && health?.db === 'up') return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Backend did not become ready within 30 seconds');
}

async function seedTestUsers(config) {
  const client = new Client({ host: '127.0.0.1', port: pgPort, user: 'garant_user', password: config.pgPassword, database: dbName });
  await client.connect();
  try {
    for (const user of testUsers) {
      await client.query(`INSERT INTO users (id, telegram_id, email, status, roles)
        VALUES ($1, $2, $3, 'active', ARRAY[$4]::user_type_enum[])
        ON CONFLICT (id) DO NOTHING`, [user.id, user.telegramId, user.email, user.role]);
      const result = await client.query('SELECT telegram_id, email, roles FROM users WHERE id = $1', [user.id]);
      const row = result.rows[0];
      if (!row || Number(row.telegram_id) !== user.telegramId || row.email !== user.email || !row.roles.includes(user.role)) {
        throw new Error(`Local privileged test user ${user.email} conflicts with existing data`);
      }
    }
    await client.query(`INSERT INTO arbitrator_profiles (user_id, status)
      VALUES ($1, 'active') ON CONFLICT (user_id) DO NOTHING`, [testUsers[1].id]);
  } finally {
    await client.end();
  }
}

function download(url, redirects = 0) {
  return new Promise((done, fail) => {
    if (redirects > 5) return fail(new Error('Too many Redis download redirects'));
    get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const target = new URL(response.headers.location, url);
        response.resume();
        if (target.protocol !== 'https:') return fail(new Error('Redis download redirected away from HTTPS'));
        download(target, redirects + 1).then(done, fail);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); return fail(new Error(`Redis download HTTP ${response.statusCode}`)); }
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > 25_000_000) response.destroy(new Error('Redis archive exceeds expected size'));
        else chunks.push(chunk);
      });
      response.on('end', () => done(Buffer.concat(chunks)));
      response.on('error', fail);
    }).on('error', fail);
  });
}

async function ensureRedis() {
  if (existsSync(redisExe)) return;
  let archive;
  if (existsSync(redisArchive)) archive = readFileSync(redisArchive);
  else {
    console.log('Downloading portable Redis once; subsequent launches run offline.');
    archive = await download(redisUrl);
  }
  if (createHash('sha256').update(archive).digest('hex') !== redisSha256) {
    throw new Error('Portable Redis SHA-256 does not match the published release hash');
  }
  if (!existsSync(redisArchive)) writeFileSync(redisArchive, archive, { flag: 'wx' });
  const destination = join(localRoot, 'redis-7.4.9');
  mkdirSync(destination, { recursive: true });
  await exec('tar', ['-xf', redisArchive, '-C', destination], { timeout: 120000 });
  if (!existsSync(redisExe)) throw new Error('Redis archive did not contain the expected executable');
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This local staging launcher currently supports Windows only');
  if (process.env.NODE_ENV === 'production') throw new Error('The local staging stack cannot run in production');
  const idpCert = join(localRoot, 'mock-idp', 'ca.pem');
  if (existsSync(idpCert)) {
    const [api, identity] = await Promise.all([
      readHealth(`http://127.0.0.1:${apiPort}/api/health`, getHttp),
      readHealth('https://127.0.0.1:9443/health', get, { ca: readFileSync(idpCert) }),
    ]);
    if (api?.status === 'ok' && api?.db === 'up' && identity?.fixture === 'staging-mock-idp') {
      console.log('Local staging stack is already running.');
      console.log(`API: http://127.0.0.1:${apiPort}/api/health`);
      console.log('IdP: https://127.0.0.1:9443/health');
      return;
    }
  }
  for (const [path, name] of [[pgDir, 'PostgreSQL data'], [configPath, 'local credentials']]) checkLocalTarget(path, name);
  if (!existsSync(join(pgSource, 'bin', 'pg_ctl.exe'))) throw new Error('Portable PostgreSQL is missing; run npm install in services/user-service');
  if (!existsSync(join(serviceRoot, 'dist', 'src', 'main.js'))) throw new Error('Backend build is missing; run npm run build');

  mkdirSync(localRoot, { recursive: true });
  await ensureRedis();
  mkdirSync(pgRoot, { recursive: true });
  if (!existsSync(pgCtl)) cpSync(pgSource, pgNative, { recursive: true, errorOnExist: true });
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : { pgPassword: randomBytes(32).toString('base64url'), redisPassword: randomBytes(32).toString('base64url'), jwtSecret: randomBytes(48).toString('base64url') };
  if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });

  let idp;
  let redis;
  let backend;
  let pgStarted = false;
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (backend && backend.exitCode === null) backend.kill();
    if (idp) await new Promise((done) => idp.server.close(done));
    if (redis && redis.exitCode === null) redis.kill();
    if (pgStarted) {
      try { await exec(pgCtl, ['-D', pgDir, 'stop', '-m', 'fast', '-w'], { timeout: 30000 }); }
      catch (error) { console.error(`PostgreSQL shutdown: ${error.message}`); }
    }
  }
  process.on('SIGINT', () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });

  try {
    if (!existsSync(join(pgDir, 'PG_VERSION'))) {
      if (existsSync(pgDir) && readdirSync(pgDir).length > 0) throw new Error(`Refusing to initialize over a nonempty PostgreSQL directory: ${pgDir}`);
      mkdirSync(pgDir, { recursive: true });
      const passwordFile = join(pgRoot, 'staging-pg-password.txt');
      writeFileSync(passwordFile, `${config.pgPassword}\n`, { mode: 0o600, flag: 'w' });
      try {
        await exec(initdb, ['-D', pgDir, '-U', 'garant_user', '-A', 'scram-sha-256', '--pwfile', passwordFile, '--encoding', 'UTF8', '--locale=C'], { timeout: 120000 });
      } finally {
        require('node:fs').rmSync(passwordFile, { force: true });
      }
    }
    await exec(pgCtl, ['-D', pgDir, '-l', join(pgRoot, 'staging-postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort}`, 'start', '-w'], { timeout: 45000 });
    pgStarted = true;
    console.log(`PostgreSQL ready at 127.0.0.1:${pgPort}`);
    const pgClient = new Client({ host: '127.0.0.1', port: pgPort, user: 'garant_user', password: config.pgPassword, database: 'postgres' });
    await pgClient.connect();
    try {
      const found = await pgClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (found.rowCount === 0) await pgClient.query(`CREATE DATABASE ${dbName}`);
    } finally {
      await pgClient.end();
    }

    redis = spawn(redisExe, ['--bind', '127.0.0.1', '--port', String(redisPort), '--requirepass', config.redisPassword, '--save', '', '--appendonly', 'no'], { cwd: localRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    redis.stdout.on('data', (data) => { if (String(data).includes('Ready to accept connections')) console.log(`Redis ready at 127.0.0.1:${redisPort}`); });
    redis.stderr.on('data', (data) => process.stderr.write(data));
    await new Promise((r) => setTimeout(r, 1000));
    if (redis.exitCode !== null) throw new Error(`Redis exited with code ${redis.exitCode}`);

    idp = createMockIdp();
    await idp.start();
    const base = idp.issuer();
    const env = {
      ...process.env, NODE_ENV: 'staging', NODE_EXTRA_CA_CERTS: idp.identity.certPath,
      USER_SERVICE_HOST: '127.0.0.1', USER_SERVICE_PORT: String(apiPort), DB_USE_SQLITE: 'false', DB_HOST: '127.0.0.1', DB_PORT: String(pgPort),
      DB_USERNAME: 'garant_user', DB_PASSWORD: config.pgPassword, DB_NAME: dbName,
      DB_SYNCHRONIZE: 'false', DB_MIGRATIONS_RUN: 'true',
      REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redisPort), REDIS_PASSWORD: config.redisPassword,
      JWT_SECRET: config.jwtSecret, MONEY_EGRESS_ENABLED: 'false', TON_NATIVE_INGESTION_ENABLED: 'false',
      POLYGON_INDEXER_ENABLED: 'false', RECONCILIATION_ENABLED: 'false', EVIDENCE_PIPELINE_ENABLED: 'false',
      AUDIT_WORM_EXPORT_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_TEST_INJECT_ENABLED: 'false',
      AUTH_DEV_MODE: 'true', ADMIN_ALLOWED_ORIGINS: 'https://admin.local.test',
      ARBITRATOR_ALLOWED_ORIGINS: 'https://arbitrator.local.test',
      TON_CONNECT_ENABLED: 'false', TONCENTER_API_KEY: '', TON_LITESERVER_V2_API_KEY: '',
      BLOCKCHAIN_RPC_URL: '', BLOCKCHAIN_RPC_URLS: '', WEB3SIGNER_RPC_URL: '',
      CRYPTOMUS_API_KEY: '', EVIDENCE_SCANNER_URL: '',
      ADMIN_STEP_UP_ISSUER: base, ADMIN_STEP_UP_AUDIENCE: 'garant-admin', ADMIN_STEP_UP_JWKS_URL: `${base}/jwks`,
      ADMIN_STEP_UP_INTROSPECTION_URL: `${base}/introspect`, ADMIN_STEP_UP_INTROSPECTION_TOKEN: idp.identity.introspectionToken,
      ADMIN_STEP_UP_REQUIRED_SCOPE: 'garant:admin:step-up', ADMIN_STEP_UP_REQUIRED_ACR: 'urn:garant:acr:phishing-resistant',
      ADMIN_STEP_UP_MAX_AGE_SECONDS: '300', ADMIN_STEP_UP_JWKS_CACHE_SECONDS: '300', ADMIN_STEP_UP_IDP_TIMEOUT_MS: '2000',
      ARBITRATOR_STEP_UP_ISSUER: base, ARBITRATOR_STEP_UP_AUDIENCE: 'garant-arbitrator', ARBITRATOR_STEP_UP_JWKS_URL: `${base}/jwks`,
      ARBITRATOR_STEP_UP_INTROSPECTION_URL: `${base}/introspect`, ARBITRATOR_STEP_UP_INTROSPECTION_TOKEN: idp.identity.introspectionToken,
      ARBITRATOR_STEP_UP_REQUIRED_SCOPE: 'garant:arbitrator:step-up', ARBITRATOR_STEP_UP_REQUIRED_ACR: 'urn:garant:acr:phishing-resistant',
      ARBITRATOR_STEP_UP_MAX_AGE_SECONDS: '300', ARBITRATOR_STEP_UP_JWKS_CACHE_SECONDS: '300', ARBITRATOR_STEP_UP_IDP_TIMEOUT_MS: '2000',
    };
    backend = spawn(process.execPath, [join(serviceRoot, 'dist', 'src', 'main.js')], { cwd: serviceRoot, env, stdio: 'inherit' });
    console.log(`Mock IdP ready at ${base}; API starting at http://127.0.0.1:${apiPort}/api/health`);
    console.log('All services are loopback-only. Money egress is disabled. Press Ctrl+C to stop.');
    await waitForApi(backend);
    await seedTestUsers(config);
    console.log('Local admin and arbitrator test users are ready for dev-login.');
    await new Promise((resolveExit, rejectExit) => {
      backend.once('error', rejectExit);
      backend.once('exit', (code) => code === 0 ? resolveExit() : rejectExit(new Error(`Backend exited with code ${code}`)));
    });
  } finally {
    await shutdown();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
