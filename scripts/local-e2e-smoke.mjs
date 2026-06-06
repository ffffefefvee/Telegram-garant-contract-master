#!/usr/bin/env node
/**
 * Local E2E smoke test runner.
 *
 * Boots a fresh user-service in SQLite + stub-blockchain mode (see
 * scripts/local-e2e.env) and walks through the deal happy path + a few
 * negative cases via plain HTTP, asserting status codes and state
 * transitions. Writes findings to stdout.
 *
 * This is NOT a unit test — it talks to a running backend over HTTP. It
 * exists so we catch wiring bugs that mocked tests can't see (middleware,
 * module composition, validation pipes, response shapes).
 *
 * Run:  npm run e2e         (from repo root, after `npm run e2e:bg` started server)
 * Or:   bash scripts/local-e2e.sh
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3099/api';

let failures = 0;
let passed = 0;

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

async function http(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const init = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(url, init);
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    log(`\u2713 ${name}`);
  } else {
    failures++;
    log(`\u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

async function waitForBackend(maxSeconds = 60) {
  // Hit the dev-login endpoint with empty body — we don't care about the
  // response, only that the server *responded at all* (any HTTP status
  // means the listener is up). 404/400/403 are all fine signals.
  for (let i = 0; i < maxSeconds * 2; i++) {
    try {
      const res = await fetch(`${BASE}/auth/dev-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status >= 200 && res.status < 600) return;
    } catch {
      // backend not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`backend did not respond on ${BASE} within ${maxSeconds}s`);
}

async function main() {
  console.log(`\n=== local-e2e-smoke against ${BASE} ===\n`);

  console.log('[wait] backend ready');
  await waitForBackend();

  console.log('\n[step] dev-login: buyer + seller');
  const buyer = await http('POST', '/auth/dev-login', {
    body: { telegramId: 100100, username: 'e2e_buyer', firstName: 'Buyer' },
  });
  check('buyer dev-login 200', buyer.status === 200, `got ${buyer.status} ${JSON.stringify(buyer.body)?.slice(0, 200)}`);
  check('buyer JWT shape', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(buyer.body?.accessToken ?? ''));
  const buyerToken = buyer.body?.accessToken;
  const buyerUser = buyer.body?.user;

  const seller = await http('POST', '/auth/dev-login', {
    body: { telegramId: 200200, username: 'e2e_seller', firstName: 'Seller' },
  });
  check('seller dev-login 200', seller.status === 200);
  const sellerToken = seller.body?.accessToken;
  const sellerUser = seller.body?.user;

  console.log('\n[step] auth gate');
  const noToken = await http('GET', '/deals');
  check('GET /deals without token \u2192 401', noToken.status === 401, `got ${noToken.status}`);

  console.log('\n[step] deal create + accept invite');
  const dealCreate = await http('POST', '/deals', {
    token: buyerToken,
    body: {
      type: 'service',
      amount: 100,
      currency: 'USDT',
      description: 'E2E smoke deal',
      title: 'Smoke deal',
      sellerId: sellerUser?.id,
    },
  });
  check('POST /deals 201', dealCreate.status === 201, `got ${dealCreate.status} ${JSON.stringify(dealCreate.body)?.slice(0, 300)}`);
  const dealId = dealCreate.body?.id;
  check('deal status=pending_acceptance', dealCreate.body?.status === 'pending_acceptance');

  const accepted = await http('POST', `/deals/${dealId}/accept`, { token: sellerToken });
  check('seller accepts \u2192 200', accepted.status === 200 || accepted.status === 201);
  check('deal status=pending_payment after accept', accepted.body?.status === 'pending_payment');

  console.log('\n[step] role-protected ops');
  const sellerCantConfirm = await http('POST', `/deals/${dealId}/confirm`, { token: sellerToken });
  check('seller confirmReceipt \u2192 4xx', sellerCantConfirm.status >= 400 && sellerCantConfirm.status < 500, `got ${sellerCantConfirm.status}`);

  const earlyDispute = await http('POST', `/deals/${dealId}/dispute`, {
    token: buyerToken,
    body: { reason: 'too early' },
  });
  check('dispute before payment \u2192 4xx', earlyDispute.status >= 400 && earlyDispute.status < 500, `got ${earlyDispute.status}`);

  console.log('\n[step] deal listing + messaging');
  const listed = await http('GET', '/deals?limit=10', { token: buyerToken });
  check('GET /deals 200', listed.status === 200);
  check('deal in list', Array.isArray(listed.body?.deals) && listed.body.deals.some((d) => d.id === dealId));

  const msg = await http('POST', `/deals/${dealId}/messages`, {
    token: buyerToken,
    body: { content: 'hello from e2e' },
  });
  check('POST /deals/:id/messages 201', msg.status === 201, `got ${msg.status}`);

  const msgs = await http('GET', `/deals/${dealId}/messages?limit=10&offset=0`, { token: buyerToken });
  check('GET /deals/:id/messages 200', msgs.status === 200);
  check('message echoed in list', Array.isArray(msgs.body) && msgs.body.some((m) => m.content === 'hello from e2e'));

  console.log('\n[step] cancel before payment');
  const cancelled = await http('POST', `/deals/${dealId}/cancel`, {
    token: buyerToken,
    body: { reason: 'changed mind' },
  });
  check('buyer can cancel pre-payment \u2192 200/201', cancelled.status === 200 || cancelled.status === 201, `got ${cancelled.status} ${JSON.stringify(cancelled.body)?.slice(0, 200)}`);
  check('deal status=cancelled', cancelled.body?.status === 'cancelled');

  console.log('\n[step] admin endpoints (non-admin user must be denied)');
  const treasuryAsBuyer = await http('GET', '/admin/treasury/summary', { token: buyerToken });
  check('non-admin \u2192 GET /admin/treasury/summary 403', treasuryAsBuyer.status === 403, `got ${treasuryAsBuyer.status}`);

  const auditAsBuyer = await http('GET', '/admin/audit-log', { token: buyerToken });
  check('non-admin \u2192 GET /admin/audit-log 403', auditAsBuyer.status === 403, `got ${auditAsBuyer.status}`);

  console.log('\n[step] notification preferences (default)');
  const prefs = await http('GET', '/notifications/preferences', { token: buyerToken });
  check('GET /notifications/preferences 200', prefs.status === 200, `got ${prefs.status}`);

  console.log('\n[step] availability toggle requires arbitrator role');
  const togglePlain = await http('PATCH', '/arbitration/arbitrators/me/availability', {
    token: buyerToken,
    body: { availability: 'AWAY' },
  });
  check('non-arbitrator availability toggle \u2192 4xx', togglePlain.status >= 400 && togglePlain.status < 500, `got ${togglePlain.status}`);

  console.log(`\n=== summary: ${passed} passed, ${failures} failed ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL', err);
  process.exit(2);
});
