# ADR-019: Durable TON Jetton backend application

Date: 2026-09-01

Status: implemented and locally verified; PostgreSQL/hosted exit gate pending;
production authorization prohibited

## Decision

TON Jetton observations are applied through an immutable, versioned
preparation and an append-only evidence log. Mutable cursor, watch and
application projections are deliberately separated from their immutable source
records. One PostgreSQL transaction locks the event, preparation, watch and
deal, replays the verification-evidence policy and Ed25519 threshold approval,
posts the double-entry ledger movement, advances the deal FSM, records any
immutable action-intent consumption, updates the watch, and writes `appliedAt`
last.

Preparation retries converge only when every canonical field is identical.
Before funding, any mismatch creates a new version and supersedes only the old
awaiting-funding watch. A funded preparation is never mutated or silently
replaced. The canonical content commitment covers network/workchain,
code/config/StateInit/address, Jetton master and wallet code, sealed wallet and
verification evidence, terms and quote versions, participants and payout
addresses, exact economics, deadlines, funding query ID, and initializer and
reconciliation authorities.

## Protected invariants

- Raw observations are append-only and unique by network, account, logical
  time and transaction hash.
- Evidence is immutable; retry progress and `appliedAt` live separately.
- Cursor advances and manual rewinds append immutable checkpoints in the same
  transaction as the mutable high-water update.
- Backfill is bounded to 32 pages and 100 events per page.
- Workers claim one pending application with `FOR UPDATE SKIP LOCKED`.
- A failed business write rolls back the ledger, FSM, intent and watch together;
  `appliedAt` cannot survive that rollback.
- The application worker does not trust persisted success booleans. It
  recomputes the raw evidence hash and application commitment, replays the
  evidence policy and threshold signatures, and binds the approved artifact to
  the exact network, masterchain sequence, transaction hash/LT, proof
  composition and preparation.
- Funding and egress fail closed when their chain or the global circuit state is
  absent, unavailable or tripped.
- Any one-smallest-unit assets/liabilities discrepancy trips the chain breaker.
  An impossible negative escrow liability trips the global shared-ledger
  breaker.
- Polygon relay execution checks the independent Polygon and global breakers
  immediately before broadcast; TON and Polygon stops remain isolated unless a
  shared incident trips the global stop.
- There is no application reset API for a tripped breaker.

## Failure and recovery model

Automated application failures remain pending for bounded retry. Reaching the
attempt limit, or any proof/source disagreement, moves the event to manual
review with `appliedAt = null`. Requeue requires an append-only operator review
record. A proof/source disagreement also trips the TON breaker in an independent
transaction so the stop survives rollback of the failed business transaction.

The scheduler is disabled unless `TON_JETTON_APPLICATION_WORKER_ENABLED=true`.
Enabling that worker still does not enable the real-funds adapter.

## Migration and rollback

Migration `1717900000000-CreateTonJettonPreparationsAndBreakers.ts` creates the
preparation, watch, action intent/consumption, cursor checkpoint, application
review, reconciliation snapshot, breaker and breaker-audit structures. Database
triggers reject updates/deletes of immutable records. The migration refuses to
reinterpret a nonempty legacy isolated Jetton-event table and seeds closed TON,
Polygon and global breaker rows.

Rollback is code-and-schema rollback only before production data exists. Once a
preparation or evidence record exists, operators must preserve it as audit
evidence; a funded preparation must never be downgraded or rewritten.

## Assurance and remaining gate

Focused unit suites and the backend build pass locally. The PostgreSQL exit
suite covers preparation convergence and immutability, duplicate observations,
cursor recovery, two-worker concurrency, injected crashes at every business
write boundary, action-consumption rollback, source disagreement/manual review,
partial payout recovery, exact assets/liabilities equality and one-unit breaker
activation.

Phase 3 is not complete until that suite and the complete hosted CI matrix pass
from a clean checkout. `TonEscrowAdapter.isReady()` remains hard false after
this gate; testnet slices, audit and operational release gates are still
mandatory.
