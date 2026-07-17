# Security incident and recovery runbook

## Targets and command authority

- **Incident commander (IC):** on-call security lead; records UTC timeline and approves restart.
- **Operations:** executes infrastructure actions using audited break-glass access.
- **Finance/reconciliation:** independently verifies ledger, provider and chain balances.
- **RPO:** 5 minutes for PostgreSQL/payment ledger; 24 hours for non-transactional analytics.
- **RTO:** 60 minutes to contain and restore read-only service; 4 hours for verified payment processing.
- Safety beats RTO: never resume forwards or payouts while reconciliation differs.

## First 15 minutes (all incidents)

1. Declare severity, IC and incident channel; preserve logs, DB audit records, provider payloads and chain transaction hashes. Do not paste secrets into chat/tickets.
2. Stop automatic forward/payout workers and put mutations into maintenance/read-only mode. Do not stop evidence collection.
3. Snapshot relevant DB/queue state and note UTC time, deployment SHA, wallet addresses, block height and last known-good reconciliation.
4. Restrict administrative access, revoke active sessions, and notify the security and finance owners.

## Key or Telegram/provider secret leak

1. Revoke/rotate the exposed credential at its issuer first; invalidate sessions/tokens derived from it.
2. For a signing key, move authority/funds using the approved multisig/KMS process; never export a replacement private key.
3. Rotate dependent webhook/JWT/provider secrets, redeploy from a known-good revision, then run gitleaks against full history.
4. Search logs and audit trails for use since the earliest possible exposure. Preserve indicators before cleanup.
5. Resume only after old credentials fail, new credentials are in KMS/Vault, and unauthorized actions are reconciled.

## Relay compromise

1. Disable relay signing policy and outbound jobs; pause auto-forward and payouts.
2. Use multisig to revoke the relay on contracts/factory where supported and quarantine the wallet.
3. Compare relay nonce and every outgoing transaction with outbox/ledger records from the last good checkpoint.
4. Provision a new least-privilege KMS key/address, fund only bounded gas, update allowlists and test on Amoy/sandbox.
5. Resume with one canary transaction and two-person approval; monitor nonce, destination and amount.

## Reconciliation mismatch

1. Keep all automatic money movement stopped. Record DB ledger sum, hot-wallet balance and active escrow balances at one finalized block.
2. Re-run after required Polygon confirmations; classify missing webhook, duplicate outbox, reorg, wrong amount/address, or unauthorized transfer.
3. Never edit ledger rows in place. Post an auditable compensating entry linked to provider ID and tx hash after finance approval.
4. Resume only when the invariant is exactly balanced, queued jobs are deduplicated, and IC plus finance sign off.

## Stuck forward

1. Locate the idempotency key, outbox row, relay address, nonce and tx hash. Confirm escrow destination and amount independently.
2. If pending, replace the same nonce with the identical destination/data and approved gas policy. Never create a second business operation.
3. If dropped, retry through the same idempotent job. After five failures, quarantine it for manual two-person review.
4. After confirmation depth is reached, atomically record tx hash/status and run reconciliation before releasing subsequent jobs.

## Encrypted backup and restore

- Create PostgreSQL backups at least every 5 minutes (WAL/PITR) plus a daily full backup.
- Encrypt before leaving the database host with a KMS-managed key; use separate storage credentials, immutable/object-lock retention, and off-site replication. Backups must not contain plaintext `.env` files or exported private keys.
- Restrict decrypt/restore to audited break-glass roles with two-person approval. Monitor and alert on reads, policy changes and deletion attempts.
- Monthly, restore into an isolated network, verify checksums/migrations and reconcile ledger to finalized chain/provider records. Record achieved RPO/RTO and remediate any miss.

## Closure

Preserve evidence per retention policy, notify affected parties/legal as required, rotate break-glass credentials, document root cause and monetary impact, and add a regression test/alert. Restart payment automation only with written IC and finance approval.
