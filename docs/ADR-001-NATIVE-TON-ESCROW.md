# ADR-001: Native TON escrow architecture

Date: 2026-08-17

Status: accepted for implementation; production deployment remains blocked by audit and launch gates

## Context

The product retains both TON and Polygon. A deal settles on exactly one selected network and asset. The existing TON payment rails fund Polygon escrow from a platform float and therefore are migration-only; they are not native TON settlement.

TON contracts execute asynchronously and jetton balances live in separate wallet contracts. Treating native TON and USDT jettons as branches inside one escrow would combine two different failure and reconciliation models in the most security-sensitive component.

The current official TON recommendation is Tolk with the Acton toolchain. Blueprint remains a supported legacy compatibility runner. Acton does not support native Windows, so Linux CI is the authoritative build environment; Blueprint may be used locally for early Windows feedback, but its artifacts are never promoted to production.

References:

- [TON smart-contract toolchain](https://docs.ton.org/contracts/overview)
- [Acton](https://github.com/ton-blockchain/acton)
- [Reference Tolk contracts](https://github.com/ton-blockchain/acton-contracts)
- [TEP-74 jetton standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)

## Decision

### Separate contracts per asset capability

We will implement two immutable contract templates:

1. `TonNativeEscrow` holds native TON and pays native TON.
2. `TonJettonEscrow` holds one allowlisted jetton through its deterministic jetton wallet and pays the same jetton.

Each deal deploys one isolated escrow through deterministic `StateInit`. Code hash, immutable storage, terms hash and quote hash determine its address. The backend and clients verify the code hash and complete initial storage before displaying a funding request.

No contract converts, bridges, swaps, wraps, or changes the selected asset.

### Immutable per-deal terms

Initial storage commits at least:

- deal identifier;
- buyer, seller, arbitrator and treasury addresses;
- terms hash and quote hash;
- buyer total, seller payout and platform fee;
- refund payout and refund fee;
- funding, delivery and buyer-confirmation deadlines;
- asset-specific configuration;
- initial status.

The following conservation equations must hold at address construction and in every terminal path:

```text
sellerPayout + platformFee = buyerTotal
refundToBuyer + refundFee = buyerTotal
buyerAward + sellerAward + platformFee = buyerTotal
```

### Native TON lifecycle

```text
AWAITING_FUNDING
  -> FUNDED
  -> DELIVERED
  -> RELEASED

FUNDED | DELIVERED
  -> DISPUTED
  -> RESOLVED

FUNDED
  -> REFUNDED (seller refund or seller-timeout refund)

DELIVERED
  -> RELEASED (buyer approval or buyer-confirmation timeout)
```

- Only the buyer funds, before `fundingDeadline`, with the committed `buyerTotal` plus an operational TON reserve; any excess is returned to the immutable buyer address.
- Only the seller marks delivery.
- Only the buyer releases before the confirmation deadline.
- Either party may open a dispute only before the deadline for the current funded/delivered phase; a late dispute cannot block a matured timeout.
- Only the fixed arbitrator may resolve a dispute; payout destinations cannot be changed.
- Seller-timeout refund and buyer-confirmation timeout release are permissionless after their committed deadlines.
- Terminal states reject replay.
- Query identifiers are correlation data, not global authorization nonces. The acyclic state machine prevents replay without allowing one party to lock out another with a maximum nonce.
- Outbound transfers use fixed recipients and exact committed amounts. They do not ignore action errors.

### USDT-TON lifecycle

`TonJettonEscrow` will be implemented separately after the native contract and will add:

- the official allowlisted USDT jetton master;
- a precomputed and independently verified escrow jetton-wallet address;
- validation that `transfer_notification` came from that wallet;
- finalized `(eventId, actionIndex)` ingestion and replay protection off-chain;
- two-phase payout legs with fixed destinations, query identifiers, retries and reconciliation;
- explicit recovery for partial, excess, bounced and downstream-failed transfers.

The current memo-based TON-to-Polygon rail is not reused inside this contract.

### Governance and upgrades

- Per-deal contracts are non-upgradeable.
- There is no arbitrary admin withdrawal or destination-changing rescue method.
- New versions use new code hashes and a staged allowlist.
- Deployment configuration and code-hash allowlists require multisig and timelock governance.
- Pausing creation of new deals must not block valid release, refund or dispute resolution for funded deals.

## Toolchain and artifact policy

- Language: Tolk.
- Authoritative build/test/check/format: a pinned numbered Acton release on Linux CI.
- Local Windows compatibility: pinned Blueprint, Sandbox and `@ton/tolk-js` versions.
- Production deployment accepts only an audited source commit and the matching CI-produced code hash.
- Generated wrappers and ABI are reproducible artifacts; hand-written wrappers are not authoritative.

## Required tests before activation

- every valid state transition and every invalid transition;
- authorization for buyer, seller, arbitrator and outsider;
- replay of every command in terminal and intermediate states;
- exact conservation for release, refund and dispute resolution;
- zero, boundary and maximum amounts;
- deadlines immediately before, at and after the boundary;
- failed outbound action and insufficient operational reserve;
- malformed messages and unknown opcodes;
- deterministic address and storage commitment;
- gas snapshots and mutation/fuzz tests;
- testnet deployment, independent indexer reconciliation and disaster recovery drill;
- independent external audit with all critical/high findings closed.

## Consequences

This creates two TON contract implementations rather than one, but removes asset-specific branching from each security boundary. Native TON can be validated first without claiming USDT support. The backend `EscrowChainAdapter` remains common orchestration, while the actual contracts, wallets, finality rules and recovery procedures remain chain- and asset-specific.
