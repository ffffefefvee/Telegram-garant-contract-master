# ADR-024: external privileged identity verification

Date: 2026-09-21

Status: accepted for production-candidate integration; external lifecycle drills pending

## Decision

Administrative and arbitrator step-up assertions are verified against an
external IdP without storing any IdP signing key in the service.

- Only RS256 assertions with an explicit `kid` are accepted.
- Verification keys are selected from HTTPS JWKS. Unknown keys force one fresh
  JWKS retrieval; missing or unusable keys fail closed.
- The assertion must bind issuer, audience, subject, purpose, `jti`, IdP session
  `sid`, MFA `amr`, required `acr`, required scope, `auth_time`, issue time and
  expiry. Authentication age is bounded independently of token expiry.
- Every sensitive request performs online token introspection. The returned
  subject, `jti`, `sid` and scope must match the signed assertion and `active`
  must be exactly true.
- JWKS refresh, signature verification, introspection or configuration failure
  denies access. Emergency admin and arbitrator lockouts remain independent.
- Admin and arbitrator origins, audiences and scopes remain distinct.

## Rotation and outage behavior

JWKS responses may expose old and new signing keys concurrently. Assertions are
selected by `kid`, allowing overlap during rotation. An unknown `kid` is never
accepted from a stale cache. A cached key may be used only within the configured
short cache interval, and online introspection is still mandatory. Therefore an
IdP outage or unknown revocation state stops privileged access.

## Remaining evidence

Production acceptance must demonstrate enrollment, factor revocation,
lost-factor recovery, session revocation, overlapping signing-key rotation,
unknown-key rejection, stale-key rejection, IdP outage and emergency lockout
against the selected external provider. Unit tests are not a substitute.

## Route metadata coverage amendment — 2026-09-21

Privileged enforcement is not limited to the `/admin` URL prefix. The global
guard also inspects `@Roles(ADMIN|SUPER_ADMIN)` metadata, so administrative
operations mounted under legacy prefixes such as `/users` and `/arbitration`
require the same allowed origin and online-verified step-up assertion. General
user profile reads, updates and statistics are self-only. The unaudited legacy
status, ban/unban and role-mutation endpoints are removed; account deletion
requires super-admin. The legacy arbitrary balance endpoint is also removed.
