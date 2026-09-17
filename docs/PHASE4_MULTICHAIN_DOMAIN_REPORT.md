# Phase 4 common multichain domain report

Date: 2026-09-01

Status: release candidate; hosted implementation evidence green

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
- Clean-schema PostgreSQL Phase 3 regression gate: 11/11 tests passed.
- Clean-schema PostgreSQL Phase 4 exit gate: 6/6 tests passed.
- Focused common-domain/agreement/preparation suites: passed.
- Shared adapter conformance runs against both TON and Polygon.
- Full service lint and build: passed.
- Hosted CI implementation run
  [`35286167321`](https://github.com/ffffefefvee/Telegram-garant-contract-master/actions/runs/35286167321):
  all seven jobs passed at commit `a138d90289afc0a166c6489238c311e6f7b710c4`.

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

Local evidence and the hosted implementation run are green, including the
clean-schema PostgreSQL gates. The documentation-only evidence commit must also
pass the complete hosted CI matrix before the isolated release pull request is
merged. No readiness or real-funds flag was enabled.
