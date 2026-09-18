# Phase 5 Polygon lifecycle report

Date: 2026-09-18

Status: technical candidate; local and hosted implementation gates green;
operational and independent-review evidence pending

## Implemented controls

- Immutable deployed six-decimal token allowlist per factory.
- Separate governance, relay, pauser and recovery roles.
- Chain-wide stop for new exposure and normal settlement egress.
- Paused-state buyer recovery with exact full-balance conservation.
- Two-source finalized block and escrow-state agreement.
- Byte-for-byte independent-RPC agreement for finalized logs and cursor block
  hashes before persistence.
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
- Contract suite: 123/123 tests passed (9 Phase 5 hardening cases).
- Local Amoy gas rehearsal: passed; 9,219,814 total gas and 13,829,721 with the
  50% deployment margin.
- Backend build and full non-mutating ESLint: passed.
- Production dependency audits for contracts and user-service: zero
  vulnerabilities.
- Full backend suite: 104 runnable suites / 1,071 tests passed; the 23
  PostgreSQL-gated tests were intentionally skipped in this unit run.
- Clean-schema PostgreSQL 15 regression gates: Phase 3 11/11, Phase 4 6/6,
  and Phase 5 6/6 passed.
- The Phase 5 PostgreSQL gate covers immutable/deduplicated event
  evidence, concurrent distinct nonces, concurrent idempotent retry,
  single-worker replacement, bounded breaker escalation and cursor/reorg
  handling.
- Local persistent-chain rehearsal passed: deterministic deployment, 48/48
  deployment/code/role checks, create/fund/release, exact seller and treasury
  balances, interrupted-transfer recovery without a second debit, replay no-op,
  and low-s signatures. This used a Hardhat loopback chain and impersonated
  relay, not Amoy or Web3Signer.

## Hosted evidence

- The complete repository CI matrix passed on the sequential Phase 5 draft PR
  at commit `1a6ac064a92eb5c8def05d94fb44c2cd36e0736e` in GitHub Actions run
  [35323151830](https://github.com/ffffefefvee/Telegram-garant-contract-master/actions/runs/35323151830).
- All seven jobs passed: contracts security/coverage/tests, user-service,
  mini-app, TON compatibility, TON authoritative Acton assurance, independent
  TON build-hash evidence and gitleaks.

## Remaining exit evidence

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
