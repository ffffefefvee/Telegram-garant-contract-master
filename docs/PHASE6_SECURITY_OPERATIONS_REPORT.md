# Phase 6 security and privileged operations report

Date: 2026-09-18

Status: local implementation candidate; external services and operational exit gate pending

## Implemented in this branch

- A global `/admin` boundary requiring a dedicated allowed origin and a fresh,
  independently signed MFA step-up assertion bound to the authenticated user.
- Production configuration validation for separate admin/arbitrator origins,
  a 32+ character privileged signing secret, HTTPS issuer and a 60-900 second
  assertion lifetime.
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
- Ordinary file-evidence deletion is denied; legacy text evidence behavior is
  unchanged.
- Storage and scanner defaults fail closed until production adapters exist.

## Local evidence

- Targeted security tests: 61/61 passed.
- Full backend unit run: 109 suites / 1,099 tests passed; 25 PostgreSQL-gated
  tests were intentionally skipped in this unit run.
- Phase 6 clean PostgreSQL 15 migration/trigger gate: 2/2 passed.
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
