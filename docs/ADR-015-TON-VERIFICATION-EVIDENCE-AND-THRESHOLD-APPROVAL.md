# ADR-015: TON verification evidence and threshold approval

Date: 2026-08-20

## Status

Accepted as a pure, unwired Phase 1 authorization boundary. It does not enable
the TON adapter, hold private keys, sign messages, persist production evidence,
or broadcast contract calls.

## Invariant

`structuralEvidenceHash`, proof-composition hashes, and provider agreement are
never valid money-moving commitments. A wallet seal or settlement
reconciliation can be authorized only when:

1. the complete local proof composition is re-run;
2. its result is committed under a domain-separated verification policy;
3. the policy binds the TON network, trusted-network configuration, minimum
   masterchain sequence, captured-fixture manifest and independent review;
4. a distinct immutable Ed25519 authority reaches its configured threshold;
5. every signature covers the exact scope, network, subject, verification hash
   and approval-policy hash.

Wallet-seal and settlement approvals use different scopes and cannot be
replayed across one another.

## Threat-model change

Previously the proof kernel deliberately emitted no `verificationEvidenceHash`
and could not express authorization. This change adds a narrow capability
artifact after proof success and threshold approval. It closes substitution of
the network, proof composition, policy, signer set, threshold, subject and
operation scope. Duplicate, disabled, unknown, malformed and invalid
signatures fail closed.

This does not solve key custody, production policy distribution, WORM storage,
fixture capture, executor review, or broadcasting. Those remain separate
gates. The low-level commitment primitive is internal plumbing; production
callers must use the seal or settlement wrappers, which re-run the respective
proof composition before committing evidence.

## Implementation

- `ton-verification-evidence.ts` defines strict policy, commitment, signing
  payload and Ed25519 threshold-verification primitives.
- `ton-wallet-seal-verification-evidence.ts` re-runs canonical-wallet proof
  composition before producing wallet-seal evidence.
- `ton-settlement-verification-evidence.ts` re-runs finalized three-transaction
  reconciliation before producing settlement evidence.
- Unapproved evidence fixes all authorization flags false and carries
  `THRESHOLD_APPROVAL_REQUIRED`.
- Approved evidence removes that marker, records sorted verified signers and
  produces a separate approval-artifact hash.

The evidence policy itself is re-supplied and rehashed during signature
verification. An approval policy cannot merely assert the hash of an evidence
policy that was never validated.

## Tests

Focused tests cover deterministic/domain-separated commitments, network and
masterchain floors, zero fixture/review commitments, successful 2-of-3
approval, scope-specific authorization, insufficient and duplicate signatures,
evidence corruption, network/scope replay, unsorted or under-provisioned signer
sets, forged provenance, and proof re-composition in both wrappers.

## Migration and rollback

There is no database or wire-format migration and no production import. Roll
back by reverting this ADR and its three pure modules/tests. Existing proof
artifacts remain non-authorizing.

## Observability and enablement evidence

Before any production composition may consume an approved artifact, operations
must record the verification hash, approval-artifact hash, policy IDs/hashes,
network, masterchain anchor, scope, subject and signer IDs in append-only/WORM
storage. Raw proofs must be retrievable by their committed hashes.

Enablement still requires captured mainnet and testnet offline-replay fixtures,
the one-bit corruption matrix, independent executor/proof-policy review,
production threshold public keys and custody procedures, and an audited
composer that maps only a scope-correct approved artifact to the exact contract
message. Adapter readiness remains hard false.
