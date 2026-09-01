# USDT-TON Jetton validation boundary

Date: 2026-09-01

Status: funding authentication, complete isolated on-chain lifecycle and a
raw-evidence payout structural precheck implemented; durable wiring, external
review and real-funds capability remain disabled

## Purpose

Jetton symbols, names, images and decimal metadata are display data, not proof
of asset identity. A valid USDT-TON observation must instead bind the
allowlisted master, the escrow owner and the escrow's canonical Jetton wallet.

`validateCanonicalJettonWallet` accepts independently collected results from:

1. the allowlisted master contract's `get_wallet_address(escrowOwner)`; and
2. the returned wallet contract's `get_wallet_data()`.

It requires the master-reported wallet, observed wallet, expected wallet,
wallet-data owner and wallet-data master to agree after strict TON-address
normalization. Metadata is deliberately not an input.

`validateTonJettonTransferNotification` then parses the TEP-74 body and
requires:

- opcode `0x7362d09c`;
- a non-bounced message from the canonical escrow Jetton wallet to the escrow;
- exact immutable query ID and base-unit amount;
- the committed buyer as the previous owner; and
- the exact committed forward-payload cell hash, supporting both inline and
  referenced payloads without accepting trailing data.

Malformed BOCs return a rejection reason instead of throwing into the scanner.
The validator does not trust an indexer's interpreted symbol or transfer name.

`validateTonJettonFundingObservation` composes those checks with the finalized
transaction envelope. It additionally requires a durable account/LT/hash and
message hash, a positive masterchain block, explicit non-emulated and
non-aborted execution, successful compute and action phases, a non-bounced
inbound message to the exact escrow, no unexplained outbound messages and a
transaction timestamp within the immutable funding deadline. It remains pure
and unwired: acceptance cannot mutate a deal or enable an adapter.

The isolated `TonJettonEscrow` uses a two-phase wallet-sealing
design. StateInit commits the master, pinned wallet-code hash, buyer, amount,
funding query, payload, economic conservation, deadlines and immutable
initializer/reconciliation authorities, but deliberately does not contain the
escrow Jetton wallet address. This avoids the circular dependency where the
escrow address depends on a StateInit containing a wallet whose address itself
depends on the escrow owner address.

Funding is impossible before a one-time seal. The immutable initializer must
seal the independently verified canonical wallet with the pinned code hash and
a nonzero evidence commitment, using a strictly positive query below the
funding query. The contract then accepts one exact TEP-74 notification only
from that sealed wallet. This on-chain seal authenticates the initializer's
commitment; it cannot itself prove the master getter or wallet data. The
off-chain release workflow must independently verify `get_wallet_address`,
wallet code, and `get_wallet_data`, bind finalized evidence, and obtain the
required threshold approval before composing the seal message.

The implemented pure wallet-seal preflight is deliberately narrower. It parses
two configured collectors' raw getter cells and active wallet `ShardAccount`,
checks owner/master/code/address/network/block agreement, and emits a
domain-separated `structuralEvidenceHash` for audit comparison. It always
returns `sealingAuthorized: false`; `verificationEvidenceHash` remains null
until masterchain, shard and account proofs plus local getter execution are
implemented. The structural hash is not valid seal authorization.

After exact funding, the contract supports delivery, release, voluntary and
timeout refund, buyer-timeout release, dispute and arbitrator resolution. The
first settlement action persists an immutable plan containing its ID, outcome,
exact destinations and amounts, conservation commitment and active-leg mask,
then enters `SETTLEMENT_PENDING` before emitting complete TEP-74 transfer
messages. Transfer emission is never terminal success.

The immutable reconciliation authority must classify the complete current
attempt with disjoint confirmed/failed masks and nonzero evidence. Mixed
success enters `RECOVERY_REQUIRED`; a retry uses fresh ordered query IDs and
sends only failed legs. Rich bounces are accepted only from the sealed wallet
and bind the complete original transfer body, settlement/plan/attempt/leg,
query, destination, amount, response destination and canonical empty forward
payload. Bounces record evidence but cannot retry or finalize. Explicit
finalization requires the full immutable active mask confirmed and matching
nonzero reconciliation evidence.

`ton-jetton-payout-state` is a separate pure recovery model. It creates
conserving buyer/seller/treasury legs, assigns non-reusable uint64 query IDs and
idempotency keys, accepts only exact submitted/confirmed/bounced observations,
and permits a new attempt only after a bounce. It neither sends a transfer nor
claims that asynchronous payout recovery is operational.

`validateTonJettonPayoutReconciliation` is a pure, unwired structural precheck
for one payout leg and attempt. It requires observations from two collector IDs
whose distinct operator identities come from immutable trusted configuration;
the observation cannot self-declare independence. It locally parses raw TON
transaction BOCs and the embedded message cells for the three-transaction
chain:

1. the escrow owner instructs its canonical wallet with `transfer`
   (`0x0f8a7ea5`);
2. that wallet consumes the exact message and emits `internal_transfer`
   (`0x178d4519`); and
3. the canonical recipient wallet consumes the linked message successfully.

The expectation binds settlement, leg, attempt, exact owner transaction
account/LT/hash, query and a complete one-to-three-leg owner outbox. Transfer,
`internal_transfer`, `transfer_notification` and optional `excesses` bodies are
decoded locally from their hashed raw message cells, including strict trailing
data checks. A positive forward-TON amount requires one exact notification;
only one exact optional excess message is allowed. Raw pre/post `ShardAccount`
BOCs bind account-cell hashes to each wallet transaction's `state_update`, bind
previous/current transaction hash and LT, and locally parse active wallet code,
balance, owner and master. The exact sender debit and recipient credit must
agree, and the two collectors must reach the same expanded consensus
fingerprint over transaction, block-metadata, message and state identities.

This is intentionally **not finality proof**. The block identifiers in the
observations are consensus metadata only; this slice does not verify a shard
block's inclusion in a finalized masterchain block. Even after every structural
check passes, the result remains `accepted: false`, `settlementAuthorized:
false`, and `reasonCode: MASTERCHAIN_PROOF_REQUIRED`, with the explicit
remaining requirement `VERIFIED_MASTERCHAIN_SHARD_INCLUSION`. Malformed input
also fails closed without throwing. The module performs no provider calls,
persistence, ledger/FSM updates or payout-state mutation.

The isolated proof kernel can now bind a complete locally decoded transaction
BOC through the finalized shard block's canonical account-block and transaction
augmented dictionaries. A separate pure composer now binds one such proof for
every owner/sender/recipient transaction, their structural block fingerprints,
and the sender/recipient pre/post account hashes. It may report reconciliation
finality, but still fixes settlement authorization false and verification
evidence null. Both modules remain test-only.

A separate evidence layer now re-runs that finalized composition before
emitting a domain-separated `verificationEvidenceHash`. Its policy binds the
network, finalized-anchor floor, trusted-network configuration, captured
fixture manifest and independent review. Settlement authorization is expressed
only by a second artifact after a distinct Ed25519 threshold signs the exact
scope, subject, verification hash and immutable approval-policy hash. Wallet
seal approvals use a different scope and cannot be replayed. These primitives
remain pure and unwired; they do not persist evidence, mutate payout state,
compose messages or broadcast.

The v2 reconciliation suite has 27 raw-BOC and adversarial tests. The combined
reconciliation, funding, notification and payout-state focused run passes 4
suites / 90 tests. These passing tests do not satisfy the missing finality proof
requirement.

## Required composition

These slices are intentionally narrower than production settlement. The next
caller/integration must additionally provide:

- captured mainnet/testnet transaction and account-state proof fixtures with
  offline replay and bit-corruption coverage;
- durable transaction/message identity, replay and evidence-conflict handling;
- immutable `TonJettonEscrow` code/config/state commitments;
- a two-source, finalized canonical-wallet seal verifier and threshold-approved
  initializer workflow, including immutable approval/evidence persistence and
  the audited contract-message composition boundary;
- durable ingestion, transactional ledger/FSM application, scheduler/backfill,
  alerts and dual-authorized recovery around the pure validation result.

Until those checks, finalized ingestion, full lifecycle/payout contract logic,
testnet drills and external audit exist, these modules must not credit a deal or
enable the TON adapter.

Protocol references:

- [TON Jetton payment processing](https://docs.ton.org/payments/jettons)
- [TEP-74 Jetton standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)
