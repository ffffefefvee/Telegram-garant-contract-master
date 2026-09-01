# Phase 4 common multichain domain report

Date: 2026-09-01

Status: local candidate; hosted evidence pending

## Protected invariant

No funding or settlement action may change network, chain, asset, terms, quote,
or atomic economics across the API, adapter, persistence, or ledger boundary.
Both parties must confirm the same persisted terms and quote before funding.

## Implementation evidence

- Versioned common types cover network, asset, terms, quote, transaction
  references, funding/settlement status, payout availability, balances, and
  normalized reconciliation.
- Canonical quote hashing and atomic conservation validation reject stale,
  expired, malformed, one-unit-drifted, and mutated quotes.
- Both adapters implement the same expanded interface.
- Polygon emits unsigned role-scoped actions but fixes funding/reconciliation
  finality false until Phase 5.
- TON money actions remain hard-disabled.
- Immutable quote and confirmation entities plus PostgreSQL constraints and
  triggers enforce the agreement boundary independently of application code.
- `SettlementAgreementService` serializes quote versions, derives party roles
  from authenticated user IDs, and replays both confirmations before funding.
- Jetton preparation must match the authoritative common quote pointer.
- Hosted CI now contains a separate Phase 4 PostgreSQL gate with six cases.

## Local verification

- Backend build: passed.
- Full backend unit suite: 102 suites / 1,035 tests passed.
- PostgreSQL-only suites: 17 tests skipped locally by their explicit environment
  gates (11 Phase 3 and 6 Phase 4); they require the hosted PostgreSQL service.
- Focused common-domain/agreement/preparation suites: passed.
- Shared adapter conformance runs against both TON and Polygon.
- Strict changed-file lint: passed before the full suite; a final lint pass is
  required after documentation review.

## Threat-model change

The system no longer relies solely on mutable deal columns or caller-described
quote fields. Quote economics and confirmations are append-only evidence, and a
database trigger prevents an alternate code path from funding a native
multichain deal without both exact confirmations.

Remaining Phase 5 threats are explicit: Polygon reorg/finality, independent RPC
reconciliation, durable indexing/backfill, nonce replacement, stuck transaction
recovery, relayer monitoring, and contract hardening. Consequently Polygon
verification and reconciliation results remain non-finalizing.

## Gate status

Local candidate evidence is green. Phase 4 is not complete until its clean-schema
PostgreSQL suite and the complete hosted CI matrix pass after Phase 3 has merged.
No readiness or real-funds flag was enabled.
