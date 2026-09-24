// End-to-end, loopback-only acceptance check for the mock IdP and both guards.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const idpRoot = join(root, '.local-e2e', 'mock-idp');
const passwords = JSON.parse(readFileSync(join(idpRoot, 'test-users.json'), 'utf8'));
const ca = readFileSync(join(idpRoot, 'ca.pem'));

function request(url, method = 'GET', body, headers = {}) {
  const secure = url.startsWith('https:');
  const client = secure ? https : http;
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((done, fail) => {
    const req = client.request(url, {
      method,
      ca: secure ? ca : undefined,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
      timeout: 10000,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { done({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }
        catch { done({ status: res.statusCode, body: text }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', fail);
    if (data) req.write(data);
    req.end();
  });
}

async function identity(email, telegramId, expectedId) {
  const login = await request('http://127.0.0.1:3001/api/auth/dev-login', 'POST', { telegramId });
  assert.equal(login.status, 200, `${email} application login failed: ${JSON.stringify(login.body)}`);
  assert.equal(login.body.user.id, expectedId);
  const assertion = await request('https://127.0.0.1:9443/token', 'POST', { username: email, password: passwords[email] });
  assert.equal(assertion.status, 200, `${email} IdP login failed`);
  assert.ok(assertion.body.access_token);
  return { app: login.body.accessToken, stepUp: assertion.body.access_token };
}

async function main() {
  const admin = await identity('admin@local.test', 990000001, '11111111-1111-4111-8111-111111111111');
  const arbitrator = await identity('arbitrator@local.test', 990000002, '22222222-2222-4222-8222-222222222222');
  const adminHeaders = { authorization: `Bearer ${admin.app}`, origin: 'https://admin.local.test' };
  const adminUrl = 'http://127.0.0.1:3001/api/admin/ops/outbox/stats';
  const adminMissing = await request(adminUrl, 'GET', undefined, adminHeaders);
  assert.equal(adminMissing.status, 401, 'Admin request without MFA assertion must fail');
  const adminSwapped = await request(adminUrl, 'GET', undefined, { ...adminHeaders, 'x-admin-step-up': arbitrator.stepUp });
  assert.ok([401, 403].includes(adminSwapped.status), `Arbitrator assertion must not authorize admin: ${adminSwapped.status} ${JSON.stringify(adminSwapped.body)}`);
  const adminAllowed = await request(adminUrl, 'GET', undefined, { ...adminHeaders, 'x-admin-step-up': admin.stepUp });
  assert.equal(adminAllowed.status, 200, `Admin guarded route failed: ${JSON.stringify(adminAllowed.body)}`);
  for (const path of ['users', 'deals', 'payments', 'disputes']) {
    const listing = await request(`http://127.0.0.1:3001/api/admin/${path}`, 'GET', undefined, { ...adminHeaders, 'x-admin-step-up': admin.stepUp });
    assert.equal(listing.status, 200, `Admin ${path} listing failed: ${JSON.stringify(listing.body)}`);
  }

  const arbitratorHeaders = { authorization: `Bearer ${arbitrator.app}`, origin: 'https://arbitrator.local.test' };
  const arbitratorUrl = 'http://127.0.0.1:3001/api/arbitration/arbitrators/me';
  const arbitratorMissing = await request(arbitratorUrl, 'GET', undefined, arbitratorHeaders);
  assert.equal(arbitratorMissing.status, 401, 'Arbitrator request without MFA assertion must fail');
  const arbitratorAllowed = await request(arbitratorUrl, 'GET', undefined, { ...arbitratorHeaders, 'x-arbitrator-step-up': arbitrator.stepUp });
  assert.equal(arbitratorAllowed.status, 200, `Arbitrator guarded route failed: ${JSON.stringify(arbitratorAllowed.body)}`);
  assert.equal(arbitratorAllowed.body.userId, '22222222-2222-4222-8222-222222222222');
  console.log(JSON.stringify({ status: 'ok', admin: 200, arbitrator: 200, adminListings: 4, missingStepUp: 401, swappedRole: 'denied' }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
