# ADR-010: TON finalized account-state inclusion

Status: Accepted for the Phase 1 account-state slice; local getter and transaction proof remain required.

## Decision

The proof kernel now follows the canonical LiteServer account-proof boundary
implemented by TON itself. An account proof BOC must contain exactly two
complete Merkle-proof roots: the first authenticates the shard block header and
the second authenticates the `ShardStateUnsplit` committed by that block's
state update. A separately supplied one-root account state BOC must hash to the
`Account` reference authenticated inside `ShardAccounts`.

The strict BOC foundation now applies byte, cell, depth, framing, CRC, exact
root-cardinality and reachability checks to the whole proof. One-root account
proofs, non-Merkle roots and cells unreachable from every declared root fail
closed.

The account verifier binds the two virtual roots to the already finalized shard
block root and `newStateHash`. It then verifies shard-state network, workchain,
shard, sequence, vertical sequence, generation time/logical time, minimum
masterchain reference and split intent. The requested raw account address must
belong to that shard prefix.

Membership is proven by a local, proof-aware traversal of canonical
`HashmapAugE 256 ShardAccount DepthBalanceInfo`. A pruned branch on the requested
path is not evidence. Unrelated pruned siblings are allowed. The authenticated
entry fixes the account root hash, last transaction hash and last transaction
LT. The separately supplied account root must match that hash, embed the exact
requested address and matching storage LT, and be active with code and data.

## Security boundary

A successful artifact sets `shardStateProofVerified`,
`accountDictionaryInclusionVerified` and `accountStateProofVerified` true. It
fixes `transactionInclusionVerified: false`, `authorizationAllowed: false` and
`verificationEvidenceHash: null`.

This proves the state, code and data of one active account at one finalized
shard block. It does not prove Jetton semantics, execute `get_wallet_address`,
prove a transaction in `ShardAccountBlocks`, create seal evidence or authorize
settlement.

The verifier rejects block/state-root substitution, every shard-state identity
field drift, an address outside the shard prefix, proven absence, pruning on the
requested path, account-root or embedded-address substitution, last-transaction
LT disagreement, inactive or code/data-less accounts, malformed state cells and
resource-limit violations.

## Evidence and tests

The typed artifact records network/block/account identity, both proof hashes,
the shard-state and account-state hashes, last transaction identity, balance,
code/data hashes and the proven account/code/data cells needed by a later local
TVM runner. It never contains an authorization commitment.

Twenty-six focused account tests plus twenty-eight envelope tests cover the
positive path, canonical two-root framing, unreachable cells, root and metadata
substitution, shard-prefix exclusion, absent/pruned dictionary paths, a complete
fork with an unrelated pruned sibling, account identity/LT/state failures,
trailing bytes, resource limits and provenance failure. Fixtures are synthetic;
captured mainnet/testnet replay remains mandatory before Phase 1 exit.

## Operations and rollback

The module is pure and unwired. Telemetry may record bounded rejection reasons
and content hashes, but must not label account inclusion as wallet canonicality
or settlement authorization. Rollback removes the module, the corrected
account-proof envelope semantics and this ADR. Adapter readiness and all
real-funds flags remain disabled.

## Next gate

Apply the same primitive to the proven Jetton master and candidate wallet at
the required finalized blocks. Execute `get_wallet_address(escrow)` locally
against the proven master code/data with a pinned TVM environment, and compare
its exact address result to the proven wallet. Separately prove required
transactions through the shard block's `ShardAccountBlocks` dictionary.
