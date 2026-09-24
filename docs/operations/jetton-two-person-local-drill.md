# Local exercise: Jetton two-person cursor recovery

- Status: LOCAL PASS ONLY. This is not an external two-human release drill.
- Owner: Engineering automation. Participants: `recovery1@local.test` and
  `recovery2@local.test`, distinct synthetic IdP identities. The test supplies
  the `super_admin` application role after token verification; it does not
  exercise the HTTP authentication/RBAC middleware. No human operator or
  independent witness participated.
- UTC start/end: 2026-09-24 07:24:11.496 / 07:24:11.548.
- Measured request-to-approval recovery time: 52 ms (excludes fixture setup).
- Tested source: the commit containing this report, based on `b904fd8`.
  Reproduce with `npm --prefix services/user-service run test:postgres:local`;
  the test is `ton-jetton-phase3.postgres.spec.ts` / `executes two-person
  recovery using two HTTPS mock-IdP assertions and a durable PostgreSQL request`.
- Environment: isolated disposable PostgreSQL 15 database; in-process offline
  HTTPS mock IdP with RS256, JWKS and online introspection. The already-running
  local staging stack and its persistent database were not modified. Real-money
  egress was disabled.
- Initial state: one immutable synthetic finalized Jetton event; cursor at LT
  `100`; money ledger entries `0`. No live chain, queue or nonce was involved.
- Failure/action injected: requester created an immutable five-minute cursor
  rewind intent to the empty baseline. Self-approval was attempted and denied;
  a different identity and IdP session approved it.
- Expected invariant: no self-approval, no unaudited cursor rewrite, no value
  movement, and zero unexplained ledger delta.
- Observed decision/steps: the request was inspected by service guards and
  approved through the two-person recovery service. No alert destination or
  human decision was exercised. The HTTPS assertions were verified against
  issuer, audience, JWKS, MFA/ACR, scope, token age and live introspection.
- Evidence: local test output recorded request
  `d0f45b22-8974-445c-ad4e-c3944e820810` in the disposable database;
  the automated test checks terminal `executed` status, one immutable recovery
  checkpoint and two audit rows. The disposable database was removed after the
  gate. No tokens, passwords, signing keys or private evidence are retained.
- Final state: cursor at the empty baseline, ledger entries `0`, explained
  delta `0`; chain, queue, nonce and external evidence state unchanged/not
  exercised. The whole Phase 3/4/5/6 PostgreSQL gate passed 35/35.
- Defects/retest: a test-only audit SQL type mismatch was corrected before this
  successful run. No production defect was found. Automated local sign-off only;
  external two-human, real-IdP, concurrency and operational sign-off remain
  BLOCKED.
