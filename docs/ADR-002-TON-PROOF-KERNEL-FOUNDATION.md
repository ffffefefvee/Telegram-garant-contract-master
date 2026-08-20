# ADR-002: TON proof-kernel foundation

Status: Accepted for Phase 1 foundation; authorization remains disabled.

## Decision

Phase 1 starts with a pure, fail-closed envelope validator. It accepts an immutable trusted-network policy and a raw proof bundle, applies strict schema, identity, freshness, base64, BOC boundary, cell-count, depth, exotic-root, and root-commitment checks, and produces only a domain-separated structural audit hash.

The result type cannot represent success: `accepted`, `proofsVerified`, and `authorizationAllowed` are literal `false`, while `verificationEvidenceHash` is literal `null`. A well-formed envelope returns `CRYPTOGRAPHIC_VERIFICATION_REQUIRED`. No adapter, signer, broadcaster, sealing composer, or settlement path consumes this result.

This is an input-safety boundary, not a TON proof verifier.

## Trusted configuration and bundle contract

The trusted policy binds:

- policy version, network, and TON global ID (`-239` mainnet or `-3` testnet);
- zero-state and trusted key-block extended identities;
- maximum observation age and future clock skew;
- maximum decoded bytes, declared cells, and parsed cell depth per proof BOC.

The bundle binds a target masterchain extended block ID and raw single-root Merkle-proof BOCs for the masterchain block, shard descriptor, shard block, Jetton master account, and Jetton wallet account. Exact-key validation rejects caller-supplied trust or verification booleans. The masterchain proof's embedded virtual root must equal the target block root hash.

## Security invariant

No structurally validated input can authorize money movement. Only a later kernel that verifies the full cryptographic chain may create a separately domain-separated `verificationEvidenceHash`. The existing structural hash is for audit, replay comparison, and deduplication only and must never be copied into an on-chain seal message.

## Threat model and rejected inputs

The boundary assumes every provider response and every bundle field is attacker controlled. It rejects malformed or non-canonical base64, unsupported BOC flags, unsafe integer widths, size arithmetic overflow, incomplete or trailing bytes, CRC corruption, multiple or absent roots, declared absent cells, excessive bytes/cells/depth, and non-Merkle-proof roots. It also rejects wrong network/global ID, non-masterchain anchors and targets, zero or non-canonical hashes, stale/future observations, and targets that do not advance the trusted key block.

These checks do not establish validator signatures, key-block transitions, masterchain finality, shard-descriptor inclusion, shard-prefix correctness, shard-block validity, account or transaction inclusion, Jetton master/wallet identity, or local TVM getter execution.

## Evidence and observability

Callers may log the reason code, policy version, network, target block ID, resource-limit rejection category, and structural audit hash. Raw proofs may contain operationally sensitive metadata and should be retained only in an immutable, access-controlled evidence store with content hashes. Metrics must distinguish malformed input, stale input, resource-limit rejection, and cryptographic-verification-required outcomes. None is a successful authorization metric.

## Rollback

The foundation has no production wiring and no database migration. Rollback is removal of the module and ADR. If any consumer is later added, rollback must first disable that consumer and preserve evidence needed for incident review. TON adapter readiness and all real-funds feature flags remain disabled throughout Phase 1.

## Next gates

Subsequent changes must independently implement and test:

1. trusted masterchain checkpoint advancement with validator-set and signature verification;
2. masterchain block and shard-descriptor proof validation, including split/merge and prefix rules;
3. shard-block, account-state, and transaction inclusion proofs;
4. deterministic local `get_wallet_address` execution over proven Jetton master state;
5. a separate verification-evidence commitment and offline replay corpus for mainnet and testnet.

Only the complete verified result may be considered by a separately reviewed threshold-approval workflow. Production wiring remains a later gated phase.
