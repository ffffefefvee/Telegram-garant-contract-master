# ADR-009: TON finalized shard-block header proof

Status: Accepted for the Phase 1 shard-block slice; account and transaction proof remain required.

## Decision

The proof kernel now accepts a strict shard-block Merkle-proof BOC only after a
finalized shard descriptor has authenticated its exact root hash. It parses the
virtual root as a TON `Block`, binds `global_id`, workchain, shard prefix,
sequence number, generation time, logical-time interval and split/merge intent
to the descriptor, and extracts the old and new shard-state hashes from the
block's exotic `MerkleUpdate`.

Predecessor interpretation is local and protocol-shaped. An ordinary block must
immediately follow one predecessor on the same shard. An after-split block must
immediately follow its parent shard. An after-merge block must immediately
follow the maximum sequence of its two child shards. Simultaneous split and
merge ancestry, impossible initial-state transitions and invalid sequence
relationships fail closed. The shard block's masterchain reference must also
remain within the bounds committed by the finalized descriptor.

A successful result sets `shardBlockProofVerified: true` and
`shardBlockFinalityProven: true`, but fixes `shardStateProofVerified: false`,
`authorizationAllowed: false` and `verificationEvidenceHash: null`. The state
update proves only a hash commitment. A detached `ShardStateUnsplit`, account or
transaction is not accepted as proven evidence.

## Security boundary

This slice rejects:

- shard-block proofs whose virtual root is not the finalized descriptor root;
- network, workchain, shard, sequence, prefix, logical-time, generation-time or
  split/merge metadata drift;
- masterchain blocks masquerading as shard blocks and unsupported block-info
  versions or flags;
- malformed, pruned or inconsistent predecessor and masterchain references;
- invalid predecessor sequence, parent or child relationships; and
- a state update that is absent, malformed or not an exotic `MerkleUpdate`.

It does not prove the virtual shard state against `newStateHash`, membership in
the account dictionary, account code/data, account transactions, Jetton master
behavior or a locally executed `get_wallet_address`. It therefore cannot
produce contract seal evidence or authorize settlement.

## Evidence and tests

The typed artifact records the finalized block ID, block metadata,
masterchain/predecessor IDs, state-update hashes and proof-root hash. Twelve
focused tests cover ordinary, after-split and after-merge paths, root
substitution, network/identity/metadata drift, invalid ancestry, non-Merkle
state updates and provenance failure.

Fixtures are deterministic and synthetic. Captured mainnet and testnet proofs,
per-layer corruption and independent offline replay remain mandatory before the
Phase 1 exit gate.

## Operations and rollback

The module is pure and has no production consumer. Telemetry may record block
identity, predecessor identities, state hashes and bounded rejection reasons,
but must distinguish shard-block finality from shard-state/account/transaction
verification. Rollback removes the pure module and this ADR. Adapter readiness
and every real-funds flag remain disabled.

## Next gate

Verify a canonical shard-state proof whose virtual root equals the shard
block's committed `newStateHash`, then prove exact `ShardAccount` and
transaction-dictionary membership. Canonical LiteServer account proof uses a
two-root BOC (block header proof plus shard-state proof), so the proof-bundle
schema must represent and validate that boundary rather than pretending an
account proof is a detached single-root cell.
