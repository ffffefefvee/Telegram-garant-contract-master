# ADR-022: Privileged access and dispute-evidence security boundaries

Date: 2026-09-18

Status: accepted for Phase 6 implementation; production adapters and drills pending

## Context

A normal Telegram user session is not a sufficient credential for an
administrative money-recovery action. File evidence is also untrusted input:
caller MIME metadata, filenames and a successful upload cannot establish that
the retained object is safe or immutable.

## Decision

All `/admin` requests require two independently verified credentials:

1. the normal application JWT and canonical database role; and
2. a fresh, separately signed assertion whose subject matches the application
   user, whose purpose is `admin_step_up`, and whose authentication-method list
   contains `mfa`.

The assertion issuer, audience, maximum age and RSA public verification key are
independent configuration. The service never receives the identity provider's
private signing key and accepts only RS256. Administrative and arbitrator
consoles use disjoint HTTPS origin allowlists. `ADMIN_EMERGENCY_LOCKOUT=true`
stops the entire admin origin.
Production startup fails when these controls are missing or unsafe. Sensitive
arbitrator routes use a separate origin, public key, audience, purpose and
emergency lockout, so the admin and arbitrator security domains cannot reuse an
assertion or browser origin.

Ordinary application JWTs contain a durable server-side session identifier.
Middleware rejects legacy, revoked, expired and cross-user session bindings on
every protected request. A user can revoke one owned session or all owned
sessions immediately.

File evidence follows this order:

```text
authorize dispute actor
  → enforce count/size/type policy
  → compare MIME + extension + magic bytes
  → write quarantine object
  → malware scan exact bytes
  → calculate post-scan SHA-256
  → promote clean object
  → atomically persist evidence, immutable manifest and audit record
  → issue only short-lived authorized download URLs
```

The database manifest commits the object key, media type, byte length, content
hash, scanner identity/version, scan-evidence hash, retention deadline and
manifest hash. A PostgreSQL trigger rejects every rewrite of those fields and
allows only one irreversible deletion tombstone. The application never
physically deletes managed file evidence through the ordinary evidence API.

Object storage and malware scanning are dependency-injected ports. Their
default providers fail closed. Uploads therefore remain unavailable until
production-managed storage and scanner adapters are configured and exercised.

## Consequences

- A stolen ordinary session cannot by itself call the administrative API.
- Cross-origin admin requests and stale/unbound MFA assertions fail closed.
- Uploaded metadata cannot substitute for inspecting actual file bytes.
- A clean database record cannot exist without scan evidence and a required
  audit row in the same transaction.
- Phase 6 is not complete until the external identity, storage, scanner, WORM
  export and operational drills have evidence; this ADR does not waive them.
