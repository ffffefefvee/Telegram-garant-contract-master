# ADR-004: Strict TON LiteServer ordinary-signature verification

Status: Accepted for the Phase 1 signature-primitive slice; validator-set provenance and finality remain required.

## Decision

The proof kernel has a pure decoder for raw `liteServer.partialBlockProof` TL bytes and a verifier for ordinary forward-link signatures. The decoder consumes exactly one canonical TL object, enforces explicit limits for the raw payload, links, signatures and embedded proof blobs, and validates a contiguous masterchain path. It rejects unknown link constructors, malformed vectors, non-canonical byte lengths or padding, trailing bytes, wrong endpoints and invalid forward/backward sequence direction.

The ordinary verifier reproduces TON's signed bytes exactly: the little-endian constructor `ton.blockId#c50b6e70`, followed by the target root and file hashes. It derives each validator node ID as SHA-256 of `pub.ed25519#4813b4c6` plus the 32-byte public key, requires unique known signers, verifies every Ed25519 signature, sums weights with TON's `2^61` cap, and requires `signed_weight * 3 > total_weight * 2`.

Modern Simplex signature sets use a different candidate/session voting domain. This slice rejects every non-ordinary signature-set constructor rather than interpreting it as an ordinary block signature.

## Security invariant

Cryptographically valid signatures from a caller-supplied set do not prove that the set is the network's validator set. The result type therefore fixes `validatorSetProven: false` and `finalityProven: false`. It is not wired into the public proof envelope, wallet sealing, settlement, signing or broadcast, and it cannot emit a `verificationEvidenceHash`.

## Threat-model change

This slice removes ambiguity around LiteServer TL framing, signature identity, signed block bytes, duplicate signers and weighted threshold arithmetic. It does not trust provider booleans or decoded objects.

The following remain authorization-blocking:

- Merkle verification of key-block configuration and validator parameters;
- canonical masterchain validator-subset selection and short-hash derivation;
- key-block transitions from a trusted network checkpoint;
- Simplex finality verification;
- binding decoded links and proven validator sets into the public envelope;
- shard, account, transaction and local getter proofs.

## Tests and evidence

Twenty-one focused tests cover forward/backward/empty paths, exact constructors, canonical base64 and TL byte consumption, limits, masterchain identity, continuity, ordinary-only handling, public-key short IDs, signed-data layout, valid weighted signatures, the exact two-thirds rejection boundary, duplicate and unknown signers, wrong-block signatures, metadata drift, duplicate validators and malformed weights.

The fixtures are deterministic and synthetic. Captured mainnet and testnet proof vectors remain mandatory before the Phase 1 exit gate.

## Observability and rollback

Telemetry may record bounded parser/verifier reason categories, raw-content hash, endpoint IDs, signature count and verified weight. It must not log raw proofs or count this artifact as finality. The module is pure and unwired; rollback removes it and this ADR. All TON real-funds flags and adapter readiness remain disabled.

## Next gate

Verify the key-block configuration proof, parse validator parameters, reproduce masterchain validator selection and the validator-list short hash, and apply the ordinary verifier only to that proven set across every checkpoint transition. Add Simplex support or a network-policy gate backed by real fixtures. Only a complete chain from a trusted checkpoint may set `finalityProven: true`.
