# Native TON finalized funding ingestion

Date: 2026-08-17

This component recognizes native-TON funding of the deterministic per-deal
escrow. It does not change Polygon and does not enable native-TON funding.

## Trust boundary

The scanner queries the TON Center v3 finalized transaction index for only the
escrow addresses already committed in `ton_native_escrow_preparations`. TON
account logical time (`lt`) is strictly increasing, and a transaction is final
when its shard state is referenced by a masterchain block. The implementation
therefore requires a positive `mc_block_seqno`, rejects emulated responses and
persists the tuple `(network, account, lt, transaction hash)`.

Primary references:

- [TON payment monitoring and finality](https://docs.ton.org/applications/payments/overview)
- [TON messages and account transaction ordering](https://docs.ton.org/foundations/messages/overview)
- [TON Center v3 transaction endpoint](https://docs.ton.org/api/v3/blockchain-data/get-transactions)
- [TON streaming finality levels](https://docs.ton.org/api/streaming/reference)

Polling is intentionally used as the durable baseline. A future finalized SSE
consumer can reduce latency, but it must feed the same transaction identity and
validation pipeline. Streaming notifications can repeat as finality changes,
so they cannot replace database idempotency.

## Acceptance rules

A transaction advances a deal only when all checks pass:

1. Account, destination and sender equal the immutable escrow and verified
   buyer addresses.
2. The indexed transaction is non-emulated, has a masterchain sequence number,
   is not aborted, and has successful compute/action phases.
3. The transaction occurred no later than the committed funding deadline and
   attached at least the exact request amount.
4. The inbound body is the exact committed BOC and decodes to the `Fund` opcode
   plus the quote-derived query ID, with no trailing bits or references.
5. Post-state is active and contains the approved contract code hash.
6. Post-state data decodes to `FUNDED`, the exact buyer total, the same query ID
   and the immutable config-cell hash.

The post-state check is important: an apparently successful transfer is not a
funding confirmation unless the intended contract actually committed the
intended state.

## Independent reconciliation before accounting

When `TON_NATIVE_RECONCILIATION_REQUIRED=true`, an accepted v3 observation
cannot affect the ledger or deal state until a separately operated API v2,
backed by TON liteservers, independently confirms it. The backend requests the
exact account/LT/hash transaction, decodes its raw BOC locally and verifies:

1. the root and decoded transaction hashes, LT, time and escrow account;
2. the inbound sender, destination, value and payload-cell hash;
3. the transaction's post-state hash; and
4. the account's exact latest transaction plus post-state code/data BOC hashes.

The secondary URL cannot use a `toncenter.com` hostname, so a second endpoint
from the primary indexer is not misrepresented as an independent source. Any
missing or contradictory evidence stops that event before money accounting,
records a stable reconciliation reason and moves the watch to
`manual_review`. Successful source and hash commitments are persisted on the
chain-event row for audit.

This is independent liteserver-backed corroboration, not yet local validation
of the shard-to-masterchain Merkle proof. Self-hosting the v2/liteserver path,
monitoring its provenance, and adding or independently auditing local proof
verification remain production-assurance work.

## Persistence and replay

- `ton_native_escrow_watches` stores the latest finalized LT/hash/masterchain
  cursor and provider health for each prepared address.
- `ton_native_chain_events` is append-only evidence for accepted and rejected
  finalized transactions.
- An accepted event writes one balanced ledger entry from
  `external_buyer_ton` to the deal escrow account using an exact decimal
  conversion from nanotons, then moves the deal from `pending_payment` to
  `in_progress`.
- Ledger idempotency is keyed by chain-event UUID. Deal confirmation is
  idempotent once `fundedAt` exists.
- Every run first retries accepted but unapplied events, so a crash between the
  chain observation, ledger write and deal transition is recoverable.
- Funding and lifecycle application acquire a PostgreSQL
  `FOR UPDATE SKIP LOCKED` lock on the exact chain-event row. This serializes
  side effects across scheduler replicas without a lease-expiry overlap;
  database/session failure releases the lock automatically for replay.
- Five failed application attempts stop automation and move the watch to
  `manual_review`; automated retries do not continue indefinitely.
- A bounded 1,000-transaction pass prevents an unexpectedly large backlog from
  monopolizing the worker. Hitting the bound is an explicit operator backfill
  condition, never a silent cursor jump.

## Operator inspection and recovery

Authenticated admin inspection is exposed under
`/api/admin/ops/ton-native`. Admins can list and inspect stopped accepted
events, rejected-event evidence and watch cursors, filtered by deal/network and
stable rejection reason. They can append a required-audit note that keeps an
incident blocked.

Requeue is deliberately not a force-settlement operation. It requires two
different super-admins:

1. `POST /:eventId/requeue-requests` records the first approval, reason and the
   exact last-error concurrency token while the event remains stopped.
2. `POST /:eventId/requeue-requests/:requestId/approve` requires a different
   super-admin, locks the request/event/watch rows and rejects stale evidence.
3. Only after both approvals is the event returned to the ordinary application
   queue. The watch remains in `manual_review` until the event again passes the
   same independent reconciliation and business validation pipeline.

A pending request can be cancelled with an audited reason without changing the
blocked event or watch.

There is no endpoint that marks an event applied, edits chain evidence or
bypasses reconciliation. Both approvals and keep-blocked notes use required
transactional audit writes; an audit failure rolls back the recovery action.
The monitoring loop publishes `ton_native_manual_review_watches` and
`ton_native_stopped_events` and raises one deduplicated operator alert while
either count is non-zero.

A super-admin can request a targeted scan of 1-10 provider pages for an active
watch at `POST /watches/:watchId/backfill`. It starts after the existing durable
cursor and runs the ordinary finalized validation, append-only evidence,
reconciliation and idempotent application pipeline. It refuses manual-review
and terminal watches and cannot rewrite or skip the cursor. A required audit
write precedes the scan. See `TON_NATIVE_INCIDENT_RUNBOOK.md` for the complete
decision procedure.

## Configuration

```dotenv
TON_NATIVE_INGESTION_ENABLED=false
TON_NATIVE_RECONCILIATION_REQUIRED=false
TONCENTER_V3_BASE_URL=
TONCENTER_API_KEY=
TON_LITESERVER_V2_BASE_URL=
TON_LITESERVER_V2_SOURCE=
TON_LITESERVER_V2_API_KEY=
TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS=300000
```

When no URL override is supplied, mainnet uses
`https://toncenter.com/api/v3` and testnet uses
`https://testnet.toncenter.com/api/v3`, selected from the immutable preparation
network. The API key is server-only.

## Remaining release gates

- Provision and harden the separately operated/self-hosted API v2 liteserver
  source, enable mandatory reconciliation, alert on every circuit break and
  complete disagreement/outage/backfill drills. Decide whether audited local
  shard-proof validation is also required for launch.
- Exercise the implemented rejected-event inspection, bounded cursor backfill,
  stopped-event inspection and dual-authorized recovery runbook in repeatable
  outage/disagreement drills. No recovery route may force settlement.
- Participant delivery, release, refund, timeout and dispute messages now use
  finalized, replay-safe lifecycle ingestion. Arbitrator resolution and award
  payouts still require their dedicated privileged path and recovery controls.
- Alerting, provider-outage drills, cursor backfill drills and testnet economic
  reconciliation must pass.
- The contract and complete backend funds flow require an independent audit.

Until those gates pass, `TonEscrowAdapter.isReady()` remains hard-coded to
`false`; the wallet never receives a sendable production request.
