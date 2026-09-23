# Phase 5/6 gate-closure report

Date: 2026-09-21

Base heads:

- Phase 5: `1aa52ac890afdb46d1d7ffd4d802222b642ae84b`
- Phase 6: `5922292da8a318980105b18a449d98ed7614f77e`
- This report describes an uncommitted gate-closure working tree based on the
  Phase 6 head. It is not a release candidate until committed and revalidated.

Overall result: **BLOCKED**. Both PRs must remain Draft. Phase 7 must not start.

## Local evidence added in this working tree

- S3 quarantine/clean production adapter with KMS encryption, private presigned
  reads, clean-object hash metadata verification and quarantine cleanup.
- Authenticated scanner adapter whose Ed25519-signed result binds exact bytes,
  request/result identity, scanner/version, policy, timestamp and verdict.
- Retention scheduler with immutable tombstone/audit record, retry and DLQ.
- Off-site S3 Object Lock `COMPLIANCE` export with canonical batches,
  PostgreSQL monotonic sequences, hash-chain manifests, durable monotonic
  checkpoint and append-only version/ETag receipts.
- Fresh destination verifier for mutation, gap, duplicate, reorder, replay and
  broken-chain detection.
- Production configuration fails closed when evidence or WORM adapters are
  disabled or unsafe.
- Unmatched-deposit recovery now uses immutable, expiring two-person requests,
  dedicated IdP recovery scope, stale-state validation, cancellation,
  single-use execution and required transactional auditing; direct mutation
  endpoints were removed (ADR-025).
- Legacy one-person HTTP bypasses for forced deal state, administrator refunds,
  self-service refunds and funding-deadline extension are disabled pending
  purpose-built reconciled two-person workflows.
- Native-TON manual-review replay now binds requester/approver IdP sessions,
  dedicated recovery scope, immutable expiring intent, audited cancellation and
  a database-enforced single pending request; bounded backfill uses the same
  recovery scope.
- Privileged MFA enforcement now follows admin role metadata outside `/admin`;
  unaudited legacy status, ban/unban, role and arbitrary balance mutations plus
  participant-triggered assignment were removed, and on-chain resolution
  recording requires arbitrator step-up.

Commands and results through 2026-09-21:

- `npm run build`: PASS.
- non-mutating ESLint over backend sources: PASS, zero warnings.
- full backend unit run after recovery-route/service removal: PASS, 112 suites /
  1,099 tests; 30 PostgreSQL-gated tests skipped by design.
- isolated PostgreSQL 15 clean-schema gate: PASS, Phase 3/4/5/6 28/28. The
  temporary database used tmpfs and was removed after the run.
- targeted new-control run: PASS, 5 suites / 45 tests.
- combined shared-ledger/native recovery and backfill unit run: PASS, 20/20.
- isolated PostgreSQL 15 Phase 6 migration/trigger gate after ADR-025: PASS,
  7/7, including both immutable request triggers, both single-pending partial
  indexes and native recovery session/expiry columns. The disposable
  tmpfs-backed container was removed after the run.
- production dependency audit after upgrading AWS SDK: PASS, zero known
  vulnerabilities at the time of the registry query.

## Gate matrix

| Requirement | Status | Evidence | Responsible owner | Residual risk |
| --- | --- | --- | --- | --- |
| Phase 5 clean CI at recorded head | PASS | PR #35 run 35323151830; `PHASE5_POLYGON_REPORT.md` | Engineering | Superseding head still needs CI after any Phase 5 change |
| Fresh deterministic Amoy deployment and role separation | BLOCKED | No new external deployment record | UNASSIGNED | Contract/role configuration not proven on Amoy |
| Web3Signer create/fund/release and interrupted recovery | BLOCKED | Local loopback evidence only | UNASSIGNED | Remote signer/nonce recovery not externally proven |
| Amoy lifecycle/finality/dual-RPC/reorg/alert drills | BLOCKED | No executed reports | UNASSIGNED | Provider and alert behavior not production-evidenced |
| Independent Polygon review; no Critical/High findings | BLOCKED | Reviewer and finding ledger absent | UNASSIGNED | Independent defect discovery incomplete |
| External privileged IdP implementation | PASS | ADR-024; JWKS/introspection service and targeted tests | Engineering | Real provider configuration pending |
| External privileged IdP lifecycle drills | BLOCKED | No external tenant evidence | UNASSIGNED | Enrollment, factor/session revocation, recovery, rotation and outage unproven |
| Production evidence storage/scanner implementation | PASS | ADR-023, adapters, migrations and 45 targeted tests | Engineering | External bucket/scanner policy and failure drills pending |
| Retention deletion/retry/DLQ implementation | PASS | Scheduler, migration and unit tests | Engineering | External lifecycle/DLQ operations drill pending |
| Off-site WORM implementation and local verification | PASS | ADR-023, WORM service/migration and hash-chain tests | Engineering | Real Object Lock policy, cross-account custody and restore pending |
| WORM external restore/continuity drill | BLOCKED | No external destination or executed restore report | UNASSIGNED | Destination rollback/availability not operationally proven |
| Two-person Polygon/shared-ledger recovery | BLOCKED | ADR-025, 20/20 focused tests and 7/7 PostgreSQL gate cover unmatched-deposit and native-TON replay | Engineering / UNASSIGNED | Dormant Jetton cursor/requeue primitives need equivalent controls; external concurrency/two-identity drills remain unproven |
| Hardware/threshold key custody inventory | BLOCKED | No redacted custody attestations | UNASSIGNED | Key separation, backup and break-glass not evidenced |
| Ten mandatory operational drills | BLOCKED | `docs/operations/` contains explicit unexecuted records | UNASSIGNED | Recovery time and final balance remain unknown |
| Real-network money egress remains disabled | PASS | `.env.example` retains `MONEY_EGRESS_ENABLED=false`; no enabling change | Engineering | Deployment environment must be independently checked |
| Phase ordering | PASS | Work is based on stacked Phase 6; neither PR was merged or marked ready | Release owner | Must be rechecked immediately before merge |

## Required external inputs to continue

1. Named owners/participants and an approved maintenance window for every drill.
2. Amoy identities/funds, Web3Signer endpoint and at least two independent RPC
   operators, supplied out of band.
3. External IdP tenant, JWKS/revocation integration details and test identities.
4. Private S3/KMS/scanner/WORM resources and redacted IAM/Object Lock evidence.
5. Independent contract/backend reviewer and a finding-closure owner.
6. Redacted hardware/threshold custody attestations for every required role.

No blocked item is waived by this report. Any unexplained delta, ambiguous
settlement, unauthenticated scan, audit discontinuity, leaked credential or
Critical/High finding remains an immediate stop condition.

## Staging identity fixture update — 2026-09-23

An offline loopback HTTPS mock IdP is now available through
`npm --prefix services/user-service run idp:staging`; see
`STAGING_MOCK_IDP.md`. It generates local certificates, signing keys,
test-user passwords and an introspection bearer token automatically. A live
HTTPS integration test issues admin and arbitrator assertions and verifies both
through `PrivilegedIdentityService`. Production configuration rejects loopback
IdP URLs. The superseding local full unit run passes 113 suites and 1,101 tests;
30 PostgreSQL-gated tests remain skipped. Build and targeted lint pass.

This fixture is staging test infrastructure, not evidence of real factor
enrollment, revocation or recovery. The external privileged IdP lifecycle gate
above remains `BLOCKED`.

## Local PostgreSQL gate rerun — 2026-09-23

The portable PostgreSQL 15 instance used by `staging:local` was already
installed and listening on loopback; no system-wide PostgreSQL installation or
Docker service was required. With Node.js `v24.17.0` and npm `11.17.0`,
`npm --prefix services/user-service run test:postgres:local` passed all four
Phase 3/4/5/6 PostgreSQL suites: **4/4 suites, 30/30 tests**. The command creates
a fresh, randomly named database on the local instance, runs the migrations and
gated tests, then drops only that disposable database. The local staging
database is not used. `node --check` passed for the runner, and `git diff
--check` found no whitespace errors (only Windows line-ending notices).

This is superseding local evidence for the earlier 28-test PostgreSQL count,
not clean-checkout CI. The tested working tree has uncommitted and untracked
changes on commit `5922292da8a318980105b18a449d98ed7614f77e`. A new,
reviewable candidate head and green clean-checkout CI remain required before
either release gate can be closed; the overall result remains **BLOCKED**.
