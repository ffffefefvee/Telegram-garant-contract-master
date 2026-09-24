// Offline, loopback-only identity fixture. Never use this process for production.
const { createServer, get } = require('node:https');
const { generateKeyPairSync, randomBytes, randomUUID, createSign, timingSafeEqual, X509Certificate, createPrivateKey } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_IDP_PORT || 9443);
const ROOT = resolve(__dirname, '../.local-e2e/mock-idp');
const USERS = Object.freeze({
  'admin@local.test': { sub: '11111111-1111-4111-8111-111111111111', audience: 'garant-admin', purpose: 'admin_step_up', scope: 'garant:admin:step-up garant:admin:recovery' },
  'arbitrator@local.test': { sub: '22222222-2222-4222-8222-222222222222', audience: 'garant-arbitrator', purpose: 'arbitrator_step_up', scope: 'garant:arbitrator:step-up' },
  'recovery1@local.test': { sub: '33333333-3333-4333-8333-333333333333', audience: 'garant-admin', purpose: 'admin_step_up', scope: 'garant:admin:step-up garant:admin:recovery' },
  'recovery2@local.test': { sub: '44444444-4444-4444-8444-444444444444', audience: 'garant-admin', purpose: 'admin_step_up', scope: 'garant:admin:step-up garant:admin:recovery' },
});

function derLength(n) {
  if (n < 128) return Buffer.from([n]);
  const parts = [];
  while (n > 0) { parts.unshift(n & 255); n >>>= 8; }
  return Buffer.from([128 | parts.length, ...parts]);
}
function der(tag, ...values) {
  const body = Buffer.concat(values.map((v) => Buffer.isBuffer(v) ? v : Buffer.from(v)));
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}
const sequence = (...v) => der(0x30, ...v);
const set = (...v) => der(0x31, ...v);
const utf8 = (v) => der(0x0c, Buffer.from(v));
const oid = (...v) => der(0x06, Buffer.from(v));
const integer = (v) => der(0x02, v);
const sha256WithRsa = sequence(oid(0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0b), der(0x05));
function pem(label, value) {
  return `-----BEGIN ${label}-----\n${value.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
}
function certificate(privateKey, publicKey) {
  const name = sequence(set(sequence(oid(0x55,0x04,0x03), utf8('Staging mock IdP localhost'))));
  const now = Date.now();
  const utc = (date) => der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(2)));
  const validity = sequence(utc(new Date(now - 60000)), utc(new Date(now + 30 * 86400000)));
  const altNames = sequence(der(0x87, Buffer.from([127,0,0,1])), der(0x82, Buffer.from('localhost')));
  const extensions = der(0xa3, sequence(
    sequence(oid(0x55,0x1d,0x13), der(0x01, Buffer.from([0xff])), der(0x04, sequence(der(0x01, Buffer.from([0xff]))))),
    sequence(oid(0x55,0x1d,0x0f), der(0x01, Buffer.from([0xff])), der(0x04, der(0x03, Buffer.from([2, 0xa4])))),
    sequence(oid(0x55,0x1d,0x25), der(0x04, sequence(oid(0x2b,0x06,0x01,0x05,0x05,0x07,0x03,0x01)))),
    sequence(oid(0x55,0x1d,0x11), der(0x04, altNames)),
  ));
  const randomSerial = randomBytes(16);
  const serial = randomSerial[0] & 0x80 ? Buffer.concat([Buffer.from([0]), randomSerial]) : randomSerial;
  const tbs = sequence(der(0xa0, integer(Buffer.from([2]))), integer(serial), sha256WithRsa, name, validity, name,
    publicKey.export({ type: 'spki', format: 'der' }), extensions);
  const signer = createSign('RSA-SHA256');
  signer.update(tbs);
  return pem('CERTIFICATE', sequence(tbs, sha256WithRsa, der(0x03, Buffer.from([0]), signer.sign(privateKey))));
}
function loadOrCreateIdentity(root = ROOT) {
  mkdirSync(root, { recursive: true });
  const certPath = join(root, 'ca.pem');
  const keyPath = join(root, 'signing-key.pem');
  const passwordsPath = join(root, 'test-users.json');
  const tokenPath = join(root, 'introspection-token.txt');
  let valid = [certPath, keyPath, passwordsPath, tokenPath].every(existsSync);
  if (valid) {
    try {
      const cert = new X509Certificate(readFileSync(certPath));
      valid = new Date(cert.validTo).getTime() > Date.now() + 86400000 &&
        cert.checkPrivateKey(createPrivateKey(readFileSync(keyPath))) &&
        cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1');
    } catch { valid = false; }
  }
  if (!valid) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const key = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    writeFileSync(keyPath, key, { mode: 0o600, flag: 'w' });
    writeFileSync(certPath, certificate(pair.privateKey, pair.publicKey), { mode: 0o600, flag: 'w' });
    writeFileSync(passwordsPath, JSON.stringify(Object.fromEntries(Object.keys(USERS).map((u) => [u, randomBytes(24).toString('base64url')])), null, 2), { mode: 0o600, flag: 'w' });
    writeFileSync(tokenPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'w' });
  } else {
    // Upgrade an existing local fixture without rotating its signing key or
    // replacing already-issued test-user passwords.
    const passwords = JSON.parse(readFileSync(passwordsPath, 'utf8'));
    let changed = false;
    for (const user of Object.keys(USERS)) {
      if (!passwords[user]) {
        passwords[user] = randomBytes(24).toString('base64url');
        changed = true;
      }
    }
    if (changed) writeFileSync(passwordsPath, JSON.stringify(passwords, null, 2), { mode: 0o600, flag: 'w' });
  }
  return {
    certPath,
    cert: readFileSync(certPath, 'utf8'),
    key: readFileSync(keyPath, 'utf8'),
    passwords: JSON.parse(readFileSync(passwordsPath, 'utf8')),
    introspectionToken: readFileSync(tokenPath, 'utf8').trim(),
  };
}
function equal(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
function respond(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8192) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); }
    });
    req.on('end', () => resolveBody(data));
    req.on('error', reject);
  });
}
function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function createMockIdp({ port = PORT, root = ROOT } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Mock IdP is forbidden in production');
  const identity = loadOrCreateIdentity(root);
  const issuer = () => `https://${HOST}:${server.address()?.port || port}`;
  const publicJwk = require('node:crypto').createPublicKey(identity.key).export({ format: 'jwk' });
  const kid = require('node:crypto').createHash('sha256').update(identity.cert).digest('hex').slice(0, 16);
  const issued = new Map();
  const server = createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2' }, async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { status: 'ok', fixture: 'staging-mock-idp' });
      if (req.method === 'GET' && req.url === '/.well-known/openid-configuration') return respond(res, 200, {
        issuer: issuer(), jwks_uri: `${issuer()}/jwks`, token_endpoint: `${issuer()}/token`,
        introspection_endpoint: `${issuer()}/introspect`, id_token_signing_alg_values_supported: ['RS256'],
      });
      if (req.method === 'GET' && req.url === '/jwks') return respond(res, 200, { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] });
      if (req.method === 'POST' && req.url === '/token') {
        const body = JSON.parse(await readBody(req));
        const user = USERS[body.username];
        if (!user || !equal(body.password, identity.passwords[body.username])) return respond(res, 401, { error: 'invalid_credentials' });
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: issuer(), aud: user.audience, sub: user.sub, purpose: user.purpose,
          jti: randomUUID(), sid: randomUUID(), amr: ['pwd', 'mfa'],
          acr: 'urn:garant:acr:phishing-resistant', scope: user.scope,
          auth_time: now, iat: now, exp: now + 300 };
        const parts = [base64url({ alg: 'RS256', typ: 'JWT', kid }), base64url(claims)];
        const signer = createSign('RSA-SHA256');
        signer.update(parts.join('.'));
        const token = `${parts.join('.')}.${signer.sign(identity.key).toString('base64url')}`;
        issued.set(token, claims);
        return respond(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 300 });
      }
      if (req.method === 'POST' && req.url === '/introspect') {
        if (!equal(req.headers.authorization, `Bearer ${identity.introspectionToken}`)) return respond(res, 401, { error: 'unauthorized' });
        const token = new URLSearchParams(await readBody(req)).get('token');
        const claims = issued.get(token);
        return respond(res, 200, claims && claims.exp > Math.floor(Date.now() / 1000)
          ? { active: true, sub: claims.sub, jti: claims.jti, sid: claims.sid, scope: claims.scope, token_type: 'access_token' }
          : { active: false });
      }
      respond(res, 404, { error: 'not_found' });
    } catch { if (!res.headersSent) respond(res, 400, { error: 'bad_request' }); }
  });
  return { server, issuer, identity, users: USERS, start: () => new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => { server.removeListener('error', reject); resolveStart(server.address().port); });
  }) };
}

if (require.main === module && process.argv.includes('--check')) {
  const certPath = join(ROOT, 'ca.pem');
  if (!existsSync(certPath)) { console.error('Mock IdP certificate not found. Start idp:staging first.'); process.exitCode = 1; }
  else get(`https://${HOST}:${PORT}/health`, { ca: readFileSync(certPath) }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      console.log(body);
      if (response.statusCode !== 200) process.exitCode = 1;
    });
  }).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
} else if (require.main === module) {
  const fixture = createMockIdp();
  fixture.start().then((port) => {
    const base = `https://${HOST}:${port}`;
    const envPath = join(ROOT, 'staging-idp.env');
    const environment = [
      `ADMIN_STEP_UP_ISSUER=${base}`, 'ADMIN_STEP_UP_AUDIENCE=garant-admin',
      `ADMIN_STEP_UP_JWKS_URL=${base}/jwks`, `ADMIN_STEP_UP_INTROSPECTION_URL=${base}/introspect`,
      `ADMIN_STEP_UP_INTROSPECTION_TOKEN=${fixture.identity.introspectionToken}`,
      'ADMIN_STEP_UP_REQUIRED_SCOPE=garant:admin:step-up',
      'ADMIN_STEP_UP_REQUIRED_ACR=urn:garant:acr:phishing-resistant',
      `ARBITRATOR_STEP_UP_ISSUER=${base}`, 'ARBITRATOR_STEP_UP_AUDIENCE=garant-arbitrator',
      `ARBITRATOR_STEP_UP_JWKS_URL=${base}/jwks`, `ARBITRATOR_STEP_UP_INTROSPECTION_URL=${base}/introspect`,
      `ARBITRATOR_STEP_UP_INTROSPECTION_TOKEN=${fixture.identity.introspectionToken}`,
      'ARBITRATOR_STEP_UP_REQUIRED_SCOPE=garant:arbitrator:step-up',
      'ARBITRATOR_STEP_UP_REQUIRED_ACR=urn:garant:acr:phishing-resistant',
    ];
    writeFileSync(envPath, `${environment.join('\n')}\n`, { mode: 0o600, flag: 'w' });
    console.log(`Staging mock IdP ready (loopback only)\nIssuer: ${base}\nJWKS: ${base}/jwks\nIntrospection: ${base}/introspect\nHealth: ${base}/health\nCertificate: ${fixture.identity.certPath}\nGenerated backend values: ${envPath}`);
    console.log(`Before starting the backend in PowerShell: $env:NODE_EXTRA_CA_CERTS='${fixture.identity.certPath}'`);
    for (const [email, user] of Object.entries(USERS)) console.log(`${email} / sub=${user.sub} / password=${fixture.identity.passwords[email]}`);
    console.log(`Introspection bearer token: ${fixture.identity.introspectionToken}`);
    console.log('MFA claim is simulated; this fixture is not an MFA provider.');
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { createMockIdp, USERS };
