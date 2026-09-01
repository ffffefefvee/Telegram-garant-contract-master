# ADR-018: TON Jetton settlement lifecycle

Date: 2026-09-01

Status: implemented and locally verified; production authorization prohibited

## Decision

`TonJettonEscrow` is an isolated per-deal TEP-74 escrow. After immutable
canonical-wallet sealing and exact funding, it uses these states:

```text
AWAITING_FUNDING -> FUNDED -> DELIVERED -> SETTLEMENT_PENDING
                         \-> DISPUTED  -> SETTLEMENT_PENDING
SETTLEMENT_PENDING -> RECOVERY_REQUIRED -> SETTLEMENT_PENDING
SETTLEMENT_PENDING -> SETTLED_FINALIZED
```

Release, voluntary refund, both timeout paths and arbitrator resolution create
one immutable settlement plan. The plan fixes settlement ID, outcome, buyer,
seller and treasury destinations and amounts, total conservation commitment and
active-leg mask. Each attempt fixes its number, active/confirmed/failed/bounced
masks, reconciliation evidence and per-leg query IDs.

Query zero denotes an inactive leg. Active query IDs are strictly increasing,
fresh relative to the action cursor and cannot consume `uint64.max`. A retry is
allowed only from `RECOVERY_REQUIRED`, increments the attempt and sends only
the previous failed mask with fresh queries. Confirmed legs cannot be resent.

## Protected invariants

- Exact buyer total equals the immutable buyer, seller and treasury plan sum.
- The plan, destinations and amounts cannot change after the first attempt.
- Complete TEP-74 transfer bodies are sent only to the sealed canonical wallet.
- Storage enters `SETTLEMENT_PENDING` before payout instructions are emitted.
- Emitting an instruction or receiving a bounce cannot finalize settlement.
- Reconciliation uses a distinct immutable authority and requires a complete,
  disjoint classification of the active attempt.
- Every bounced leg must be classified failed before retry.
- `SETTLED_FINALIZED` requires the complete base mask confirmed and the exact
  nonzero persisted reconciliation evidence.
- Invalid persisted state fails closed before any message is handled.

## Threat-model change

The reconciliation authority is explicitly money-moving: a false failed-leg
classification could duplicate payment. The contract therefore does not infer
recipient credit from a transfer instruction or a bounce. Finality proof and
threshold authorization remain off-chain prerequisites, and the authority must
be a distinct threshold/multisig identity in any later deployment.

Rich bounces are untrusted inputs. The handler requires the sealed wallet as
sender and validates the full original transfer: current query/leg, immutable
destination and amount, escrow response destination, settlement/plan/attempt
payload commitment, zero forwarded TON and canonical empty inline payload.
Unknown, repeated, stale, truncated or ambiguous bodies fail closed.

## Assurance

The authoritative Acton suite covers exact two- and three-leg actions,
zero-value legs, all roles/states/deadlines/outcomes, replay, query exhaustion,
partial success, failed-leg retry, complete finalization, corrupted storage,
repeated/stale/rich bounces, unexpected funding, empty top-ups, insufficient TON
and action-list rollback. The Jetton critical/major mutation gate kills all 384
executable mutants; two generated mutants are rejected by the compiler. The
native gate remains 110/110. The shared 40-test/64-fuzz-run gas snapshot replays
with zero drift.

TypeScript wrapper tests prove the ABI and cell layout against the compiled
contract. Blueprint Tolk 1.4.1 and Acton 1.1.0 independently produce code hash
`cbe811eb5df11ae64a03f2960154816011df82789ffb5b8a9b0976c26ea6ac73`.
The Jetton reproducibility manifest is verification-only and fixes
`authorizationAllowed: false`.

## Migration and rollback

This storage/ABI is incompatible with the earlier funding-only StateInit.
There is no in-place migration and no production deployment to upgrade. A deal
must use one exact code/config hash for its lifetime. Rollback means disabling
new preparations and returning to the Phase 1 mainline rollback point; funded
instances must never be silently reinterpreted or migrated.

## Operational evidence

Operators can read status, last query ID, sealed-wallet hash, config hash and
settlement hash. Durable ingestion must retain raw transactions, full proof
artifacts, attempt/mask/query identities and threshold authorization before it
may submit reconciliation or finalization. Source disagreement, incomplete
classification, query exhaustion, action failure or unexpected balance changes
must stop automation and require review.

## Consequences and remaining gates

The contract lifecycle gate is complete, but real funds remain prohibited.
Phase 3 durable ingestion, testnet recovery drills, independent contract and
funds-flow audit, production authority separation and the remaining program
gates are still mandatory. `TonEscrowAdapter.isReady()` remains hard false.
