# ADR-014: Finalized Jetton reconciliation composition

Date: 2026-08-20

Status: accepted as an isolated Phase 1 composition slice; not authorized for production

## Decision

The raw-evidence Jetton reconciliation result may establish structural agreement
without finality, while a transaction proof establishes inclusion without the
TEP-74 payout semantics. A new pure composer must require both before it may
state that reconciliation finality is proven.

The composer binds the structural owner, sender-wallet and recipient-wallet
transactions—in that exact order—to three finalized transaction artifacts. All
three artifacts must use one network and one exact finalized masterchain anchor.

## Protected invariant and threat-model change

The composition rejects:

- a structural result that did not pass every raw transaction/message/state
  check and stop specifically at `MASTERCHAIN_PROOF_REQUIRED`;
- settlement, leg, attempt, amount, query, wallet or owner-transaction drift;
- missing/extra transaction, state or block evidence;
- forged inclusion provenance or a component that already claims authorization;
- account, transaction hash, LT or transaction-cell drift;
- structural block metadata that differs from the proven workchain, uint64 shard
  prefix, sequence, root hash, file hash or finalizing masterchain sequence;
- transaction proofs from different networks or finalized masterchain anchors;
- sender/recipient pre/post account hashes that differ from the included
  transactions' state-update commitments.

The domain-separated composition hash includes the complete economic/identity
context, structural agreement fingerprint, finalized anchor and every shard
block, transaction BOC, inclusion proof and state-update commitment.

## Authorization boundary

The result may set `reconciliationFinalityProven: true`, because every structural
transaction and state update is now cryptographically anchored. It still fixes
`settlementAuthorized: false`, `authorizationAllowed: false` and
`verificationEvidenceHash: null`, with the explicit remaining requirement
`VERIFICATION_EVIDENCE_POLICY_REQUIRED`.

The `finalityCompositionHash` is audit-only and must not be accepted by a
contract or durable settlement worker as authorization. The module is pure and
referenced only by its tests; the existing reconciler and production wiring are
unchanged.

## Verification

Twenty-one focused tests cover positive/deterministic composition, structural
provenance, expectation and cardinality drift, forged proof flags, account/hash/
LT/cell substitution, block identity drift, malformed fingerprints, cross-anchor
and cross-network proofs, every sender/recipient state substitution, and invalid
agreement evidence.

All proof artifacts remain synthetic. Captured mainnet/testnet offline replay,
one-bit corruption vectors and independent review remain Phase 1 exit evidence.

## Migration, rollback and observability

There is no database, API, adapter, signing, broadcast or money-moving migration.
Rollback is a single commit revert. The result exposes deterministic structural,
proof and finality-composition hashes for later immutable evidence persistence,
but emits no event and mutates no state.

Enablement requires the final domain-separated verification-evidence schema,
captured network fixtures, independent proof review, immutable persistence and a
separately controlled threshold authorization workflow.
