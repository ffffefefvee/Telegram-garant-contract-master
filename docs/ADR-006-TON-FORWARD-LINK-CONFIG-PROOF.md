# ADR-006: TON forward-link configuration proof

Status: Accepted for one ordinary forward-link slice; complete checkpoint-chain finality remains required.

## Decision

The proof kernel now validates an ordinary LiteServer forward link using the dependency order enforced by TON's reference `BlockProofLink::validate` implementation:

1. `config_proof` must be one strict, bounded Merkle-proof BOC whose virtual level-zero root is the exact source `BlockIdExt.root_hash`.
2. That source must be the configured trusted masterchain key block on the trusted `global_id`, and its proven `McBlockExtra` must contain the configuration dictionary.
3. `dest_proof` must independently authenticate the exact destination masterchain block and its key-block flag, catchain sequence and validator-list short hash.
4. Authenticated Patricia-dictionary lookups select parameter 35 before 34 and either parse parameter 28 or establish its absence before applying protocol defaults.
5. The derived masterchain validator set must reproduce the destination header hash, and the ordinary Ed25519 signature set must exceed two-thirds of its proven weight.

The dictionary lookup has three states: present, proven absent and unproven. Encountering a pruned branch on the requested path is never treated as absence. Cell identities under a Merkle proof use explicit level-zero hashes; the library's highest-level default hash is not used for block or configuration identity.

## Security invariant

A successful result proves one forward transition from one explicitly trusted source key block to one signed destination block. It upgrades `sourceConfigProven`, `validatorSetProven`, `signaturesVerified` and `linkVerified` to true for that link only. It fixes `finalityProven: false` because a single independently supplied link is not a complete trusted-checkpoint path and does not satisfy the finality/staleness policy for the proof bundle.

The module remains pure and unwired. It emits no seal or settlement verification commitment and cannot authorize signing, broadcasting, funding, payout reconciliation, durable application or adapter readiness.

## Threat-model change

This slice closes provider substitution of the source configuration, optional-parameter fallback, destination header, validator-list identity and ordinary signatures for one link. It rejects:

- source checkpoint or network substitution;
- proof-root, destination-root and `toKeyBlock` disagreement;
- malformed, trailing, oversized or over-complex proof BOCs under the shared envelope policy;
- parameter 28, 34 or 35 hidden behind a pruned path;
- incorrect 35-to-34 fallback or unproved catchain defaults;
- header/derived-set disagreement and invalid, unknown, duplicate or insufficient signatures.

The following remain authorization-blocking:

- validation of a complete contiguous partial-proof path from the trusted checkpoint, including backward links and key-block transitions;
- explicit complete/incomplete proof and staleness policy;
- Simplex signature-set support or a proven fail-closed applicability rule;
- real mainnet/testnet offline fixture replay;
- shard-descriptor, shard-block, account and transaction inclusion proofs;
- local execution of `get_wallet_address` and a domain-separated verification-evidence commitment.

## Tests and evidence

Fifteen focused tests cover authenticated presence, authenticated absence and pruned-path ambiguity; parameter 35 priority and parameter 28 defaults; the positive config/header/validator/signature composition; trusted-source and destination substitution; strict trailing-byte rejection; key-block-flag drift; header/set and signature-metadata drift; insufficient weight; and typed link-shape failure.

Synthetic cells exercise invariants only. Captured mainnet and testnet LiteServer vectors, per-layer bit flips and offline replay remain mandatory before the Phase 1 exit gate.

## Observability and rollback

Telemetry may record source/destination block IDs, proof hashes, configuration root hash, selected parameter number, catchain sequence, validator-set hash/count and signed/total weight. It must never report single-link success as finality. Rollback removes the pure module and this ADR; production readiness and all real-funds flags remain disabled.

## Next gate

Validate the entire decoded `partialBlockProof` as a contiguous checkpoint chain, including backward-link state/old-block proofs, forward transitions, completeness, trusted endpoints and finality/staleness policy. Ordinary single-link results may be composed only inside that chain verifier. Simplex must remain fail-closed until its distinct protocol is implemented and independently reviewed.
