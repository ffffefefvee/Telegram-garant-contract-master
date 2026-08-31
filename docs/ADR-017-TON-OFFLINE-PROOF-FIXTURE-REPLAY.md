# ADR-017: TON offline proof-fixture replay

Date: 2026-08-20

## Status

Accepted as a pure, fail-closed Phase 1 evidence gate. The replay is unwired,
uses no provider or network client, and cannot authorize a seal, settlement or
contract message.

## Invariant

A captured fixture is replayable only when its manifest has the exact schema,
pinned network/global ID/official configuration URL/zerostate, canonical
identities and exact 13-artifact inventory. Every artifact's byte count and
SHA-256 hash must match before any proof parser runs.

Successful offline replay then re-executes the full local path from the trusted
key block to the captured masterchain target, independently parses the target
header, authenticates the captured ShardHashes supplement by the pruned state
commitment, proves both account states, executes `get_wallet_address` locally,
composes the canonical wallet, and proves one shard transaction. The output
records `providersUsed: false`, `networkAccessUsed: false` and
`authorizationAllowed: false`.

The fixture pins an explicit wallet contract profile. Mainnet covers the
governance-wallet layout used by the canonical TON stablecoin implementation;
testnet covers a TEP-74 wallet whose active code is a library reference. For a
historical target, the checkpoint verifier accepts only the canonical TON form
that first authenticates a newer key block with validator signatures and then
uses that authenticated key block's state `prev_blocks` dictionary to prove the
exact older `BlockIdExt`. A backward link is allowed only as the final link and
does not independently claim finality.

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
  network trust anchors, exact 13-artifact set and content commitments.
- `ton-proof-fixture-replay.ts` composes existing proof-kernel primitives and
  the pinned TVM executor without importing a LiteServer client.
- `scripts/replay-ton-proof-fixture.ts` reads a local fixture directory and
  prints only the replay result.
- `ton-proof-fixture-corruption-matrix.ts` flips one deterministic bit in each
  artifact, rehashes the attacker-controlled manifest, and requires the full
  replay to reject every mutation; the matching CLI runs this against a local
  corpus.
- `ton-shard-descriptor-proof.ts` can bind a separately transported complete
  ShardHashes dictionary to the state proof's pruned commitment.
- `npm run fixture:ton:gate` replays and corrupts both immutable corpora, and is
  a blocking user-service CI step.

Tests flip one bit in each of the 13 artifact classes at the manifest boundary,
reject missing/extra files, malformed schemas, identity and resource drift,
verify supplemental dictionary hash binding, exercise the complete replay
orchestration, and require rejection even after every mutated artifact
descriptor is rehashed. The real-corpus matrix remains an exit command, not a
substitute for captured network evidence.

## Migration, rollback and observability

There is no database or production wire migration. Rollback is removal of this
ADR, the two pure modules, CLI and supplemental dictionary branch. Retain the
manifest hash, artifact-set hash, checkpoint evidence, wallet composition,
transaction hash and replay-evidence hash for independent review. Adapter
readiness remains hard false.

## Captured exit evidence

The committed mainnet corpus targets masterchain sequence `89774814`. Its
manifest hash is `ebc8b22cda058364d043e63e4dd1e8b64ea65819d999e15a398d19c85abdeeb1`,
artifact-set hash is `9e52cb3af39d8b6a6dc774ba3682c9f24b11172c3ef0e8a0217fab3bd67c41fc`,
offline replay hash is `b735ea00f7f5f752fb438f6918b465f7074bb33e405470ac4f2c587e8baf7687`,
and 13-case corruption-matrix hash is
`f451947729905608e3230562fe20615f153b1f3f85c50042e071d4a679032c80`.

The committed testnet corpus targets masterchain sequence `81805570`. Its
manifest hash is `e3f4ce468bb146bd11ccda20335f55e9be91e1e3fc201ab02945fc5dea0b30fe`,
artifact-set hash is `91c01e71b6090413eb577bf7d36da54a254df498fb386900874cba49cca2f1a0`,
offline replay hash is `86111377da83d0f7276d5528d9ef7645f1246ce32bce7f0031edaac7559dcf50`,
and 13-case corruption-matrix hash is
`b8ffae5a15e3601999d6d5fcb7a90592771f1fd827454f615e5dd57105bb6112`.

Both runs report no provider or network use and `authorizationAllowed: false`.
Independent proof/TVM review commitments and threshold policy approval remain
required before production wiring. No captured or replayed artifact alone may
enable production wiring.
