# USDT-TON Jetton validation boundary

Date: 2026-08-18

Status: funding-authentication contract and fail-closed backend validation
slices implemented; no Jetton real-money capability is enabled

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

The isolated funding-only `TonJettonEscrow` commits the canonical Jetton wallet,
master, buyer, amount, query ID, forward-payload hash, economic conservation and
funding deadline. It accepts one exact TEP-74 notification from that wallet and
then becomes funded; wrong/replayed/late/bounced or malformed notifications fail
closed. Its master commitment is not self-proving: deployment preparation must
derive the wallet from the allowlisted master and the backend must independently
verify both `get_wallet_address` and `get_wallet_data` evidence.

`ton-jetton-payout-state` is a separate pure recovery model. It creates
conserving buyer/seller/treasury legs, assigns non-reusable uint64 query IDs and
idempotency keys, accepts only exact submitted/confirmed/bounced observations,
and permits a new attempt only after a bounce. It neither sends a transfer nor
claims that asynchronous payout recovery is operational.

## Required composition

These slices are intentionally narrower than production settlement. The next
caller/integration must additionally prove:

- durable transaction/message identity and replay protection;
- the post-transaction Jetton balance delta;
- exact immutable `TonJettonEscrow` code/config/state commitments; and
- complete outbound transfer, excess and bounce/recovery reconciliation,
  including finalized Jetton-wallet transactions and balance deltas.

Until those checks, finalized ingestion, full lifecycle/payout contract logic,
testnet drills and external audit exist, these modules must not credit a deal or
enable the TON adapter.

Protocol references:

- [TON Jetton payment processing](https://docs.ton.org/payments/jettons)
- [TEP-74 Jetton standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)
