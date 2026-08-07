# Phase 0 — Financial Safety Release

## Purpose

This release adds a fail-closed stop for **all backend-signed relay writes**.
It is a containment control, not a replacement for payment idempotency,
reconciliation, a double-entry ledger, or KMS signing.

`MONEY_EGRESS_ENABLED` defaults to disabled. The literal string `true` (or a
boolean `true` in a test configuration) is the only value that permits a
relay transaction to start. Missing, malformed, placeholder, and false values
are all treated as disabled.

The control runs in `RelayTxQueue` immediately before the queued callback
uses the relay signer. Current relay-signed paths covered by that queue are:

- ERC-20 transfers from the hot wallet;
- escrow creation, funding notification, assignment, deadline extension, and
  expiry;
- treasury reconciliation writes.

Read-only chain calls and client-signed user/arbitrator transactions are not
backend money egress and are intentionally outside this control.

## Deployment procedure

1. Deploy this release with `MONEY_EGRESS_ENABLED=false` in every production
   process, worker, and scheduled-job deployment. Use
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
   when deploying the included Compose topology.
2. Confirm startup logs contain `Money egress is PAUSED` and no process has an
   old deployment image capable of signing.
3. Send a signed sandbox webhook or trigger a controlled scheduled job. The
   application may record the event, but the relay callback must not run and
   no transaction must appear for the relay address.
4. Keep egress disabled while Phases 1–5 are completed. Enabling it in any
   environment requires the release gate, two authorized approvers, and a
   post-enable reconciliation check.

## Emergency containment

If a payment, reconciliation, signer, or ledger anomaly is detected:

1. Set `MONEY_EGRESS_ENABLED=false` and restart every backend/worker instance
   using the controlled deployment process.
2. Verify all relay write attempts fail with `MONEY_EGRESS_DISABLED`.
3. Preserve provider events and transaction hashes; do **not** blindly replay
   webhooks or re-submit transfers.
4. Reconcile the hot-wallet, escrow, provider, and database state before any
   controlled resume.

The environment variable is intentionally a short-lived Phase 0 control.
Phase 4 replaces it with an audited, access-controlled flag service and
signer-side policy.

## Verification commands

Run from `services/user-service`:

```bash
npm run test:security:phase0
npm run build
```

The first command is the Phase 0 regression suite. The build is a mandatory
repository gate; at the time this release was introduced, it remains blocked
by the pre-existing arbitration method-signature errors tracked for Phase 1.
Do not treat the targeted test pass as a production-release approval.
