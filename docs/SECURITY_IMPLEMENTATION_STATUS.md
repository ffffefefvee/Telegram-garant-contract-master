# Security implementation status

## Completed in this branch

- **Containment and configuration:** relay money egress defaults to disabled;
  production configuration rejects placeholder secrets, unsafe CORS, schema
  synchronization, test controls, and enabling money egress without both
  migrations and reconciliation.
- **Authorization:** resource access checks and canonical role enforcement are
  applied to administration, user mutation, arbitration, and evidence access.
- **Payment workflow:** each Cryptomus funding event now receives a durable,
  cross-replica lease in `payment_operations`. A failed attempt is retryable;
  a completed attempt records its relay transaction hashes. Webhook and
  reconciliation use the same operation key, while RelayService re-checks
  chain state before any repeat transfer.
- **Financial records and delivery:** completed funding creates an immutable,
  idempotent double-entry ledger row. Outbox jobs have crash-recoverable
  leases and lease ownership checks before finalization.
- **Evidence intake:** uploads stay in memory, enforce an early MIME/size
  allow-list, require an actual file buffer, and use opaque storage keys.
  Production object storage and malware scanning must be configured before
  evidence bytes are persisted.
- **Automation:** CI already blocks secrets, vulnerable production
  dependencies, lint, build/test, and contract static analysis.

## Required production release gates

1. Apply migrations through the normal deployment pipeline with
   `DB_MIGRATIONS_RUN=true`; verify tables and indexes before any worker is
   enabled.
2. Configure a managed signer/KMS or multisig-controlled relay. Do **not**
   enable a production private key sourced from an ordinary environment
   variable. This repository does not contain cloud-provider credentials or a
   KMS adapter, so that integration needs the platform owner.
3. Configure private object storage, malware scanning, retention, and signed
   download URLs for evidence. The application must not serve an uploads
   directory publicly.
4. Run a staging replay test: duplicate PAID events, process termination
   between transfer/notify, expired leases, concurrent workers, and database
   failover. Reconcile every entry against the chain and ledger.
5. Keep `MONEY_EGRESS_ENABLED=false` until the above test evidence is signed
   off. Enable it only with `RECONCILIATION_ENABLED=true`, migration execution
   enabled, alert routing verified, and a rollback owner present.
