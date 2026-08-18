# Polygon Amoy smart-contract acceptance report

## Decision

- Result: `PENDING`
- Repository commit: `PENDING`
- Chain ID: `80002`
- Deployment manifest: `.local-e2e/amoy-deployment.json`
- Independent verification: `.local-e2e/amoy-deployment-verification.json`
- Runtime acceptance evidence: `.local-e2e/amoy-acceptance-report.json`

## Preflight evidence

- [ ] Deployer address is `0x97C2DdF6D747b9188e20578f06174D68db732a22`.
- [ ] Relay/Web3Signer address is `0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf`.
- [ ] Web3Signer is bound only to loopback/private networking and `/healthcheck` is `UP`.
- [ ] `eth_accounts` exposes exactly the configured relay.
- [ ] An unbroadcast EIP-1559 transaction decodes to chain `80002`, the expected sender, and low-`s`.
- [ ] Pending/latest nonces have no unexplained gap.
- [ ] Live fee budget satisfies the measured gas requirement and protected reserves.
- [ ] `MONEY_EGRESS_ENABLED=false` blocks backend writes before the explicit acceptance window.

## Local quality gates

- [ ] Contracts compile and Solhint passes.
- [ ] All contract tests pass.
- [ ] Contract coverage gate is at least 90% statements and lines.
- [ ] Backend builds and the full regression suite passes.
- [ ] Production dependency audits report no known vulnerabilities.
- [ ] Secret scan and `git diff --check` pass.

## Deployment verification

- [ ] Six planned contracts contain runtime bytecode; addresses, sizes, and hashes are recorded.
- [ ] TestUSDT has six decimals and relay balance is exactly 10 test USDT before acceptance.
- [ ] Governance ownership and all admin/factory/registry/relay roles match the least-privilege plan.
- [ ] Deployer holds no contract admin or relay role.
- [ ] Token, treasury, registry, implementation, relay, fee, fine, and stake configuration match the manifest.
- [ ] Implementation singleton is locked.

## Transaction evidence

| Operation | Hash | Block | Gas used | Fee POL | Sender | Low-s |
|---|---|---:|---:|---:|---|---|
| Deploy/mint/role transactions | `from deployment manifest` | | | | deployer | |
| Happy createEscrow | | | | | relay | |
| Happy TestUSDT transfer | | | | | relay | |
| Happy notifyFunded | | | | | relay | |
| Happy release | | | | | deployer/buyer | |
| Recovery createEscrow | | | | | relay | |
| Recovery TestUSDT transfer | | | | | relay | |
| Recovery notifyFunded | | | | | relay | |

## Invariants

- [ ] Each deal amount is 3.3 USDT; required relay float is 3.575 USDT.
- [ ] Happy-path seller receives 3.025 USDT and Treasury receives 0.55 USDT.
- [ ] Happy escrow ends `RELEASED` with zero token balance.
- [ ] Recovery injection stops after exactly one transfer.
- [ ] Recovery sends only `notifyFunded`; it does not transfer again.
- [ ] A further replay is a complete no-op.
- [ ] Relay spends exactly 7.15 test USDT across two deals and retains 2.85 test USDT.
- [ ] All submitted transactions have successful receipts, expected senders, chain ID 80002, and low-`s` signatures.

## Residual observations

- Static analyzers unavailable locally: `Slither`, `Semgrep`, and `Mythril`; record this as a limitation rather than claiming those gates passed.
- Jest currently needs `--forceExit`; investigate open handles separately. This is a tooling/process warning if all assertions pass.
- Explorer source verification is a separate gate and requires deployed addresses plus an explorer API key.

## Final disposition

`GO` requires every required checkbox above, no unexplained transaction/nonce, and all three JSON evidence files reporting `PASS`. Otherwise record `NO-GO` with the exact failed assertion.
