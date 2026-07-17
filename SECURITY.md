# Security and incident runbook

Never put real secrets in the repository, tickets, chat, logs, images, or command history. Use the production secret manager and record incident actions without secret values.

## Key or token compromise

1. Declare an incident, restrict access, preserve redacted logs, and identify the key's scope and last known-safe time.
2. Pause affected signing, withdrawals, webhooks, relays, and deployments; do not broadcast test transactions.
3. Revoke/rotate the credential at its issuer (`@BotFather` for bot tokens), then rotate dependent credentials and invalidate sessions where relevant.
4. Move remaining funds using the approved multisig/cold-wallet procedure only after independent review; never reuse the compromised key.
5. Update the secret manager, restart through the normal deployment pipeline, verify old credentials fail, and monitor for unauthorized activity.
6. Reconcile all events since the last known-safe time and complete a blameless post-incident review.

## Relay incident or stuck forward

- Stop automatic retries if idempotency is uncertain; retain correlation ID, source/destination chain, nonce, tx hash, state, and timestamps.
- Check finality and canonical receipts using at least two trusted RPC providers. Never replace or replay a transaction until ownership and nonce state are verified.
- For a stuck forward, classify it as not submitted, pending, reverted, or finalized. Resume only with the documented idempotency key and four-eyes approval.
- Escalate suspected relay compromise to the key-compromise procedure and pause both directions.

## Reconciliation mismatch

- Freeze settlement for the affected asset/range; do not edit balances directly.
- Export immutable snapshots of ledger entries, chain receipts, provider callbacks, and database audit records.
- Compare by deal ID, asset, amount, address, chain ID, tx hash, block/finality, and idempotency key.
- Resolve via an auditable compensating entry or approved replay, never by deleting history. Obtain finance/security sign-off before unfreezing.

## Backups, encryption, RPO and RTO

- Encrypt backups in transit and at rest with a dedicated KMS key; separate backup-admin and restore roles. Rotate keys and audit decrypt access.
- Production targets: database **RPO <= 15 minutes** and **RTO <= 4 hours**. Contract/event data must be reproducible from finalized chain history; retain provider-independent checkpoints.
- Keep versioned, immutable/offline copies under the retention policy. Never store plaintext secrets in backups.
- Test a clean-room restore at least quarterly, including integrity checks, reconciliation, credential rotation, measured RPO/RTO, and documented evidence.

## Recovery exit criteria

Service resumes only after containment, credential rotation, successful health checks, reconciliation with no unexplained mismatch, validated backup/restore status, monitoring enabled, and incident-commander approval.
