# ADR-005: TON masterchain validator-set derivation

Status: Accepted for the Phase 1 derivation slice; configuration proof and finality remain required.

## Decision

The proof kernel now parses canonical TON `ValidatorSet` cells in both `validators#11` and `validators_ext#12` formats, plus legacy, extended and absent/default catchain configuration. It requires ordinary cells, exact TLB consumption, contiguous validator indices, unique Ed25519 public keys, nonzero weights, correct declared totals, valid `main` bounds and TON's `2^61` total-weight cap.

For masterchain consensus, the kernel reproduces TON's exact selection algorithm. It takes the first `main` validators and, when parameter 28 enables `shuffle_mc_validators`, applies the zero-seeded SHA-512 `ValidatorSetPRNG` over the masterchain shard, workchain and catchain sequence. It then reproduces `validator_list_hash_short` as CRC32C over TON's legacy validator-set serialization, including each public key, weight and ADNL address.

The derived catchain sequence and short hash are bound to the locally parsed masterchain header before the validator set may be passed to the ordinary-signature verifier.

## Security invariant

Correctly parsing a caller-supplied cell is not proof that the cell came from a finalized key-block configuration. Every artifact in this slice therefore fixes `sourceConfigProven: false`, `validatorSetProven: false` and `finalityProven: false`. Header binding proves equality only; it does not authenticate the source cell. No public envelope, seal, settlement, signer or broadcaster consumes the result.

## Threat-model change

This slice removes ambiguity around validator dictionary shape, descriptor identities, masterchain subset selection, shuffle rotation, short-hash byte order and catchain/header agreement. It also rejects invalid supplied catchain cells rather than silently applying protocol defaults; defaults are used only when a later proof establishes that parameter 28 is absent.

The following remain authorization-blocking:

- Merkle inclusion of parameters 34/35 and 28 in the exact source key-block configuration;
- proof that the configuration belongs to the trusted checkpoint chain;
- verification of every forward link and key-block transition;
- Simplex consensus finality;
- real mainnet/testnet offline fixture replay;
- shard, account, transaction and local getter proofs.

## Tests and evidence

Seventeen focused tests cover both validator-set formats, legacy zero ADNL behavior, invalid validity/count/weight declarations, non-contiguous dictionaries, duplicate keys, unsupported and trailing descriptors, ordinary-cell requirements, catchain defaults and formats, invalid flags/values, no-shuffle and shuffle golden vectors, catchain rotation, CRC32C golden values, header drift and signature-verifier handoff.

The golden shuffle and short-hash values are fixed test vectors derived from the official TON algorithms. Network-captured vectors remain mandatory before the Phase 1 exit gate.

## Observability and rollback

Telemetry may record bounded parse/derivation failures, source cell hashes, catchain sequence, selected validator count and reproduced short hash. It must not count any such result as proven finality. The module is pure and unwired; rollback removes it and this ADR. Production readiness and all TON real-funds flags remain disabled.

## Next gate

Verify the forward link's `config_proof` and `dest_proof` Merkle BOCs, extract the exact source key block and authenticated configuration dictionary, prove parameter selection/absence, and only then upgrade validator-set provenance. Compose that proven set with the signature verifier across the entire checkpoint path; no single-link success may imply chain finality.
