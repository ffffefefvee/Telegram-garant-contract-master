# Phase 3 durable TON Jetton integration report

Date: 2026-09-01

Decision: local implementation candidate; hosted PostgreSQL exit evidence
pending; real funds prohibited

## Delivered

- Immutable, content-addressed, versioned Jetton preparations and one active
  watch per deal.
- Immutable lifecycle action intents and append-only consumption records.
- Append-only finalized observations, per-account cursors, immutable cursor
  checkpoints, bounded backfill and audited manual-review requeue.
- `FOR UPDATE SKIP LOCKED` application with one atomic ledger/FSM/intent/watch
  transaction and `appliedAt` written last.
- Cryptographic replay of Phase 1 verification evidence and threshold signer
  approval at the application boundary.
- Per-TON, per-Polygon and global durable circuit breakers with immutable audit,
  one-unit discrepancy detection and fail-closed missing control-plane state.
- Polygon relay enforcement of its independent chain/global breaker immediately
  before transaction execution.
- Append-only Jetton assets/liabilities reconciliation snapshots, including a
  global stop for impossible negative escrow liabilities.
- A scheduler that is off by default and stops automated processing on manual
  review.
- PostgreSQL migration triggers that protect preparations, observations,
  intents, consumptions, checkpoints, reviews, reconciliation snapshots and
  breaker audits from update/delete.

## Local evidence

- Preparation, durable-ingestion, scheduler, action-intent, transactional
  application, ledger-reconciliation, circuit-breaker and Polygon relay focused
  suites pass: 8 suites / 59 tests.
- The latest transactional-application plus ledger-reconciliation run passed
  2 suites / 9 tests.
- `npm run build` passes after the threshold-evidence replay and negative-ledger
  hardening.
- The complete backend run passes 99 suites / 994 tests, with only the gated
  PostgreSQL suite skipped (11 tests).
- The PostgreSQL suite compiles and is intentionally skipped unless
  `RUN_PHASE3_POSTGRES=true`.
- A local PostgreSQL container could not be obtained because the Docker Hub TLS
  pull timed out; this is not accepted as exit evidence. GitHub Actions uses a
  PostgreSQL 15 service and is the authoritative pending run.

## PostgreSQL exit matrix

The gated suite `ton-jetton-phase3.postgres.spec.ts` demonstrates:

1. identical preparation retry convergence and immutable versioning;
2. duplicate-event convergence and immutable evidence;
3. cursor checkpoint recovery;
4. concurrent two-worker `SKIP LOCKED` application;
5. rollback after injected ledger, deal, intent, watch and final-application
   write failures;
6. immediate manual review and TON-only stop on source disagreement;
7. append-only operator evidence before a stopped event can be requeued;
8. partial seller/treasury payout recovery without duplicate postings;
9. exact assets-equal-liabilities reconciliation; and
10. one-unit mismatch activation of the correct breaker.

## Enablement evidence still required

- Green hosted PostgreSQL suite and complete CI matrix from the Phase 3 PR.
- Review of the migration and rollback path against a clean PostgreSQL schema.
- Merge commit and recorded rollback point.
- Phases 4–9, including testnet recovery slices, privileged-operation drills,
  external audit, seven-day staging reconciliation and closed beta.

No Phase 3 artifact changes `TonEscrowAdapter.isReady()` or authorizes signing,
broadcast, production key custody or real-funds settlement.
