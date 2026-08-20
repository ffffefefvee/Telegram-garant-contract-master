# Native TON participant lifecycle

Date: 2026-08-18

This component continues a funded native-TON escrow through delivery, release,
voluntary refund, timeout or dispute. Polygon remains an independent,
first-class settlement option. Nothing in this component bridges funds or asks
a TON user to connect an EVM wallet.

The participant API and scanner remain unreachable for real money while
`TonEscrowAdapter.isReady()` is hard-coded to `false`.

## Arbitration authority model

The contract commits one resolver-authority address before funding, while a
human arbitrator is selected only after a dispute exists. These are deliberately
different roles:

- the assigned human arbitrator reviews evidence and records the decision;
- the appeal process determines when that decision is final; and
- an administrator connected to the exact immutable resolver-authority wallet
  requests on-chain enforcement.

The authority cannot select arbitrary transaction fields. The backend derives
buyer/seller awards deterministically from the committed decision type and the
contract's immutable distributable principal. The request commits the decision
ID and SHA-256 fingerprint, exact awards, query ID and payload. Production must
replace a single authority key with an audited multisig/threshold governance
arrangement; the current hard-disabled path is suitable only for development.

`POST /api/arbitration/decisions/:id/ton-native/resolve-request` requires an
admin/super-admin role, an unappealed final decision whose appeal window has
expired, a disputed deal, and a verified TON binding equal to the authority
address in that escrow. The assigned arbitrator cannot bypass this enforcement
boundary merely by holding the arbitrator role.

## Immutable action requests

`POST /api/deals/:id/ton-native/action-request` accepts one of:

| Action                        | Authorized signer  | Required contract state                 | Result    |
| ----------------------------- | ------------------ | --------------------------------------- | --------- |
| `mark_delivered`              | seller             | funded, before delivery deadline        | delivered |
| `release`                     | buyer              | delivered, before confirmation deadline | released  |
| `open_dispute`                | buyer or seller    | funded/delivered, before its deadline   | disputed  |
| `refund_buyer`                | seller             | funded/delivered                        | refunded  |
| `refund_after_seller_timeout` | either participant | funded, after delivery deadline         | refunded  |
| `release_after_buyer_timeout` | either participant | delivered, after confirmation deadline  | released  |

The server verifies the deal state and role against the immutable preparation
and the user's verified TON binding. It generates the opcode, 64-bit query ID,
payload BOC and action value; clients cannot override any transaction field.
One immutable intent is stored per preparation/action/from-state/requester so a
retry cannot silently change the reason, signer or payload.

`TON_NATIVE_ACTION_VALUE_NANO` defaults to 50,000,000 nanotons and is bounded
to 0.001-1 TON. It is execution value, not the platform commission. The final
production value must come from audited gas and reserve snapshots.

## Finalized transaction acceptance

The lifecycle scanner polls only active funded escrow watches. A transaction is
accepted only when it has durable account/LT/hash/masterchain identity and all
of the following match the stored intent and preparation:

1. non-emulated, non-aborted compute and action success;
2. exact sender, escrow destination and minimum committed action value;
3. exact opcode, query ID and payload hash, with no trailing data;
4. action time relative to the immutable deadline;
5. approved contract code hash and exact config hash after execution;
6. expected contract status, funded amount and last query ID; and
7. for a release/refund/resolution, the complete expected payout message set: exact
   destination, amount and payout-notification body for each non-zero movement.

Rejected observations remain append-only evidence. The durable unique identity
`(network, account, logical time, transaction hash)` makes duplicate polling and
concurrent scanner replicas converge on one event.

Before any ledger or deal effect, PostgreSQL locks the chain-event row with
`FOR UPDATE SKIP LOCKED`. Only the replica holding that row lock may apply the
event. A competing replica skips it without recording a false failure. If the
worker or database connection dies, PostgreSQL releases the lock automatically
and the unchanged unapplied event is eligible for crash replay.

Inside that same serialized application boundary, production can require an
independent API v2/liteserver confirmation. The backend locally decodes the raw
transaction BOC and compares its identity, inbound message and post-state with
the primary v3 evidence, then compares the current account code/data hashes.
Missing or contradictory secondary evidence moves the watch to manual review
before any ledger or deal effect. The secondary source cannot be another
`toncenter.com` URL. This corroboration does not claim local Merkle-proof
validation; that remains a separate assurance decision.

## Application and accounting

Accepted events are retried until applied. Release posts escrow debits to the
seller and treasury; refund posts them to the buyer and, when non-zero, the
treasury. Every movement has a chain-event-derived idempotency key and exact
nanoton-to-decimal conversion. The same event advances the off-chain deal FSM.

Five failed applications stop automation and move the watch to manual review.
This is a circuit breaker, not an instruction to treat a failed application as
settled.

Admins can inspect the stopped event and append an audited keep-blocked note.
Requeue requires two different super-admins and an exact last-error token. The
second approval merely returns the event to the normal queue: it must pass the
same independent reconciliation again, and the watch remains blocked until
successful application. There is no manual force-apply endpoint. Required
audit-log failure rolls the recovery transaction back.

## Still required before enablement

- expanded crash-injection tests beyond the newly covered partial accounting
  and ledger-before-deal-FSM boundaries, across every remaining
  ledger/deal/intent write boundary;
- production multisig/threshold resolver integration and signer recovery drills;
- production provisioning of the implemented independent v2/liteserver gate,
  reconciliation alerts/drills and continuous economic reconciliation;
- repeatable outage/disagreement drills for the implemented rejected-event
  search, bounded cursor backfill and dual-approval recovery runbook;
- testnet gas/reserve calibration against the committed Acton baseline,
  failure drills and hardware-threshold-approved release evidence;
- independent TON contract and backend funds-flow audit with all Critical/High
  findings remediated and retested.

Finality and monitoring assumptions follow the official
[TON payment monitoring guide](https://docs.ton.org/applications/payments/overview),
[message model](https://docs.ton.org/foundations/messages/overview),
[TON Center v3 transaction API](https://docs.ton.org/api/v3/blockchain-data/get-transactions)
and [streaming finality reference](https://docs.ton.org/api/streaming/reference).
