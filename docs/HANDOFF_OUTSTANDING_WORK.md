# Development handoff: outstanding work and publication state

Date: 2026-09-09

## Purpose and reading rule

This document is the authoritative handoff for the worktree snapshot being
preserved on 2026-09-09. It distinguishes three facts that must never be
collapsed into one claim:

- **implemented locally** means source and focused tests exist in this
  worktree;
- **verified locally** means the named command was run in this worktree;
- **exit gate closed** requires all technical, hosted, operational and external
  evidence named by the phase.

No phase below authorizes real funds. `MONEY_EGRESS_ENABLED` must remain false
until the applicable release gates are independently closed.

## Snapshot being preserved

- Repository: `ffffefefvee/Telegram-garant-contract-master`.
- Local base: `ab9eeb1` (`docs(settlement): record Phase 4 gate evidence`),
  which is seven commits ahead of the locally recorded `origin/main`.
- Live GitHub `main` is `78399f3` and already contains the Phase 3 merge. The
  unpublished code to preserve is therefore the two local Phase 4 commits
  (`85177a1`, `ab9eeb1`) plus this Phase 5 WIP snapshot; the publication branch
  is based on the live GitHub `main` rather than the stale local remote-tracking
  ref.
- This worktree contains a new, uncommitted Phase 5 candidate. It adds 30
  tracked-file modifications and the new files listed in the Phase 5 section.
- Local checks run on 2026-09-09: `git diff --check`, `contracts/npm test`,
  `contracts/npm run lint`, `services/user-service/npm run build`, and
  `services/user-service/npm test -- --runInBand` all exited successfully.
- The snapshot contains no unignored file whose name matches environment,
  key, credential, secret or token patterns. This is not a replacement for the
  repository's full-history secret scan in CI.

## Required publication sequence

1. Review the staged path list and secret-scan the exact commit.
2. Commit the snapshot on a new branch; never push it to `main`.
3. Create a Git bundle from that commit before remote publication.
4. Push the branch and open a **Draft PR**. Its description must include the
   “Draft PR disclosure” text at the end of this document.
5. Do not mark the PR ready, deploy contracts, or set any real-funds flag.

Recommended branch: `wip/phase5-polygon-lifecycle-2026-09-09`.

## Phase-by-phase status and next work

### Phase 0 — stabilization: closed historically; rerun for this snapshot

The original Phase 0 technical gate was recorded as passed on commit
`f7ec945` in `docs/PHASE0_STABILIZATION_REPORT.md`. The detached worktree
`Telegram-garant-contract-phase0-verify` remains a useful clean historical
checkout at `1f7cce6`; it is not a second project and must not be published
separately.

The current snapshot changes the codebase after that gate. Before any merge,
run the complete CI matrix from this exact WIP commit and attach the results.
The applicable configuration is `.github/workflows/ci.yml`; the Phase 5 job
added there must run with a PostgreSQL 15 service. Update
`docs/PHASE0_STABILIZATION_REPORT.md` only with new, reproducible evidence,
not with an assertion that later money-moving phases are complete.

### Phase 1 — proof-authorized TON evidence: implementation is advanced, integration remains blocked

The proof primitives and fixture corpus are present under
`services/user-service/src/modules/escrow/adapters/ton-proof/`, with their
matching `*.spec.ts` tests and fixtures under
`services/user-service/fixtures/ton-proof/`. The raw structural paths remain
explicitly non-authorizing:

- `services/user-service/src/modules/deal/ton-jetton-reconciliation-validator.ts`
  returns `MASTERCHAIN_PROOF_REQUIRED` after structural agreement;
- `services/user-service/src/modules/deal/ton-finalized-jetton-reconciliation.ts`
  must consume the finalized proof composition rather than treating provider
  agreement as finality;
- `services/user-service/src/modules/escrow/adapters/ton-jetton-wallet-seal-verifier.ts`
  must not turn its structural hash into a seal authorization;
- `services/user-service/src/modules/escrow/adapters/ton-proof/ton-proof-envelope.ts`
  documents that the envelope alone is not cryptographic verification.

Next work: reconcile these intentionally fail-closed callers with the already
implemented proof-composition and threshold-approval modules, while preserving
the distinction between `structuralEvidenceHash` and
`verificationEvidenceHash`. Add captured raw liteserver proof vectors and
adversarial vectors for the exact authorization callers; then obtain an
independent proof and executor-policy review. Relevant tests include the
three files above, the `ton-proof/*.spec.ts` suite, and
`services/user-service/src/modules/escrow/adapters/ton-jetton-wallet-seal-verifier.spec.ts`.

Do not wire a proof result into signing, broadcast, sealing or settlement until
the proof corpus gate (`npm run fixture:ton:gate` in `services/user-service`),
hosted CI, trusted independent source, threshold authority, and review have
all produced durable evidence. The apparent conflict between the later proof
modules and the earlier `MASTERCHAIN_PROOF_REQUIRED` path is intentional
fail-closed behavior, but it must be resolved explicitly in a reviewed PR;
documentation alone cannot establish the bridge is safe.

### Phase 2 — Jetton lifecycle: isolated implementation passed local gate; not released

The lifecycle is in `contracts-ton/contracts/TonJettonEscrow.tolk`,
`contracts-ton/contracts/jetton-types.tolk`,
`contracts-ton/wrappers/TonJettonEscrow.ts`, and the TypeScript/Acton tests in
`contracts-ton/tests/` and `contracts-ton/tests-acton/`. The status and
evidence are recorded in `docs/PHASE2_JETTON_LIFECYCLE_REPORT.md` and
`docs/ADR-018-TON-JETTON-SETTLEMENT-LIFECYCLE.md`.

Outstanding work is evidence, not a request to relax the state machine:

1. Reproduce the cross-build, gas, fuzz and mutation evidence in hosted CI
   from the committed source.
2. Obtain independent contract review and close all critical/high findings.
3. Integrate only proof-authorized observations from Phase 1 into the durable
   application path in Phase 3.
4. Execute testnet release, refund, timeout, dispute, partial-payout and
   recovery drills before any real-funds proposal.

### Phase 3 — durable TON Jetton backend: local candidate, PostgreSQL gate open

The source exists but must remain unwired: preparation and intent code is in
`services/user-service/src/modules/deal/ton-jetton-preparation.service.ts` and
`ton-jetton-action-intent.service.ts`; durable observation/application code is
in `ton-jetton-durable-ingestion.service.ts`,
`ton-jetton-transactional-application.service.ts`, and
`ton-jetton-ledger-reconciliation.service.ts`. The decisive test is
`services/user-service/src/modules/deal/ton-jetton-phase3.postgres.spec.ts`.
Associated entities and migrations are in
`services/user-service/src/modules/deal/entities/` and
`services/user-service/src/migrations/`.

Run `npm run test:phase3:postgres` against a fresh PostgreSQL 15 schema in
hosted CI and retain the output for all ten cases: idempotency, immutable
evidence, cursor recovery, `SKIP LOCKED` concurrency, each transaction-write
failure, source disagreement/manual review, partial payout recovery, ledger
balance and one-unit breaker detection. Then review migration/rollback on a
clean schema, merge the evidence-producing commit, and record a rollback point.
`TonEscrowAdapter.isReady()` must stay false.

### Phase 4 — common multichain contract: local candidate, PostgreSQL gate open

The common boundary is in
`services/user-service/src/modules/escrow/adapters/multichain-domain-contract.ts`
and the adapter conformance tests beside it. Quote/party confirmation handling
is in `services/user-service/src/modules/deal/settlement-agreement.service.ts`
and `.spec.ts`; the database gate is
`services/user-service/src/modules/deal/multichain-phase4.postgres.spec.ts`.
The schema migration is
`services/user-service/src/migrations/1718000000000-FreezeMultichainDomainContract.ts`.

Run `npm run test:phase4:postgres` in hosted CI only after the Phase 3 database
gate is green. Preserve the six clean-schema results proving exact quote,
network/asset, and dual-confirmation immutability. Re-run the complete CI
matrix and a final non-mutating lint pass. Neither Polygon finality nor TON
money actions may be treated as final because this phase is merged.

### Phase 5 — Polygon lifecycle hardening: current uncommitted local candidate

This is the only new implementation in the worktree snapshot. It must be
preserved, reviewed, and treated as incomplete until all evidence below exists.

**Contract and deployment surfaces**

- `contracts/contracts/EscrowFactory.sol` and
  `contracts/contracts/EscrowImplementation.sol`: token pinning, separated
  roles, pause, and paused-state buyer recovery.
- `contracts/test/Phase5Hardening.test.ts`: eight new adversarial role/pause/
  recovery tests; existing affected suites are `AdminSetters.test.ts`,
  `AuditFixes.test.ts`, `DeadlineExtension.test.ts`, and
  `EscrowFactory.test.ts`.
- `contracts/scripts/deploy.ts`, `deploy-amoy-test.ts`,
  `redeploy-impl.ts`, `estimate-amoy-acceptance-gas.ts`, and
  `verify-amoy-acceptance.ts`: deterministic deployment/verification inputs.

**Backend and persistence surfaces**

- `services/user-service/src/migrations/1718100000000-CreatePolygonLifecycleHardening.ts`
  and `src/modules/blockchain/entities/polygon-lifecycle.entity.ts`: immutable
  evidence, cursor, nonce, transaction and reconciliation schema.
- `src/modules/blockchain/polygon-finality.service.ts`,
  `polygon-lifecycle-ingestion.service.ts`,
  `polygon-reconciliation.service.ts`, `polygon-relay-nonce.service.ts`, and
  `polygon-relay-recovery.scheduler.ts`: independent finality, durable logs,
  reconciliation, nonce allocation and stuck-transaction recovery.
- `src/modules/blockchain/polygon-lifecycle-ingestion.scheduler.ts` and
  `polygon-reconciliation.scheduler.ts`: controlled background work.
- `src/modules/blockchain/relay-tx-queue.ts`, `erc20.client.ts`,
  `escrow.client.ts`, `factory.client.ts`, and `treasury.client.ts`: egress
  integration and durable relay coordination.
- `src/config/environment.validation.ts`, `src/modules/blockchain/blockchain.config.ts`,
  `src/modules/blockchain/blockchain.module.ts`, `src/app.module.ts`, and
  `.env.example`: production fail-closed configuration and composition root.

**Tests, CI and documentation that must stay coupled to the code**

- `src/modules/blockchain/polygon-finality.service.spec.ts`,
  `polygon-reconciliation.service.spec.ts`,
  `polygon-phase5.postgres.spec.ts`, and `relay-tx-queue.spec.ts`.
- `.github/workflows/ci.yml` and `services/user-service/package.json` register
  `npm run test:phase5:postgres`.
- `docs/ADR-021-POLYGON-LIFECYCLE-HARDENING.md`,
  `docs/PHASE5_POLYGON_REPORT.md`, `docs/DEPLOYMENT_RUNBOOK.md`, and
  `docs/NEXT_STEPS.md` state the threat model and operating restrictions.

**Blocking work and required evidence**

1. Run Phase 3, 4 and 5 PostgreSQL gates against a clean hosted PostgreSQL 15
   service. Phase 5 must prove log deduplication/append-only evidence,
   concurrent nonce allocation, idempotent retry, one-worker replacement,
   breaker escalation, and cursor/reorg persistence.
2. Run the complete CI matrix from the WIP commit: Solidity tests, coverage
   policy, Slither/static analysis, backend/TON/Mini App gates and secret scan.
3. Produce a fresh Amoy deployment with four distinct privileged identities;
   retain addresses, code hashes, gas/fee measurements and rollback decision.
4. Run Web3Signer acceptance for create/fund/release and interrupted-transfer
   recovery. Retain transaction hashes, reserved/replaced nonces, fees and
   relayer balances. The entry point is
   `services/user-service/scripts/amoy-web3signer-acceptance.ts`.
5. Drill Amoy refund, timeout, dispute, resolution, pause and emergency
   recovery. Exercise two independent RPC operators through lag, outage and
   finalized-reorg conditions; attach alert-delivery evidence.
6. Obtain an independent Polygon contract/backend review and resolve every
   critical/high finding. Do not set `MONEY_EGRESS_ENABLED=true` for production
   money movement merely to run a test.

### Phase 6 — security and privileged operations: operational work remains

The code separates several roles, but hardware/threshold custody, MFA,
two-person recovery, off-site immutable audit export, key rotation and the
required drills are not evidenced as complete. Start with the existing
runbooks: `docs/SECURITY_INCIDENT_RUNBOOK.md`,
`docs/TON_NATIVE_INCIDENT_RUNBOOK.md`,
`docs/DEPLOYMENT_RUNBOOK.md`, and
`docs/SECURITY_IMPLEMENTATION_STATUS.md`.

Create version-controlled drill reports under `docs/operations/` (one file per
drill, with owner, timestamp, recovery time, evidence links and final ledger
balance) rather than putting credentials or production values in the repository.
The relevant guardrails are `services/user-service/src/modules/blockchain/money-movement.gate.ts`,
the configuration-validation file above, and the breaker/relay services in the
Phase 5 list.

### Phase 7 — testnet vertical slices: not complete

Execute both end-to-end flows only after their prerequisites are green. TON
work starts in `contracts-ton/`, its wrappers/tests and the proof/durable paths
named above. Polygon work starts in `contracts/` deployment scripts and
`services/user-service/scripts/amoy-web3signer-acceptance.ts`.

Create reproducible, redacted evidence under `docs/testnet/` for normal paths
and every failure drill: duplicate/reordered observation, indexer restart, RPC
disagreement, wallet rejection, insufficient gas, failed payout, process crash
and partial-write recovery. Each report must prove zero quote mismatch and zero
ledger delta; do not record private keys or live access tokens.

### Phase 8 — Mini App and website interaction contracts: incomplete

The Mini App exists under `mini-app/src/`, especially `App.tsx`, `api/index.ts`,
`types/`, `pages/`, and `components/`. It needs a versioned backend state/quote
contract before UI completion: exact user-visible state, allowed action, wallet
action, duration, retry/support, proof/transaction detail and blocked reason.

Implement TON Connect restored-session/capability handling and finalized versus
submitted status using the Mini App files above and the TON API/adapter paths.
The standalone Polygon/Ton website surface is not a distinct app directory in
this repository; create it only after an explicit product/design decision,
sharing the same API schemas and fee/quote source. Add consumer-contract and
E2E tests next to the selected client application; never calculate fees locally.

### Phase 9 — audit, staging and beta: no release evidence exists

External audits, a seven-day zero-delta staging run, closed-beta limits,
100 completed transactions, legal/policy acceptance, support/arbitration
capacity and closed findings are external deliverables. Track their scope and
acceptance criteria in `docs/MULTICHAIN_PUBLIC_LAUNCH_PLAN.md` and
`docs/PRODUCT_PLAN.md`; store redacted reports under `docs/audit/`,
`docs/staging/`, and `docs/beta/` when they exist.

No code, unit test, draft PR, or local pass can close this phase.

## Draft PR disclosure

Use this text, updated only with actual CI URLs and commit hashes:

> **WIP handoff — do not merge or deploy.** This branch preserves the two local
> Phase 4 commits and local Phase 5 Polygon lifecycle-hardening work on top of
> GitHub `main` at `78399f3`. The local repository's recorded `origin/main` was
> stale when this snapshot was made. Local Solidity tests, Solhint, backend build, backend
>  Jest suite and `git diff --check` passed on 2026-09-09. It has not passed the
>  clean-schema Phase 3/4/5 PostgreSQL gates, complete hosted CI/secret scan,
>  Slither/static analysis, a fresh Amoy deployment, Web3Signer acceptance and
>  recovery drills, independent-RPC outage/reorg drills, or independent
>  contract/backend review. Phase 1 proof authorization remains deliberately
>  unwired, TON money actions remain disabled, and
>  `MONEY_EGRESS_ENABLED` must remain false. See
>  `docs/HANDOFF_OUTSTANDING_WORK.md` for the exact outstanding tasks and file
>  locations.
