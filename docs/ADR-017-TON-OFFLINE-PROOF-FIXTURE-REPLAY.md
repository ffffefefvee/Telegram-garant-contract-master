# ADR-017: TON offline proof-fixture replay

Date: 2026-08-20

## Status

Accepted as a pure, fail-closed Phase 1 evidence gate. The replay is unwired,
uses no provider or network client, and cannot authorize a seal, settlement or
contract message.

## Invariant

A captured fixture is replayable only when its manifest has the exact schema,
pinned network/global ID/official configuration URL/zerostate, canonical
identities and exact artifact inventory. Every artifact's byte count and
SHA-256 hash must match before any proof parser runs.

Successful offline replay then re-executes the full local path from the trusted
key block to the captured masterchain target, independently parses the target
header, authenticates the captured ShardHashes supplement by the pruned state
commitment, proves both account states, executes `get_wallet_address` locally,
composes the canonical wallet, and proves one shard transaction. The output
records `providersUsed: false`, `networkAccessUsed: false` and
`authorizationAllowed: false`.

## Threat-model change

An artifact directory is attacker-controlled even if it was created by the
capture tool. Strict revalidation prevents path/inventory substitution,
network or zerostate drift, unknown-field smuggling, truncation, artifact
replacement and post-capture mutation. A separately transported full
ShardHashes dictionary is accepted only when its root hash equals the branch
committed by the finalized masterchain state proof.

This does not establish that a corpus has actually been captured from both
networks or independently reviewed. Mocked orchestration tests prove wiring;
only successful replay of immutable real mainnet and testnet fixtures satisfies
the network-compatibility gate.

## Implementation and tests

- `ton-proof-fixture-manifest.ts` validates the schema, resource bounds,
  network trust anchors, exact 18-artifact set and content commitments.
- `ton-proof-fixture-replay.ts` composes existing proof-kernel primitives and
  the pinned TVM executor without importing a LiteServer client.
- `scripts/replay-ton-proof-fixture.ts` reads a local fixture directory and
  prints only the replay result.
- `ton-shard-descriptor-proof.ts` can bind a separately transported complete
  ShardHashes dictionary to the state proof's pruned commitment.

Tests flip one bit in each of the 18 artifact classes, reject missing/extra
files, malformed schemas, identity and resource drift, verify supplemental
dictionary hash binding, exercise the complete replay orchestration, and prove
that artifact corruption fails before a proof parser is invoked.

## Migration, rollback and observability

There is no database or production wire migration. Rollback is removal of this
ADR, the two pure modules, CLI and supplemental dictionary branch. Retain the
manifest hash, artifact-set hash, checkpoint evidence, wallet composition,
transaction hash and replay-evidence hash for independent review. Adapter
readiness remains hard false.

## Exit evidence still required

Capture and commit immutable mainnet and testnet corpora, replay both with
network access disabled, run cryptographic per-layer corruption vectors beyond
the manifest hash boundary, pin independent proof/TVM review commitments, and
obtain threshold policy approval. No captured or replayed artifact alone may
enable production wiring.
