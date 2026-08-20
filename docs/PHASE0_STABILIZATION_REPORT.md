# Phase 0 stabilization report

Date: 2026-08-20

## Scope and rollback

- Stabilized branch: `agent/multichain-ton-readiness`
- Rollback point before stabilization: `eeda00d9bcd5da4d0b6e99beb55681aac6bb25ff`
- Stabilized baseline: `8d26f32`
- All real-funds and adapter readiness flags remain disabled.

Reviewable implementation commits:

1. `6b28744` — raw Jetton reconciliation v2 and validation documentation.
2. `8b166b0` — two-phase Jetton wallet-sealing contract and Acton tests.
3. `7c38472` — TypeScript ABI, StateInit composer, and sandbox tests.
4. `91eac1a` — fail-closed wallet-seal structural verifier and documentation.

Gate-restoration commits:

- `1f7cce6` — remove two unused imports that broke blocking backend lint.
- `8d26f32` — suppress three reviewed documentation-only gitleaks false positives by exact historical fingerprint.

## Toolchain

- Host Node.js: `24.17.0`; npm: `11.17.0`.
- TypeScript used by `contracts-ton`: `5.9.2`.
- TON compatibility compiler: `@ton/tolk-js 1.4.1` (lockfile-pinned).
- Authoritative TON compiler/test runner: Acton `1.1.0` (`9cf4d1f`, container digest `sha256:b7f187fc6a8ccac23195d3bd7f0d7dee9108a07f7b43bdb928839828dbc539e2`).
- Gitleaks: `8.24.2` (container digest `sha256:b5918eb91b8d2473cec722f066abb4352e4ffdc4ec9f4283ec143aba9ec9ebc4`).
- Local host differs from hosted CI's Node 20 runner; hosted CI remains required before merge.

## Verification evidence

- Backend: blocking ESLint passed; Nest build passed; 73 suites / 642 tests passed.
- TON TypeScript: typecheck and deterministic build passed; 5 suites / 66 tests passed.
- Acton: build, generated-wrapper composition, format check, and contract check passed.
- Acton assurance: 26 tests passed, including 64 deterministic fuzz runs.
- Gas regression: 13 opcodes and 1,228 traces; every opcode and trace matched the committed baseline with zero drift.
- Native TON mutation gate: 110/110 critical/major mutants killed (100%).
- Jetton mutation gate: 145/145 critical/major mutants killed (100%).
- Cross-build native TON code hash: `1c4ce3fe43382378c3b472d64f8237a19c4e08c696149ebaf5bec501debe3da6`.
- Authoritative Jetton code hash: `43c7b10715d45d55f603219df7616ac4e50c5c11fcbc1477bf2a5129428f948b`.
- Polygon: production dependency audit found zero vulnerabilities; blocking lint and compile passed; 114 tests passed.
- Mini App: blocking lint, typecheck, and production build passed.
- Secret scan: all 36 commits / approximately 10.47 MB scanned; no leaks after exact suppression of three reviewed security-prose false positives.
- Primary Git worktree was clean after the commits. Generated builds, generated Acton wrappers, dependency directories, and release evidence remain ignored.

## Checks requiring hosted CI

The local run could not reproduce these checks and does not claim them as passed:

- Backend, Mini App, and TON `npm audit` calls: the sandbox blocked disclosure of dependency metadata to the public npm advisory endpoint. Polygon audit completed successfully.
- Slither `0.10.4`: not installed in the Windows environment.
- Exact Node 20 runner parity and GitHub artifact upload/download jobs.

Phase 0 is therefore stabilized and locally green for every executable build/test/mutation/gas/secret gate, but its final merge exit remains conditional on the hosted CI jobs above succeeding at this exact commit.
