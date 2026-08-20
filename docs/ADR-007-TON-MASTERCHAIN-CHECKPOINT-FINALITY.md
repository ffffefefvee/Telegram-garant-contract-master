# ADR-007: TON masterchain checkpoint-chain finality

Status: Accepted for complete forward-only ordinary-consensus chains from a trusted key block; downstream proof and authorization gates remain required.

## Decision

The proof kernel now composes strict raw LiteServer `partialBlockProof` decoding with the authenticated forward-link verifier. A successful chain must:

- declare `complete: true` and contain one to sixteen links;
- begin at the exact configured trusted masterchain key `BlockIdExt`;
- end at the exact policy-selected target `BlockIdExt`;
- contain only contiguous forward links;
- authenticate and verify every source configuration, destination header, derived validator set and ordinary signature threshold;
- end every non-final link at a proven key block so the next validator configuration has an authenticated source;
- satisfy independent observation-time and target-block freshness/future-skew limits.

The intended trust anchor is always a key block. TON's LiteServer constructs a newer-target path from such an anchor through forward links to successive key blocks and finally to the requested target. Backward links are therefore rejected explicitly in this policy instead of being accepted without their distinct source-state and `OldMcBlocksInfo` proofs.

## Security invariant

Only the complete chain artifact may set `masterchainFinalityProven: true` and `finalityProven: true`. Its individual link artifacts remain `finalityProven: false`. The chain result also fixes `authorizationAllowed: false` and `verificationEvidenceHash: null`: masterchain finality alone does not prove shard-descriptor inclusion, shard-block identity, account/transaction inclusion, Jetton master behavior or a locally executed wallet address.

The verifier is pure and unwired. No seal, reconciliation, signer, broadcaster, durable event application, money-egress flag or adapter-readiness path imports it.

## Evidence commitment

`checkpointEvidenceHash` is SHA-256 over a domain-separated canonical object containing the verifier policy, trusted and target block IDs, observation time, raw TL proof hash, every proof-root/config-root hash, selected config parameters, catchain and validator-set identities, and signed/total weights. It is an audit and deduplication commitment only. It is deliberately distinct from the future contract-ready `verificationEvidenceHash`.

## Threat-model change

This slice closes omission, truncation, endpoint substitution and isolated-link replay across the ordinary masterchain checkpoint path. It rejects incomplete responses, empty or over-cap chains, non-forward paths, non-key intermediate destinations, stale/future observations and targets, and any failure inherited from strict TL/BOC/config/header/validator/signature verification.

The following remain authorization-blocking:

- Simplex consensus signature-set support or a proven applicability transition policy;
- captured mainnet/testnet LiteServer chains and offline replay;
- bit-flip and resource-exhaustion fixtures across complete real chains;
- masterchain-state shard-descriptor inclusion;
- shard-block, account and transaction dictionary proofs;
- proven Jetton master state and local `get_wallet_address` execution;
- domain-separated seal/settlement verification evidence and threshold approval.

## Tests and evidence

Eight focused tests cover a positive two-link chain with validator rotation, deterministic evidence, incomplete responses, trusted-origin and target drift, backward-link rejection, non-key intermediate rejection, stale/future policy, and malformed policy rejection.

The synthetic fixtures prove invariants, not network compatibility. Real captured vectors and independent replay remain mandatory before the Phase 1 exit gate.

## Observability and rollback

Telemetry may record the checkpoint evidence hash, endpoints, link count, latest proven key block, target time and bounded reason categories. It must distinguish `masterchainFinalityProven` from end-to-end wallet or settlement authorization. Rollback removes the pure module and this ADR. Production readiness and all real-funds flags remain disabled.

## Next gate

Authenticate the target masterchain state's `ShardHashes` dictionary, select the exact workchain/shard descriptor under split/merge prefix rules, and bind its top-block root/file hashes to a strict shard-block proof. No detached shard block or account cell may be accepted.
