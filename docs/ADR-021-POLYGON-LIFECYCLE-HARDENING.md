# ADR-021: Polygon lifecycle hardening

Date: 2026-09-01

Status: local candidate; hosted PostgreSQL, static-analysis, Amoy and external-review gates pending

## Context

The common Phase 4 adapter could compose unsigned Polygon wallet actions, but
it deliberately could not claim finality or reconciliation. The previous
backend used one RPC view, an in-memory relay queue and point-in-time contract
reads. A process restart, multiple workers, a stuck transaction or a provider
fork could therefore make operational state ambiguous.

The existing contracts already isolate each deal in a deterministic EIP-1167
clone, use `SafeERC20` and `ReentrancyGuard`, enforce role-scoped lifecycle
actions and conserve release/refund/dispute value. They lacked a chain-wide
pause and an independently authorized recovery path.

## Decision

### Contract boundary

Each factory permanently pins one deployed six-decimal token. Construction
rejects EOAs, missing metadata and any other decimal domain. Non-local deploys
require four distinct identities:

- governance/admin;
- relay;
- emergency pauser;
- recovery operator.

The pauser can stop new escrows, funding recognition, deadline extension and
normal settlement egress immediately. Only governance can resume. Cancellation,
expiry and deterministic pre-funding rescue remain available while paused.
The separate recovery role may return the complete funded/disputed escrow
balance to the buyer only while paused; an assigned dispute is closed first.

Implementations and factory/token references remain immutable. Shipping new
code requires a new factory, leaving in-flight clones on their original code.

### Finality and independent reads

`PolygonFinalityService` requires at least two independently configured RPC
sources. It selects the lowest observed head, subtracts the explicit finality
depth and accepts the anchor only when every source returns the exact block
hash. Escrow identity, economics, status and balance are read at that exact
block from every source and must serialize identically. Source disagreement
trips the Polygon circuit.

Production money egress now requires all of the following explicitly:

- Web3Signer rather than an application private key;
- migrations and reconciliation enabled;
- Polygon finalized-log indexing enabled;
- independent reconciliation required;
- two HTTPS RPC operators;
- at least 64 confirmations;
- a positive relayer gas-balance floor.

### Durable logs and reconciliation

The indexer stores only finalized raw logs with chain/transaction/log/block
identity and a canonical SHA-256 evidence commitment. Its cursor advances in
the same transaction. New escrow addresses discovered from `EscrowCreated` are
backfilled over the same block range before the cursor advances. A later hash
mismatch persists the incident and trips the circuit before the worker fails.

Finalized events are claimed with `FOR UPDATE SKIP LOCKED`; application and
`appliedAt` occur in one database transaction. Raw evidence is append-only.

Independent reconciliation binds the on-chain deal ID, buyer, seller, token,
amount and buyer fee to the authoritative quote, then compares escrow assets
with status-derived liabilities. Every pass/failure is append-only evidence.
A mismatch trips the Polygon/global settlement breaker. Relayer POL balance is
also checked at the independently agreed anchor.

### Relay nonce and replacement

Every backend-signed operation obtains a PostgreSQL advisory lock over its
logical operation key and reserves a nonce under a row lock. Concurrent workers
therefore receive either the same idempotent reservation or distinct nonces.
The exact transaction request and hash are persisted before waiting.

Stuck broadcasts are claimed optimistically by one worker, resent with the same
nonce and a bounded EIP-1559/legacy fee bump, and retain all replaced hashes.
Successful receipts become terminal. Reverted transactions do not replay.
Exhausting the bounded attempts marks the operation failed and trips the
Polygon circuit.

## Consequences

- A single provider cannot authorize Polygon state.
- A process restart cannot forget a broadcast or reuse an allocated nonce.
- A factory-wide stop does not depend on backend availability.
- Recovery authority cannot unpause, relay or resolve a dispute.
- A finalized reorg is treated as a safety incident, not silently rewound.
- No real-funds flag is enabled. Amoy acceptance, hosted gates, Slither and
  independent contract/backend review remain release prerequisites.

## Migration and rollback

Migration `1718100000000-CreatePolygonLifecycleHardening` adds finalized
cursors/events, relay nonce/transaction history and reconciliation evidence.
Evidence tables reject destructive updates/deletes. Rollback discards audit
and recovery state and therefore requires paused egress, no pending relay
transactions, an evidence export and an approved maintenance window.
