# ADR-008: TON finalized shard-descriptor inclusion

Status: Accepted for base workchain descriptor inclusion; shard-block and account proofs remain required.

## Decision

The proof kernel now binds a strict masterchain-state Merkle proof to the `newStateHash` committed by the header at the exact finalized checkpoint-chain target. It parses the authenticated masterchain `ShardStateUnsplit`, verifies network, masterchain shard, sequence and generation metadata, extracts `McStateExtra.ShardHashes`, proves workchain 0 through the Patricia dictionary and walks the exact `BinTree ShardDescr` prefix.

The shard selector derives the canonical prefix length from the signed uint64 shard identifier. Every fork consumes one high-order prefix bit; a leaf is accepted only at the exact requested depth. A selected pruned branch is unproven, never absent or accepted. Both `shard_descr#b` and `shard_descr_new#a` are parsed with exact consumption, including their currency layouts and future split/merge schedule.

The resulting shard `BlockIdExt` is authenticated by finalized masterchain state. Descriptor sequence, root/file hashes, logical-time range, masterchain registration/reference bounds, split/merge flags, next catchain identity and generation time are typed evidence.

## Security invariant

A successful result sets `shardDescriptorFinalityProven: true`, but fixes `shardBlockProofVerified: false`, `authorizationAllowed: false` and `verificationEvidenceHash: null`. The masterchain descriptor attests a shard top-block identity; it does not prove that a separately supplied shard block/header, account state or transaction belongs to that block.

The verifier is pure and unwired. No seal, settlement, durable ingestion, signing, broadcasting, money-egress or adapter-readiness path consumes it.

## Threat-model change

This slice closes substitution of detached provider shard metadata. It rejects:

- masterchain state proofs not committed by the finalized block state update;
- network, masterchain state sequence/time or header/chain endpoint drift;
- missing, absent or pruned `ShardHashes` workchain paths;
- invalid signed shard IDs, non-exact split-tree prefixes and target-path pruning;
- unsupported/trailing descriptor layouts, nonzero flags, zero hashes, invalid logical times and future masterchain references.

The following remain authorization-blocking:

- a strict shard-block header proof bound to the descriptor root/file hashes;
- shard-state and account-dictionary inclusion;
- transaction inclusion and account-block transaction dictionaries;
- proven Jetton master/wallet states and local `get_wallet_address` execution;
- Simplex applicability/support and captured mainnet/testnet offline replay;
- contract-ready verification evidence and threshold-approved workflows.

## Tests and evidence

Eight focused tests cover the positive full-shard descriptor, exact left/right split-child selection, both descriptor layouts and merge scheduling, state-update substitution, chain/header/state metadata drift, non-exact and pruned paths, malformed shard/descriptor metadata and provenance failure.

Synthetic fixtures prove parser and binding invariants only. Captured network proofs, bit flips and independent offline replay remain mandatory before Phase 1 exit.

## Observability and rollback

Telemetry may record the finalized masterchain block/state hash, proof root, workchain/shard/prefix, descriptor block ID, generation/logical time and bounded rejection reason. It must distinguish descriptor finality from shard-block/account/transaction proof completion. Rollback removes the pure module, generic dictionary export and this ADR. Production readiness and real-funds flags remain disabled.

## Next gate

Verify a strict shard-block Merkle proof against the finalized descriptor root hash, parse its exact shard identity and split/merge header rules, bind its state-update hash, and only then verify the shard state and account dictionary.
