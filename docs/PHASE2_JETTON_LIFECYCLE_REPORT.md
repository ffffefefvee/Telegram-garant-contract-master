# Phase 2 Jetton lifecycle report

Date: 2026-09-01

Rollback point: Phase 1 mainline commit `1852cc7`

## Outcome

The isolated USDT-TON contract lifecycle is implemented and passes its local
engineering exit gate. No adapter, production flag, signing path or broadcast
path was enabled.

## Reproducible evidence

- Pinned toolchains: Blueprint Tolk 1.4.1 and Acton 1.1.0.
- TypeScript: 6 suites / 69 tests.
- Acton: 40 tests total (26 Jetton, 14 native) plus 64 deterministic fuzz runs.
- Mutation: Jetton 384/384 executable critical/major mutants killed; two
  generated mutants fail compilation. Native remains 110/110.
- Gas: reviewed snapshot regenerated for the lifecycle tests and immediately
  replayed with `--fail-on-diff`; drift is zero.
- Jetton code hash from both independent builds:
  `cbe811eb5df11ae64a03f2960154816011df82789ffb5b8a9b0976c26ea6ac73`.
- Native code hash remains
  `1c4ce3fe43382378c3b472d64f8237a19c4e08c696149ebaf5bec501debe3da6`.

Hosted CI must reproduce these facts from the committed checkout before merge.
The hosted Jetton artifact is explicitly non-authorizing.

## Review boundary

The protected invariants, threat-model change, implementation, adversarial
coverage, migration/rollback rule, observability and remaining enablement
evidence are recorded in `ADR-018-TON-JETTON-SETTLEMENT-LIFECYCLE.md`.

This phase does not claim proof-pipeline review, durable backend integration,
testnet operation or external audit. Those gates remain sequential blockers.
