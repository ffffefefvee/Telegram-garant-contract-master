# Phase 5 Polygon lifecycle report

Date: 2026-09-01

Status: local candidate; hosted and operational evidence pending

## Implemented controls

- Immutable deployed six-decimal token allowlist per factory.
- Separate governance, relay, pauser and recovery roles.
- Chain-wide stop for new exposure and normal settlement egress.
- Paused-state buyer recovery with exact full-balance conservation.
- Two-source finalized block and escrow-state agreement.
- Durable bounded event indexing/backfill with append-only evidence.
- Finalized-reorg detection connected to the Polygon circuit breaker.
- Append-only quote/identity/balance reconciliation and relayer POL floor.
- Cross-process PostgreSQL nonce allocation and idempotent operation keys.
- Persist-before-wait broadcast records, same-nonce fee bump, bounded stuck
  recovery and terminal-revert handling.
- Production configuration refuses money egress without Web3Signer, migrations,
  indexing, reconciliation, independent RPCs, 64+ confirmations and gas floor.

## Local evidence

- Solidity compile and Solhint: passed.
- Contract suite: 122/122 tests passed (8 new Phase 5 adversarial cases).
- Local Amoy gas rehearsal: passed; 9,219,814 total gas and 13,829,721 with the
  50% deployment margin.
- Backend build and strict changed-file ESLint: passed.
- Full backend suite: 104 suites / 1,064 tests passed.
- Three PostgreSQL-only suites are explicitly skipped locally: 23 tests total
  (Phase 3: 11, Phase 4: 6, Phase 5: 6).
- The Phase 5 hosted PostgreSQL gate covers immutable/deduplicated event
  evidence, concurrent distinct nonces, concurrent idempotent retry,
  single-worker replacement, bounded breaker escalation and cursor/reorg
  handling.

The local PostgreSQL gate could not run because the isolated PostgreSQL Docker
image download repeatedly failed at the registry TLS handshake. It remains a
blocking hosted CI step; this report does not substitute unit evidence for it.

## Remaining exit evidence

- Green clean-schema Phase 3, Phase 4 and Phase 5 PostgreSQL gates in hosted CI.
- Green contract tests, coverage policy, Slither and the complete repository CI
  matrix on the sequential Phase 5 PR.
- A fresh deterministic Amoy deployment using distinct privileged identities.
- Web3Signer acceptance for create/fund/release plus interrupted-transfer
  recovery, with transaction, nonce, fee and balance evidence.
- Amoy refund, timeout, dispute, resolution, pause and emergency-recovery drills.
- At least two production-candidate RPC operators, lag/outage/reorg drills and
  alert delivery evidence.
- Independent Polygon contract/backend review with every critical/high finding
  closed.

Until all remaining evidence is attached, Phase 5 is not complete and
`MONEY_EGRESS_ENABLED` must remain false for real funds.
