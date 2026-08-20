# Native TON ingestion incident runbook

Date: 2026-08-18

This runbook covers finalized native-TON funding and lifecycle ingestion. It
does not authorize production funds: `TonEscrowAdapter.isReady()` remains
hard-disabled until every release gate is closed.

## Non-negotiable recovery invariants

- Never edit chain evidence, mark an event applied, force a deal state, or move
  a cursor past an unexamined transaction.
- Never requeue contradictory evidence. A requeued accepted event must pass the
  ordinary independent reconciliation and business-application path again.
- Keep `TON_NATIVE_INGESTION_ENABLED=false` when provider provenance,
  reconciliation, database integrity, or deployed code identity is uncertain.
- Preserve the primary v3 response, secondary raw transaction BOC, account
  code/data BOCs, source identifiers, LT, hash and masterchain sequence number.
- Use a launch-network/account allowlist and verify the approved release hash
  before enabling a worker.

## Triage

1. Check `ton_native_manual_review_watches`, `ton_native_stopped_events`, worker
   failures, provider latency and the reconciliation-source health separately.
2. Inspect watches with `GET /api/admin/ops/ton-native/watches`, filtering by
   deal, network or status. Record the durable LT/hash/masterchain cursor.
3. Inspect rejected observations with
   `GET /api/admin/ops/ton-native/rejected-events`, filtering by deal, network
   or stable `reasonCode`; retrieve full persisted evidence at
   `GET /api/admin/ops/ton-native/rejected-events/:eventId`.
4. For stopped accepted events, use
   `GET /api/admin/ops/ton-native/manual-reviews/:eventId`. Do not infer
   settlement from a successful primary-provider response alone.

## Provider outage or missing secondary evidence

1. Disable ingestion if either source's integrity is uncertain. Normal
   transient unavailability may remain fail-closed without disabling the
   service when queues and alerts are bounded.
2. Confirm that no ledger/FSM effect occurred and that the event remains
   unapplied with the watch in `manual_review`.
3. Append an audited keep-blocked note. Restore the independent source and
   confirm its provenance before comparing the exact transaction and account
   state again.
4. Only after both sources agree may one super-admin request requeue using the
   inspected `lastApplyError`; a different super-admin must approve it.
5. Confirm the event passed reconciliation, applied once, produced balanced
   ledger movements and advanced the deal/watch to the expected state.

## Contradictory evidence or code/state mismatch

Keep the event blocked. Do not requeue until the discrepancy has a documented
root cause and the authoritative chain evidence has been independently
reconstructed. Compare the raw transaction hash, LT, inbound message, payload,
post-state hash, current code/data hashes and approved release manifest. Treat
an unexplained disagreement as a security incident, rotate affected provider
credentials, preserve logs and obtain contract/backend reviewer sign-off before
resuming. If deployed code or configuration differs, stop the launch rather
than attempting an operator correction.

## Bounded backlog scan

Backfill is for an active watch whose durable cursor is valid but whose provider
history exceeded the scheduled page bound. It is not for a `manual_review` or
terminal watch.

1. Inspect the watch and its cursor, then record why older pages are expected.
2. A super-admin calls
   `POST /api/admin/ops/ton-native/watches/:watchId/backfill` with a 20-1000
   character `reason` and `maxPages` from 1 through 10.
3. The command begins strictly after the persisted cursor and uses the normal
   finalized validation, append-only evidence, reconciliation and idempotent
   application path. It cannot rewrite or advance a cursor by fiat.
4. If `pageLimitReached` is true, inspect newly persisted rejected/accepted
   evidence and the new cursor before authorizing another bounded pass. Never
   loop automatically without an operator review between passes.

Every request has a required audit write before scanning. A missing audit entry
means the scan must not begin. Completion telemetry is supplemental; persisted
events, ledger entries and the watch cursor are the authoritative result.

## Recovery completion checklist

- Primary and independent sources agree on exact immutable evidence.
- No accepted event was applied more than once; all ledger entries balance.
- Rejected observations and operator reasons remain queryable and unchanged.
- The watch cursor points to an actually examined finalized transaction.
- Deal, watch, contract state and accounting agree on the same terminal or
  active state.
- Alerts clear only after this reconciliation, not merely after a provider
  returns to service.
- Incident timeline, two-person approvals and follow-up test are retained in
  the audit record.
