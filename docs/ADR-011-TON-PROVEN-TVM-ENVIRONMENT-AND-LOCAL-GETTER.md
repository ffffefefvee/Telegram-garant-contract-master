# ADR-011: Proven TVM environment and local canonical-wallet getter

Date: 2026-08-20

Status: accepted as an isolated Phase 1 proof-kernel slice; not authorized for production

## Decision

Canonical Jetton-wallet derivation must execute `get_wallet_address` locally
against the code and data of a proven active Jetton-master account. The TVM
configuration must come from the same finalized masterchain target that
authenticated that account's shard block. A provider-reported exit code or
getter stack is never an input to this decision.

The backend therefore pins direct runtime dependencies on `@ton/core` 0.63.1,
`@ton/sandbox` 0.40.0 and its required `@ton-community/func-js` 0.10.0 peer.

## Protected invariant and threat-model change

Before this slice, two providers could agree on a forged getter result, or a
caller could combine a proven account from one finalized block with emulator
configuration from another. Neither case can now satisfy the local component:

- every proven shard-block and account artifact retains the exact finalized
  masterchain block that authenticated it;
- the masterchain state Merkle proof is bound to that finalized header's
  `newStateHash` and complete `ShardStateUnsplit` identity;
- `McStateExtra.config` is extracted from the proven state and every reachable
  configuration cell must be ordinary and present, with no pruned subtree;
- account and environment network/anchor identities must match exactly;
- master account, code, data and configuration cells are re-hashed immediately
  before execution;
- the owner is encoded as one canonical address slice, the method ID is derived
  locally, exit code must be exactly zero, and the result must be exactly one
  address with no trailing stack item;
- a missing global library fails closed. The verifier does not reinterpret the
  masterchain state's library dictionary as `VmLibraries`;
- execution uses the proven masterchain state's generation time, a
  domain-derived deterministic random seed and a bounded gas limit.

The sandbox get-method interface does not accept an explicit logical-time
argument. The proven state logical time is retained for evidence, but Phase 1
cannot close until captured mainnet/testnet replay demonstrates that this
executor policy reproduces canonical Jetton-master behavior and an independent
review accepts the fixed C7 semantics.

## Authorization boundary

A successful run emits `localGetterExecutionVerified: true` and
`canonicalWalletAddressVerified: true`, plus a domain-separated transcript hash
for audit. It still fixes `authorizationAllowed: false` and
`verificationEvidenceHash: null`.

The transcript hash is not the contract seal commitment. The final
`verificationEvidenceHash` requires the proven wallet account checks,
transaction-proof work needed by reconciliation, the frozen evidence schema,
captured network fixtures and threshold-approved seal workflow.

No adapter, signer, message composer or broadcaster imports these modules.

## Verification

The proof-kernel tests cover:

- a complete authenticated sandbox configuration dictionary;
- detached state proofs and checkpoint targets;
- network, block, time, logical-time, reference and split-state drift;
- pruned configuration cells, zero configuration address and resource limits;
- real local WASM execution of a deterministic Jetton-master-style getter;
- deterministic replay, wrong candidate/master/anchor, code/config commitment
  drift, malformed addresses, invalid gas policy and gas exhaustion;
- forged provenance and preservation of the non-authorizing result boundary.

The fixture executes the real sandbox emulator but uses a synthetic contract
and state. Captured liteserver proof vectors remain a Phase 1 exit requirement.

## Migration, rollback and observability

There is no database, ABI or production-composition migration. Rollback is a
revert of this isolated commit and its three dependency pins. Until production
wiring is separately approved, observability consists of deterministic test
artifacts and hashes; VM logs are neither trusted nor persisted as evidence.

The exact evidence required to advance is an offline-replayable mainnet and
testnet corpus, bit-corruption/adversarial outcomes, executor version and
policy approval, complete wallet-account proof composition, the final evidence
commitment schema, threshold approval tests, hosted CI and independent review.
