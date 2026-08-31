# ADR-016: TON Simplex finality and proof-fixture capture

Date: 2026-08-20

## Status

Accepted as a pure, unwired Phase 1 compatibility and evidence-capture slice.
It does not enable the TON adapter, authorize an approval, hold keys, persist
production evidence, compose contract messages, or broadcast transactions.

## Invariant

A LiteServer Simplex signature set proves a forward-link vote only when the
candidate bytes parse exactly, the embedded extended block ID equals the link
destination, and unique validators from the Merkle-proven source configuration
sign strictly more than two thirds of total weight over the exact validator-node
Simplex finalization domain. Simplex bytes must never be reinterpreted as an
ordinary `ton.blockId` signature.

The signed data is the boxed `consensus.dataToSign(session_id, data)` value,
where `data` is the serialized boxed `consensus.simplex.finalizeVote` for a
boxed candidate ID. The candidate ID commits the signature-set slot and the
SHA-256 hash of the exact raw candidate TL object. LiteServer exports only
final Simplex certificates; notarization is not accepted by this schema.

## Threat-model change

TON networks can transition from ordinary signatures to Simplex. Rejecting the
new constructor preserved safety but prevented current proof replay. This
slice adds an explicit second consensus branch and keeps unknown constructors
fail-closed. It binds session, slot, candidate bytes, embedded block ID,
catchain sequence, validator-set hash, signer uniqueness, Ed25519 signatures
and strict protocol weight.

It does not make provider responses trusted. Captured responses remain inputs
to the local proof kernel. The capture compatibility codec only transports the
current authoritative `lite_api.tl` constructor through the older pinned
client; it is not a verifier and cannot produce an authorization artifact.

## Implementation

- `ton-lite-signature-proof.ts` strictly decodes ordinary and Simplex sets,
  parses both ordinary and empty candidate variants with exact consumption,
  reproduces the validator-node finalization bytes, and applies the shared
  weighted-signature verifier.
- `ton-forward-link-proof.ts` authenticates either supported consensus result
  against the same proven key-block configuration and records the consensus
  mode plus signed-data hash.
- `ton-checkpoint-chain.ts` commits each link's consensus mode and signed-data
  hash and reports whether a complete chain is ordinary or Simplex.
- `scripts/capture-ton-proof-fixture.ts` pins `ton-lite-client` and `ton-tl`,
  downloads the official network configuration, checks the zerostate identity,
  captures raw checkpoint/header/config/shard/account/transaction artifacts,
  and writes a content-hashed immutable manifest. Its narrow Simplex codec uses
  the authoritative field order only to preserve the raw response.

## Tests

Synthetic adversarial tests cover both candidate variants, exact signed bytes,
successful finalized Simplex threshold verification, candidate/block mismatch,
session/slot/candidate mutation, malformed/trailing/oversized candidates,
unknown constructors, ordinary/Simplex domain separation, authenticated
forward-link verification and a complete two-link Simplex checkpoint chain.

These tests establish algorithm and composition invariants, not real-network
compatibility. Strict manifest validation and provider-free replay are now
implemented in `ADR-017-TON-OFFLINE-PROOF-FIXTURE-REPLAY.md`. Phase 1 exit still
requires immutable captured mainnet and testnet corpora, successful replay of
both, cryptographic per-layer one-bit corruption tests, and independent review
of the proof and TVM-executor policy.

## Migration and rollback

There is no database or production wire-format migration. The checkpoint
result gains explicit supported-consensus fields and evidence commitments.
Rollback is a revert of this ADR, the Simplex branch, capture tool and pinned
capture-only development dependencies. Existing ordinary proof behavior stays
covered by its original tests.

## Observability and enablement evidence

Retain the official config bytes, zerostate, trusted key block, target block,
raw proof files, artifact hashes, capture timestamp/tool version, consensus
mode and signed-data hash. Before enablement, two independent reviewers must
replay the fixture without network access and approve the pinned fixture
manifest and verifier policy. `TonEscrowAdapter.isReady()` remains hard false.
