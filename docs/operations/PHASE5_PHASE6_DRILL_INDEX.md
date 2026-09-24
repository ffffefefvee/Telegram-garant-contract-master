# Phase 5/6 operational drill index

Prepared: 2026-09-20

These records intentionally do not claim unexecuted production-candidate drills.
`BLOCKED` means an owner, controlled environment and external credentials have
not yet been supplied. Replace no historical result; append the executed UTC
record and evidence links to the corresponding file.

| Drill | Status | Owner | Report |
| --- | --- | --- | --- |
| Compromised signer | BLOCKED | UNASSIGNED | `compromised-signer.md` |
| PostgreSQL outage/recovery | BLOCKED | UNASSIGNED | `postgresql-outage-recovery.md` |
| Redis/queue outage/replay | BLOCKED | UNASSIGNED | `redis-queue-outage-replay.md` |
| RPC/indexer outage/lag/disagreement/reorg | BLOCKED | UNASSIGNED | `rpc-indexer-failure.md` |
| Durable cursor corruption | BLOCKED | UNASSIGNED | `durable-cursor-corruption.md` |
| Audit/evidence backup restore | BLOCKED | UNASSIGNED | `audit-evidence-backup-restore.md` |
| Stuck funding transaction | BLOCKED | UNASSIGNED | `stuck-funding-transaction.md` |
| Partial payout attempt | BLOCKED | UNASSIGNED | `partial-payout-attempt.md` |
| False reconciliation report | BLOCKED | UNASSIGNED | `false-reconciliation-report.md` |
| Global settlement stop/recovery | BLOCKED | UNASSIGNED | `global-settlement-stop-recovery.md` |

Supplemental local engineering exercise (not one of the ten mandatory
production-candidate drills): Jetton two-person cursor recovery, LOCAL PASS,
Engineering automation; see `jetton-two-person-local-drill.md`. It does not
change any `BLOCKED` status above.

Every executed record must name the owner and participants; include UTC start
and end, exact commit/environment, initial and final ledger/chain/queue/nonce/
evidence state, injected failure, invariant, alerts, operator decisions, exact
recovery steps, measured recovery time, redacted evidence references, explained
delta, remediation commit, retest and sign-off.
