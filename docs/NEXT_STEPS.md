# Implementation handoff and remaining work

Date: 2026-08-18

This is the execution handoff for the next development session. Confirmed
product scope remains in `PRODUCT_PLAN.md`. Polygon remains a first-class
settlement option. The Telegram Mini App is TON-first; the standalone website
must let eligible users choose TON or Polygon.

## Current verified baseline

- Native TON lifecycle contract and backend preparation/ingestion/recovery
  slices exist, but `TonEscrowAdapter.isReady()` is deliberately hard-disabled.
- The native contract passed 14 authoritative Acton tests, 64 deterministic
  fuzz runs, zero-drift gas checks and 110/110 critical/major mutations.
- The funding-only Jetton contract authenticates one exact TEP-74 notification.
  It passed 9 authoritative tests, zero-drift gas checks and 71/71
  critical/major mutations. It is not yet a complete escrow lifecycle.
- Canonical Jetton wallet/notification and finalized funding-envelope
  validators exist, together with a pure payout/retry state model.
- Durable Jetton event storage is implemented but intentionally unwired. It
  separates immutable observation evidence from mutable application progress,
  uses transactional row locking and keeps failed events replayable. Its
  focused suite has 15 tests.
- Release candidate, Ed25519 threshold approval and deployment-input locks are
  implemented. The deployment lock re-verifies the original policy/signatures;
  it does not trust an unsigned approval JSON or possess deploy/signing access.
- The current backend suite passes 71 suites / 583 tests, including the final
  unwired durable-ingestion slice. Both npm dependency audits reported zero
  vulnerabilities.

None of these statements authorizes real funds or public launch.

## P0 — complete the money path

### 1. Finish Jetton reconciliation

Implement the interrupted pure validator in a new
`ton-jetton-reconciliation-validator.ts` plus adversarial tests.

It must prove all of the following from independently sourced finalized data:

- exact escrow-owner `transfer` instruction to the canonical escrow Jetton
  wallet;
- linked sender-wallet `internal_transfer` and successful recipient-wallet
  processing;
- exact query ID, amount, destination, response destination, forward TON and
  payload hash;
- canonical master/owner/wallet evidence for both wallets;
- exact debit and credit balance deltas tied to durable transaction identities;
- complete outbound message sets, with no unexplained or bounced messages; and
- source independence. An `excesses` message alone is never payout proof.

Definition of done: malformed input never throws; every rejection has durable
evidence/reason codes; focused tests cover forged links, missing messages,
wrong wallet/master/owner, stale state, bad deltas, bounce/restore and provider
agreement; lint, TypeScript and full backend tests pass.

### 2. Complete the Jetton escrow lifecycle

Extend the funding-only contract with delivery, release, refund, timeouts,
dispute and resolution. Jetton transfers are asynchronous, so payout
instruction must enter `SETTLEMENT_PENDING`, not a terminal success state.

Use a separate immutable reconciliation authority (intended to be a threshold
or multisig identity), distinct from buyer, seller, arbitrator, treasury and
the Jetton wallet. Only finalized reconciliation may mark settlement complete
or identify failed legs. Retries must use fresh query IDs and resend only the
failed legs. Bind confirmations to settlement ID, attempt/query range, exact
leg mask and amount commitment. The arbitrator remains limited to dispute
awards.

Definition of done: all immutable role/economic/deadline boundaries are tested;
immediate instruction bounces and downstream restore/retry paths are tested;
gas baseline is stable; both contract mutation gates remain 100%; independent
contract review is complete.

### 3. Wire durable Jetton ingestion only after 1 and 2

- Register the new migration/entities in the production composition root.
- Add immutable Jetton preparations, watched accounts and lifecycle intents.
- Feed only finalized, reconciled observations into the durable event service.
- Apply ledger/FSM effects in the same transaction and persist `appliedAt` last.
- Add scheduler, bounded backfill, rejected-event search, metrics, alerts and
  dual-authorized manual recovery.
- Add PostgreSQL integration tests for unique identities, concurrent
  `SKIP LOCKED` workers, process-crash replay and cursor recovery.

Keep `TonEscrowAdapter.isReady()` false until the external release gates below
are also complete.

## P0 — prove both chains operationally

### Native TON

- Run the new Acton/reproducibility jobs in hosted CI.
- Provision the independent/self-hosted liteserver source and exercise provider
  mismatch/outage/backfill/manual-review drills.
- Select hardware-backed release signers, threshold policy, signer recovery and
  the separately controlled deployment identity.
- Deploy an approved build to testnet and run release/refund/timeout/dispute/
  resolution and recovery drills with exact ledger reconciliation.
- Obtain an independent contract plus backend funds-flow audit and close every
  critical/high finding.

### Polygon

- Complete the Amoy Web3Signer acceptance report and gas/fee measurements.
- Re-run contract tests, static analysis, role/upgrade/key review and backend
  end-to-end settlement tests.
- Validate production RPC redundancy, finality policy, monitoring, relayer
  funding, pause controls and recovery drills.
- Obtain/refresh the independent Polygon contract/backend review before public
  funds.

## P0 — product, legal and provider gates

- Obtain written Telegram-policy confirmation for the intended Mini App
  transaction categories. Digital goods/services and cryptocurrency behavior
  must not be assumed exempt from Telegram payment rules.
- Complete a launch-country allowlist and legal analysis per jurisdiction; do
  not treat the CIS as one market.
- Select the operating entity and complete AML/KYC, sanctions, Travel Rule,
  records, dispute and law-enforcement procedures appropriate to the actual
  custody/conversion model.
- Contract fiat/off-ramp partners per country. Do not promise automatic
  withdrawal to any card or availability in Russia without an approved domestic
  regulated partner and legal sign-off.
- Publish transparent all-in fees, quote expiry, issuer-freeze risk, supported
  currencies/methods and failure/refund behavior.

## P1 — interfaces (design together before implementation)

### Telegram Mini App — TON-first

- Restored TON Connect sessions, wallet capability detection and standard
  TON-gas fallback.
- A short create/share/fund flow with exact amount, network, fee, deadline and
  wallet confirmation previews.
- Buyer/seller role dashboards, delivery/release/refund/dispute actions,
  pending-finality states and recovery guidance.
- Never present an instruction submission as settled; show finalized and
  reconciled status separately.

### Standalone website — TON and Polygon

- Marketing/trust/legal pages plus authenticated transaction workspace.
- Explicit chain comparison and user choice based on actual fee, wallet,
  currency, country and payout availability.
- The same backend status contract as the Mini App, with chain-specific wallet
  connectors and explorer/evidence views.
- Admin/operations interface for reconciliation, alerts, disputes, recovery and
  release evidence. Privileged actions require strong authentication and
  separation of duties.

## P1 — launch engineering

- Threat model, load/soak/chaos tests, backup/restore exercise and observability
  for RPC lag, reconciliation mismatch, stuck events, payout recovery and
  ledger drift.
- Secrets in managed KMS/HSM, least-privilege service identities, key rotation,
  dependency/SBOM/scanning and signed builds.
- Terms, privacy, risk disclosure, support runbooks, incident communications
  and vulnerability disclosure/bug bounty.
- Capped testnet pilot, then capped closed mainnet beta with per-deal/daily
  limits, allowlisted countries/assets and an immediate funding kill switch.

## Public-launch gate

Go public only when both selected settlement paths have approved artifacts,
external audit closure, operational drills, monitoring/on-call coverage, legal
and Telegram-policy approval, contracted payout behavior and a successful
capped beta. UI completion by itself is not project completion.
