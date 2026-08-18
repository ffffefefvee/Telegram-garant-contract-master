# Native TON escrow

This package contains isolated per-deal TON escrows. `TonNativeEscrow` provides
the native-TON lifecycle. `TonJettonEscrow` currently provides only the first
funding-authentication slice for an allowlisted Jetton; it is not a complete or
deployable real-funds lifecycle. Polygon remains a separate settlement option;
this package does not bridge, swap, or share custody with the Polygon contract.

The implementation follows `docs/ADR-001-NATIVE-TON-ESCROW.md`. Tolk source is
the contract authority. Blueprint and TON Sandbox provide a Windows-compatible
local loop. Acton 1.1.0 is pinned in `Acton.toml` for the authoritative Linux
build, format, lint, deterministic fuzz, gas-regression and mutation gates. CI
independently decodes the Acton and Blueprint BOCs, verifies their declared
hashes, requires exact code-cell hash agreement and emits an unsigned release
candidate. Two-person signing and the remaining release ceremony are still
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
100% for both the complete native contract and the funding-only Jetton contract.
That test score does not replace an external review or make the incomplete
Jetton lifecycle releasable. The generated Acton wrappers, dependency cache
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

A separately controlled deployment preparation step must re-run that
cryptographic verification instead of trusting the evidence JSON alone:

```text
npm run release:authorize-deployment -- <candidate> <approval> <policy> <signatures> <deployment-record> <output>
```

It binds the exact candidate, policy, threshold, signer set, source revision,
code hash and target-network record into a normalized deployment input. It has
no signing, broadcasting or deployment capability.
