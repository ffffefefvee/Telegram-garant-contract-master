# Native TON release ceremony

Date: 2026-08-18

This procedure turns reproducible build evidence into an approved deployment
input. It does not enable the adapter or authorize public funds by itself.

## CI candidate

The TON compatibility job builds `TonNativeEscrow` with pinned Blueprint/Tolk.
The independent Linux job builds the same source with pinned Acton. The
reproducibility job then:

1. downloads both JSON artifacts from their separate jobs;
2. decodes each BOC and requires exactly one root cell;
3. verifies each tool's declared hash against the decoded cell;
4. requires the two code-cell hashes to be identical;
5. hashes the contract sources, `Acton.toml` and lockfile; and
6. emits `TonNativeEscrow.release-candidate.json` with status
   `unsigned_release_candidate` and zero signatures.

Any disagreement fails CI. BOC byte hashes are retained separately because
valid serialization can differ while the executable root-cell hash agrees.

## Approval boundary

An unsigned candidate is never a release manifest. Promotion requires at least
two different authorized release officers, using hardware-backed identities,
to review the exact candidate bytes and sign this UTF-8, domain-separated
payload with Ed25519:

```text
telegram-garant-ton-release-v1\n<policyId>\n<candidateSha256>\n
```

`candidateSha256` is the lowercase SHA-256 of the candidate file's exact
bytes. Any whitespace or serialization change produces a different approval
target. The signers must independently verify:

- green Acton build/test/check/format, Sandbox tests and dependency audit;
- the immutable source revision and candidate source hashes;
- independent audit report and remediation closure;
- expected code hash, reserve and target network;
- testnet economic/recovery drill evidence; and
- multisig resolver, treasury and deployment identities.

Store the unmodified candidate, detached signatures, public-key policy,
hardware-key identities, transparency-log references when supported, audit
report, test report and go/no-go record as one immutable release bundle. Run:

```text
npm run release:verify-approval -- <candidate> <policy> <signatures> <output>
```

The verifier requires a schema-v1 policy with a threshold of at least two,
distinct enabled signer IDs, Ed25519 public keys, an exact candidate digest and
canonical base64 signatures. It rejects duplicate, disabled, unauthorized,
wrong-policy and below-threshold signatures and writes
`approved_release_evidence`. It has no private-key or deployment capability.
The real hardware identities and signer recovery process must still be selected
and exercised before this gate is operationally complete.

Do not let a deployment process trust `approved_release_evidence` as an
unsigned assertion. Prepare the normalized deployment input with:

```text
npm run release:authorize-deployment -- <candidate> <approval> <policy> <signatures> <deployment-record> <output>
```

This lock makes a private immutable copy of the exact candidate, re-runs the
Ed25519 threshold verification from the original policy and signature bundle,
compares the claimed evidence with the fresh result, and binds the candidate
digest, revision, code hash, policy, threshold, sorted signer set and requested
mainnet/testnet policy to the output. It cannot sign, broadcast or deploy. The
deployment record and output must still be retained in the immutable release
bundle and consumed only by the separately controlled deployment ceremony.

## Deployment and post-deployment verification

1. Deploy only through the approved multisig/threshold ceremony and only to the
   network named in the signed deployment record.
2. Recompute StateInit and the deterministic address for every deal; never
   accept an operator-supplied address in place of derivation.
3. Retrieve deployed code and require its root-cell hash to equal the approved
   manifest hash before allowing a funding request.
4. Run value-capped testnet release, refund, timeout, dispute, resolution,
   provider-outage and backfill drills; reconcile contract state, finalized
   events, ledger and deal FSM.
5. Keep `TonEscrowAdapter.isReady()` false until the security owner records all
   release gates as passed. A deployment transaction alone is not readiness.

Rollback means disabling new intents/funding and following the incident
runbook. An immutable deployed contract is not upgraded or silently replaced;
a corrected version requires a new source revision, code hash, audit, release
bundle and deterministic addresses.
