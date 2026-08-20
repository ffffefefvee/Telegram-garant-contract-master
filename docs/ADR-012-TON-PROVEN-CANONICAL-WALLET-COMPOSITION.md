# ADR-012: Proven canonical Jetton-wallet composition

Date: 2026-08-20

Status: accepted as an isolated Phase 1 proof-kernel slice; not authorized for production

## Decision

The local `get_wallet_address(escrow)` result is insufficient by itself. It must
be composed with a separately proven active account for the derived wallet at
the same finalized masterchain anchor. The wallet data is decoded locally and
must bind the escrow owner, allowlisted Jetton master, active code and embedded
wallet code to the immutable seal expectation.

## Protected invariant and threat-model change

The composition rejects:

- a local getter result and wallet proof from different networks or finalized
  masterchain targets;
- a substituted owner, master, derived candidate or proven account address;
- forged proof/getter provenance or an authorization-capable component result;
- code, data or account cells that no longer match their proven hashes;
- exotic active code/data or embedded code hidden by pruning;
- an active wallet code hash different from the immutable pinned hash;
- wallet data with a different owner/master, a different embedded code hash,
  malformed values or trailing fields.

The exact TEP-74 wallet data decoded is the Jetton balance, owner address,
Jetton-master address and embedded wallet-code reference. Both active and
embedded code hashes must equal the pinned expectation.

## Authorization boundary

A successful composition exposes positive component facts, including
`sealPreconditionsVerified: true`, but fixes `sealingAuthorized: false`,
`authorizationAllowed: false` and `verificationEvidenceHash: null`.

Its domain-separated `proofCompositionHash` is audit-only. It is not the
contract seal commitment and must never be supplied to
`SealCanonicalJettonWallet`. Captured network fixtures, executor-policy review,
the final evidence schema and threshold initializer approval remain mandatory.

The module is pure, is referenced only by its tests, and is not imported by an
adapter, signer, message composer, broadcaster or durable ingestion service.

## Verification

Nineteen focused tests cover positive deterministic composition, every identity
binding, network/anchor separation, active and embedded code substitutions,
owner/master substitutions, trailing wallet data, pruned cells, proof-cell hash
drift, malformed pinned hashes and forged provenance.

The tests use synthetic proven artifacts. Mainnet and testnet offline replay
remain Phase 1 exit evidence.

## Migration, rollback and observability

There is no database, ABI, configuration or production-composition migration.
Rollback is a single commit revert. The output includes only deterministic
account/code/data/getter/composition hashes for future evidence persistence;
no operational event or money-moving action is emitted.

Enablement requires captured mainnet/testnet liteserver bundles, the complete
bit-corruption matrix, independent proof/executor review, a frozen
domain-separated `verificationEvidenceHash`, immutable evidence persistence and
threshold-approved seal-message composition.
