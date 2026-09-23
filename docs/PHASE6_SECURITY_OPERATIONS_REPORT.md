# Phase 6 security and privileged operations report

Date: 2026-09-18

Status: local implementation candidate; external services and operational exit gate pending

## Implemented in this branch

- A global `/admin` boundary requiring a dedicated allowed origin and a fresh,
  independently signed MFA step-up assertion bound to the authenticated user.
- Production configuration validation for separate admin/arbitrator origins,
  distinct RSA public verification keys, HTTPS issuers and a 60-900 second
  assertion lifetime. Only RS256 is accepted; the service has no IdP private
  key capable of minting assertions.
- An emergency administrative lockout switch.
- A separate arbitrator origin, MFA assertion audience/signing key and
  emergency lockout for evidence verification, decisions, enforcement,
  appeals and arbitrator-profile actions.
- JWTs bound to durable server-side sessions, with fail-closed middleware and
  owner-scoped single-session or all-session revocation.
- A strict dispute-file policy covering size, filename normalization, exact
  MIME allowlist, extension agreement and actual JPEG/PNG/PDF/MP4 signatures.
- Quarantine-first evidence orchestration with mandatory malware scanning,
  post-scan SHA-256, clean-object promotion and cleanup on failure.
- Atomic evidence, manifest and required audit persistence.
- Short-lived authorized download URL generation.
- PostgreSQL evidence manifests with immutable security fields, a single
  irreversible deletion tombstone and a 365-day retention commitment.
- PostgreSQL rejects UPDATE and DELETE against the unified audit log, enforcing
  its append-only contract below the application layer.
- Ordinary file-evidence deletion is denied; legacy text evidence behavior is
  unchanged.
- Storage and scanner defaults fail closed until production adapters exist.

## Local evidence

- Targeted security tests: 62/62 passed.
- Full backend unit run: 109 suites / 1,100 tests passed; 25 PostgreSQL-gated
  tests were intentionally skipped in this unit run.
- Phase 6 clean PostgreSQL 15 migration/trigger gate: 3/3 passed.
- Backend build and full non-mutating ESLint: passed.
- Production dependency audit: zero vulnerabilities.
- `MONEY_EGRESS_ENABLED` was not enabled.

## Existing controls reused

- Canonical database roles rather than a caller-provided singular role.
- Required transactional audit writes for sensitive recovery operations.
- Native TON recovery already requires a different second super-admin and
  re-runs normal reconciliation; it has no force-apply route.
- Polygon deploy/runtime roles are separated into admin, relay, pauser and
  recovery identities, with non-local distinctness checks.

## Remaining Phase 6 exit work

- Integrate and test the external MFA/privileged identity provider; demonstrate
  enrollment, revocation, lost-factor recovery and emergency lockout.
- Integrate privileged-identity session revocation and lost-factor recovery;
  ordinary application sessions are now durably revocable.
- Implement production object-storage and malware-scanner adapters, including
  independent scan-result authentication and deletion jobs after retention.
- Export the append-only audit stream to an off-site WORM destination and prove
  continuity, replay detection and restore.
- Apply a two-person workflow to every Polygon and shared-ledger recovery path,
  not only native TON requeue.
- Record hardware-backed or threshold custody for deployment, initializer,
  reconciliation, arbitrator, treasury, pause and release identities.
- Execute compromised-signer, database, Redis/queue, RPC/indexer, disagreement,
  cursor-corruption, restore, stuck-funding, partial-payout, false-report and
  emergency-stop drills. Every report still needs a named owner, measured
  recovery time and verified final ledger balance.

Until all remaining evidence is attached, Phase 6 is not complete and this
stacked branch must not be merged ahead of the Phase 5 exit gate.

## Superseding local implementation record — 2026-09-20

An uncommitted gate-closure working tree based on
`5922292da8a318980105b18a449d98ed7614f77e` adds production S3 evidence
storage, authenticated scan results, retention retry/DLQ, and off-site WORM
export/verification. Local build, lint, 1,112 unit tests and the isolated
PostgreSQL 15 Phase 3-6 gate pass. See
`PHASE5_PHASE6_GATE_CLOSURE_REPORT.md` and ADR-023.

This does not close Phase 6. External IdP lifecycle, real storage/scanner/WORM
acceptance, two-person Polygon/shared-ledger recovery, custody attestations and
all operational drills remain blocked and unexecuted. This paragraph must be
replaced by an exact committed candidate SHA and clean-checkout evidence before
the PR can be marked ready.

### Privileged IdP hardening — 2026-09-21

The gate-closure working tree replaces static privileged verification keys with
HTTPS JWKS selection by `kid` and mandatory online introspection. Admin and
arbitrator assertions now require RS256, issuer, distinct audience/scope,
subject, purpose, MFA `amr`, configured `acr`, bounded `auth_time`, `jti`, `sid`
and active revocation state. JWKS/introspection outage and unknown keys fail
closed. ADR-024 records the design; external provider lifecycle evidence is
still required.

### Shared-ledger two-person recovery — 2026-09-21

The direct unmatched-deposit `match` and `ignore` endpoints have been removed.
ADR-025 introduces immutable, expiring recovery intents, a distinct
super-admin and distinct IdP-session approval requirement, dedicated
`garant:admin:recovery` scope, cancellation, single-use execution, normal
reconciliation before apply, pessimistic locking, stale-state hashes and a
required transactional audit record. Focused tests pass 6/6; build and lint
pass. The most recent complete unit run passed 112 suites and 1,099 tests with
30 PostgreSQL-gated tests skipped. A clean disposable PostgreSQL 15 run passed
the seven Phase 6 migration/trigger tests, including the recovery-request trigger
and single-pending partial index. It must be repeated from the committed candidate.

The one-person HTTP routes for forced deal state changes, administrator or
self-service payment refunds, and escrow funding-deadline extension were also
removed together with their unused service entry points. The one-person dispute
force-close route was removed; arbitrator reassignment is now super-admin only.
These operations remain fail-closed until purpose-built, reconciled two-person
intents replace them. User payment reads and status checks are now explicitly
owner-scoped.

The existing native-TON requeue was also upgraded to require the dedicated
recovery scope and distinct IdP sessions, with immutable intent hash, expiry,
audited cancellation/expiry, one pending request per event and terminal-row
immutability. Bounded native backfill now requires the recovery scope. The
combined focused recovery/backfill run passes 20/20 and the expanded clean
PostgreSQL gate passes 7/7.

The Jetton cursor-rewind and stopped-application requeue primitives have no
HTTP controller or runtime caller, but they are not yet represented by the new
two-person IdP-bound request model. They remain an explicit code gate and must
not be exposed until equivalent request/approval controls exist.

The privileged guard now recognizes admin-role metadata on every route, not
only paths beginning with `/admin`. This closes legacy `/users` and
`/arbitration` step-up bypasses. General user profile operations are self-only;
unaudited legacy status, ban/unban, role-change and arbitrary balance mutations
were deleted; account deletion is super-admin-only; participant-triggered
arbitrator assignment routes were removed; automatic on-chain assignment is
super-admin step-up only; and recording an on-chain resolution now requires
arbitrator IdP step-up. The focused identity/recovery run passes 31/31.

This closes the known direct shared-ledger unmatched-deposit mutation, but does
not close the Phase 6 recovery gate. Remaining Polygon/shared-ledger paths need
an explicit inventory and equivalent controls, and external two-identity and
concurrency drills remain unexecuted.
