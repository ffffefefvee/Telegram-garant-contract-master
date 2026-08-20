# ADR-003: Local TON masterchain header-proof verification

Status: Accepted for the Phase 1 header-proof slice; validator-signature finality remains required.

## Decision

The proof kernel locally parses the virtual root committed by the masterchain Merkle-proof cell. It accepts a header only when the virtual root hash equals the expected block root hash and the root is a canonical TON `Block` containing a supported `BlockInfo`. The expected file hash remains unverified until the validator-signature chain is checked.

The parser binds the block to the trusted network global ID, masterchain workchain and shard, exact sequence number, immediate predecessor, previous trusted key block, logical-time interval, generation time, validator-list short hash, catchain sequence, minimum referenced masterchain sequence, optional global software version, and old/new state hashes committed by the exotic `MerkleUpdate`.

The outer envelope independently enforces freshness on both the observation and the locally parsed block generation time. A current provider timestamp cannot make an old block acceptable.

## Security invariant

A Merkle-valid header is not finalized evidence. This slice never changes `accepted`, `proofsVerified`, or `authorizationAllowed` from `false` and never emits `verificationEvidenceHash`. The header artifact explicitly carries `fileHashVerified: false`, `signaturesVerified: false`, and `finalityProven: false`; it is an internal typed result for subsequent signature-chain verification only.

## Threat-model change

Previously, the envelope bound an expected root hash to a generic Merkle-proof descriptor without proving that its virtual root was a TON masterchain block with matching header fields. This slice removes that ambiguity. It rejects wrong block tags, unsupported versions or flags, wrong global ID, non-masterchain shard identity, split/merge flags, wrong sequence/predecessor/key anchor, invalid logical time, malformed predecessor cells, wrong state-update type, and stale or future block generation time.

The following remain unverified and therefore authorization-blocking:

- validator-set derivation from the trusted key-block configuration;
- validator-list hash and catchain agreement with a signature set;
- Ed25519 signature identities, uniqueness, and signed weight;
- key-block transitions between the trusted anchor and target;
- full `ValueFlow`, `BlockExtra`, and key-block configuration semantics;
- shard descriptors, shard blocks, accounts, transactions, and local getter execution.

## Tests and evidence

Synthetic cells use the canonical TON TLB tags and exotic Merkle update/proof rules. Positive tests cover headers with and without optional `GlobalVersion`. Adversarial tests cover every bound identity and structural field, root substitution, wrong network, stale/future block time, non-block roots, and non-Merkle state updates.

Real mainnet and testnet fixtures remain mandatory before the Phase 1 exit gate. Synthetic fixtures demonstrate parser invariants but do not demonstrate network compatibility or finality.

## Observability

Failure telemetry may record a bounded reason category, trusted policy version, network, expected block ID, and structural audit hash. It must not log raw proof cells by default or count a parsed header as finalized. Separate metrics are required for descriptor failure, network mismatch, identity mismatch, key-anchor mismatch, freshness rejection, and malformed state update.

## Rollback

The verifier is pure, has no migration, and has no production consumer. Rollback removes this module and restores the envelope to the prior generic Merkle-root check. All TON real-funds flags and adapter readiness remain disabled.

## Next gate

Decode raw LiteServer partial block-proof links, derive the correct validator set from proven key-block configuration, reproduce TON's signed block-ID bytes, verify unique Ed25519 signatures and more than two-thirds of validator weight, and advance trusted checkpoints across key-block transitions. Only that independently tested chain may establish masterchain finality.
