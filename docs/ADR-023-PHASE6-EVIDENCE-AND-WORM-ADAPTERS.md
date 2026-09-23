# ADR-023: authenticated evidence and off-site WORM audit adapters

Date: 2026-09-20

Status: accepted for production-candidate integration; external acceptance pending

## Context

Phase 6 previously provided a quarantine-first orchestration boundary but only
disabled storage/scanner ports. The audit table was append-only in PostgreSQL,
but it had no independently restorable off-site continuity record.

## Decision

- Store quarantined and clean evidence in distinct private S3 buckets. Encrypt
  both with an explicit KMS key and use workload identity rather than committed
  access keys.
- A scanner response is accepted only when an Ed25519 signature covers the
  request ID, result ID, exact SHA-256, verdict, scanner/version, policy
  version, timestamp and evidence statement. The service recomputes the hash.
- Promote by server-side copy into the clean bucket, bind the SHA-256 as object
  metadata, verify it with `HeadObject`, and remove the quarantine object.
- Retention deletion records an immutable tombstone and required audit record.
  Failures use bounded exponential retry and enter a dead-letter state after ten
  attempts.
- Give every audit row a PostgreSQL-generated monotonic export sequence. Export
  canonical JSON batches to a separate S3 Object Lock bucket in `COMPLIANCE`
  mode. Each manifest commits to consecutive sequences, record bytes and the
  previous manifest hash.
- Persist the destination version ID and ETag in append-only database receipts
  and a second Object-Locked external receipt object. Advance a monotonic
  checkpoint only after both immutable writes succeed.
- A fresh verifier reads only receipts and destination objects and rejects a
  missing version, gap, duplicate, reorder, replay, record mutation or broken
  manifest link. It never mutates `audit_log`.

## Security boundaries

The evidence identity needs only quarantine put/delete, clean copy/head/get and
short-lived presign permissions. It must not make either bucket public. The WORM
identity needs put/get/head against a distinct Object-Lock-enabled bucket and
must not have delete or retention-bypass permission. Bucket policy, KMS policy,
versioning, lifecycle and cross-account/off-site ownership remain external
deployment evidence and are not inferred from application configuration.

## Consequences

Production startup now refuses disabled or placeholder evidence/WORM
configuration. Local development remains fail-closed through disabled adapters.
The AWS SDK is a production dependency and is subject to the repository's npm
audit gate. External scanner, S3 and Object Lock drills are still required;
unit tests and PostgreSQL triggers are not substitutes for those drills.
