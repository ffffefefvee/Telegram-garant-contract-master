# TON escrow contracts

This package contains isolated per-deal TON escrows. `TonNativeEscrow` provides
the native-TON lifecycle. `TonJettonEscrow` provides the complete on-chain
Jetton lifecycle after two-phase canonical-wallet sealing: delivery, release,
refunds, timeouts, disputes, resolution, proof-gated reconciliation,
failed-leg-only retry and explicit finalization. StateInit commits the master
and wallet-code hash without precommitting the owner wallet; a distinct
initializer must later seal independently verified canonical-wallet evidence
before funding is possible. This is not approval for real-funds deployment:
the proof, durable integration, testnet, audit and operational gates remain.
Polygon remains a separate settlement option;
this package does not bridge, swap, or share custody with the Polygon contract.

The implementation follows `docs/ADR-001-NATIVE-TON-ESCROW.md`. Tolk source is
the contract authority. Blueprint and TON Sandbox provide a Windows-compatible
local loop. Acton 1.1.0 is pinned in `Acton.toml` for the authoritative Linux
build, format, lint, deterministic fuzz, gas-regression and mutation gates. CI
independently decodes the Acton and Blueprint BOCs for both contracts, verifies
their declared hashes and requires exact code-cell hash agreement. Native TON
emits an unsigned release candidate; Jetton emits non-authorizing verification
evidence. Two-person signing and the remaining release ceremony are still
required before promotion.

## Commands

```text
npm install
npm run build
npm test
npm run typecheck
```

The authoritative Acton assurance commands are:

```text
acton build
acton wrapper TonNativeEscrow -o wrappers-acton/TonNativeEscrow.gen.tolk
acton wrapper TonJettonEscrow -o wrappers-acton/TonJettonEscrow.gen.tolk
acton fmt --check
acton check --output-format github
acton test tests-acton --baseline-snapshot tests-acton/gas-baseline.json --fail-on-diff
acton test tests-acton --mutate --mutate-contract TonNativeEscrow --mutation-levels critical,major --mutation-minimum-percent 100 --mutation-workers 2
acton test tests-acton --mutate --mutate-contract TonJettonEscrow --mutation-levels critical,major --mutation-minimum-percent 100 --mutation-workers 2
```

The shared gas baseline is committed. Critical/major mutation gating requires
100% for both complete contract state machines. That test score does not
replace proof verification, testnet drills or external review and does not make
Jetton releasable. The initializer is a money-critical authority:
the contract cannot independently execute the master getter, so the release
workflow must verify the wallet address, owner, master and pinned code hash
from finalized independent evidence before threshold approval and sealing.
The generated Acton wrappers, dependency cache
and build outputs are intentionally ignored.

Generated build artifacts are intentionally ignored. `npm run build` records
the code-cell hash and a separate SHA-256 of the BOC. A release process must
publish those values, compiler versions, source commit, and reproducible-build
evidence together. Never copy a local development artifact into a production
release manifest.

`npm run release:verify-cross-build` is intended for CI after both artifacts
have been downloaded. Its output is explicitly an unsigned candidate, not an
approval or deployment authorization. After independent officers have signed
the domain-separated candidate digest, verify the bundle with:

```text
npm run release:verify-approval -- <candidate> <policy> <signatures> <output>
```

The verifier requires at least two distinct enabled Ed25519 signers and writes
approval evidence; it never signs or deploys. See
`docs/TON_RELEASE_CEREMONY.md`.

`npm run release:verify-jetton-cross-build` independently checks the Jetton
Acton and Blueprint BOCs. Its manifest fixes `authorizationAllowed: false` and
is reproducibility evidence only; it cannot be promoted through the native
release-approval scripts.

A separately controlled deployment preparation step must re-run that
cryptographic verification instead of trusting the evidence JSON alone:

```text
npm run release:authorize-deployment -- <candidate> <approval> <policy> <signatures> <deployment-record> <output>
```

It binds the exact candidate, policy, threshold, signer set, source revision,
code hash and target-network record into a normalized deployment input. It has
no signing, broadcasting or deployment capability.
