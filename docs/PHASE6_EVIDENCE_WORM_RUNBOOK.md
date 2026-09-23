# Phase 6 evidence and WORM runbook

Date: 2026-09-20

## Preconditions

1. Keep `MONEY_EGRESS_ENABLED=false`.
2. Provision separate private quarantine, clean and off-site WORM buckets.
3. Enable versioning and Object Lock at bucket creation for the WORM bucket.
4. Deny public access and retention bypass. Use separate workload identities and
   KMS keys where the custody policy requires it.
5. Configure the variables documented in `.env.example`; never commit tokens,
   AWS credentials, scanner private keys or unredacted storage policies.
6. Run all migrations before enabling either adapter.

## Scanner contract

`POST EVIDENCE_SCANNER_URL` receives JSON containing `requestId`, `mediaType`,
`sha256` and `contentBase64`. The response must contain `requestId`, `resultId`,
`clean`, `sha256`, `scannerName`, `scannerVersion`, `policyVersion`, `scannedAt`,
`evidence` and an Ed25519 `signature`. The signed bytes use the canonical format
implemented by `canonicalScanResult`. Results older than the configured maximum,
for a different request/hash, or with an invalid signature fail closed.

## Acceptance sequence

1. Upload a clean fixture and confirm quarantine put, authenticated scan,
   post-scan hash comparison, clean promotion, database manifest and audit row.
2. Confirm the download URL is authorized, short-lived and references only the
   clean bucket.
3. Repeat with timeout, corruption, hash mismatch, malicious verdict, replayed
   result ID, partial promotion and database rollback. Confirm there is no
   downloadable quarantined object or accepted manifest.
4. Advance a test manifest past retention and run the scheduler. Verify deletion,
   tombstone and audit entry. Repeat with storage outage through retry and DLQ.
5. Generate audit records, invoke `POST /api/admin/ops/audit-worm/export`, then
   invoke `GET /api/admin/ops/audit-worm/verify` from a fresh process.
6. Exercise missing object/version, altered bytes, gap, duplicate, reorder,
   replay and checkpoint corruption. Every case must fail verification.

## Rollback

Disable `EVIDENCE_PIPELINE_ENABLED` to reject new file evidence while preserving
existing manifests and objects. Disable `AUDIT_WORM_EXPORT_ENABLED` to stop new
exports; do not delete receipts, rewind checkpoints or weaken Object Lock. Fix
the root cause, verify the destination from a fresh process, and resume. A
failed continuity verification is a release stop condition.
