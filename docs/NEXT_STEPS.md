# Implementation handoff and remaining work

Date: 2026-08-20

This is the execution handoff for the next development session. Confirmed
product scope remains in `PRODUCT_PLAN.md`. Polygon remains a first-class
settlement option. The Telegram Mini App is TON-first; the standalone website
must let eligible users choose TON or Polygon.

## Current verified baseline

- Native TON lifecycle contract and backend preparation/ingestion/recovery
  slices exist, but `TonEscrowAdapter.isReady()` is deliberately hard-disabled.
- The native contract passed 14 authoritative Acton tests, 64 deterministic
  fuzz runs, zero-drift gas checks and 110/110 critical/major mutations.
- The funding-only Jetton contract now removes the canonical-wallet StateInit
  circularity through one-time wallet sealing and authenticates one exact
  TEP-74 notification only after sealing. It passed 12 authoritative tests,
  zero-drift gas checks and 145/145 critical/major mutations. It is not yet a
  complete escrow lifecycle.
- Canonical Jetton wallet/notification and finalized funding-envelope
  validators exist, together with a pure payout/retry state model.
- Durable Jetton event storage is implemented but intentionally unwired. It
  separates immutable observation evidence from mutable application progress,
  uses transactional row locking and keeps failed events replayable. Its
  focused suite has 15 tests.
- Release candidate, Ed25519 threshold approval and deployment-input locks are
  implemented. The deployment lock re-verifies the original policy/signatures;
  it does not trust an unsigned approval JSON or possess deploy/signing access.
- The current backend suite passes 90 suites / 943 tests, including the
  unwired durable-ingestion and corrected raw-evidence reconciliation slices.
  Both npm dependency audits reported zero vulnerabilities.

None of these statements authorizes real funds or public launch.

## P0 — complete the money path

### 1. Complete the canonical-wallet seal workflow

The escrow contract address can now be derived before its canonical Jetton
wallet exists: StateInit commits the master and pinned wallet-code hash but not
the wallet address. Funding is impossible until the immutable initializer
seals one wallet and a nonzero verification-evidence commitment.

The pure off-chain structural preflight is now implemented. It compares two
configured source/operator pairs, raw getter cells and raw active wallet
`ShardAccount` data, and emits only an audit-safe `structuralEvidenceHash`.
It always returns `sealingAuthorized: false` and keeps
`verificationEvidenceHash: null`.

Phase 1 now also has an isolated proof-envelope foundation. It freezes the
trusted network/checkpoint and raw five-proof bundle contracts, rejects
non-canonical or over-budget BOCs, enforces exact byte/cell consumption and
per-role root cardinality (one for block roles, exactly two for canonical
account proofs), binds the embedded masterchain virtual root to the target
block, and commits the result for audit. Its 28 focused adversarial tests cover
network/global-ID drift, stale/future observations, identity drift, malformed
base64, size/cell/depth limits, trailing/unused bytes, unreachable cells,
wrong cell types and CRC corruption. This module is not cryptographic proof
verification: its type cannot express authorization, it remains unwired, and
it emits no `verificationEvidenceHash`. See
`ADR-002-TON-PROOF-KERNEL-FOUNDATION.md`.

The next isolated slice locally verifies the masterchain header carried by the
Merkle proof. It binds the virtual root to the extended block ID and parses the
TON `Block`, `BlockInfo`, predecessor, key-block anchor, catchain/validator
identifiers, logical time, generation time and state-update hashes. Envelope
freshness now applies to the parsed block time as well as the provider
observation time. This closes provider-metadata substitution at the header
layer, but it still cannot establish finality: validator-set derivation,
signature weight and key-block transitions remain mandatory. See
`ADR-003-TON-MASTERCHAIN-HEADER-PROOF.md`.

A strict LiteServer signature primitive is now also isolated and unwired. It
decodes raw `partialBlockProof` TL bytes with exact consumption and bounded
links/signatures/proof blobs, validates contiguous masterchain paths, reproduces
TON's ordinary `ton.blockId` and finalized Simplex vote domains plus Ed25519
node IDs, and requires unique known signers with strictly more than two-thirds
weight. Its typed primitive deliberately keeps `validatorSetProven: false` and
`finalityProven: false` until composed with proven configuration. Unknown
signature-set constructors fail closed. See
`ADR-004-TON-ORDINARY-SIGNATURE-PROOF.md` and
`ADR-016-TON-SIMPLEX-FINALITY-AND-FIXTURE-CAPTURE.md`.

The masterchain validator-set derivation primitive now parses both canonical
validator-set cell formats and catchain parameter 28, reproduces TON's optional
SHA-512 masterchain shuffle and CRC32C validator-list short hash, and binds the
result to the parsed header's catchain/hash fields. The source cells are not yet
Merkle-proven, so every artifact keeps `sourceConfigProven: false`,
`validatorSetProven: false` and `finalityProven: false`. See
`ADR-005-TON-VALIDATOR-SET-DERIVATION.md`.

One ordinary or finalized-Simplex forward link can now authenticate those
inputs. The strict
`config_proof` binds the trusted source key block and its configuration
dictionary; the independent `dest_proof` binds the destination header.
Authenticated Patricia lookups distinguish presence, proven absence and a
target path hidden by pruning, select parameter 35 before 34, and allow
parameter-28 defaults only after absence is proven. The derived set must match
the destination header before its weighted signatures are accepted. This
upgrades proof and validator provenance for one link, but deliberately keeps
`finalityProven: false`; complete checkpoint-chain validation is still absent.
See `ADR-006-TON-FORWARD-LINK-CONFIG-PROOF.md`.

Complete forward-only ordinary or finalized-Simplex checkpoint paths can now
be composed from the
exact trusted key block through proven intermediate key blocks to the exact
fresh target. Only this complete artifact sets `masterchainFinalityProven` and
`finalityProven` true; it still fixes `authorizationAllowed: false` and keeps
`verificationEvidenceHash` null. Backward links fail closed because their
distinct source-state/old-block proof path is outside the trusted-key-block
policy. Each evidence link commits its consensus mode and signed-data hash.
See `ADR-007-TON-MASTERCHAIN-CHECKPOINT-FINALITY.md` and
`ADR-016-TON-SIMPLEX-FINALITY-AND-FIXTURE-CAPTURE.md`.

The finalized target can now authenticate a basechain shard descriptor. The
state proof is bound to the header's `newStateHash`; exact authenticated
Patricia/BinTree traversal selects the workchain and shard prefix, including
split children, and parses both descriptor layouts. This proves the shard top
block ID recorded by finalized masterchain state, but keeps
`shardBlockProofVerified: false`, authorization false and verification evidence
null. See `ADR-008-TON-FINALIZED-SHARD-DESCRIPTOR.md`.

The finalized descriptor can now authenticate the exact shard block and its
state-update commitment. The verifier binds the local `Block`/`BlockInfo` parse
to the network, workchain, shard, sequence, time and split/merge metadata,
checks parent/child predecessor relationships, and exposes the committed old
and new shard-state hashes. It deliberately keeps
`shardStateProofVerified: false`, authorization false and verification evidence
null. See `ADR-009-TON-FINALIZED-SHARD-BLOCK.md`.

The canonical two-root account verifier can now bind a `ShardStateUnsplit` to
that finalized block and prove one exact active account through the augmented
`ShardAccounts` dictionary. It verifies the shard prefix and complete state
identity, distinguishes absence from pruning, accepts unrelated pruned siblings,
and binds the separate account root, embedded address, last transaction LT,
balance and code/data hashes. It keeps transaction inclusion false,
authorization false and verification evidence null. See
`ADR-010-TON-FINALIZED-ACCOUNT-STATE.md`.

The account and shard artifacts now retain the exact finalized masterchain
anchor that authenticated them. A new masterchain-state verifier binds the
complete TVM configuration dictionary to that same finalized header, and a
pinned sandbox runner executes `get_wallet_address` locally against the proven
Jetton-master code/data. It accepts only exit code zero and exactly one address,
enforces deterministic inputs and a gas cap, and rejects missing global
libraries. Provider getter output is not an input. The local result remains
non-authorizing and the fixture is synthetic; captured mainnet/testnet replay
and independent executor-policy review are still required. See
`ADR-011-TON-PROVEN-TVM-ENVIRONMENT-AND-LOCAL-GETTER.md`.

The locally derived canonical address can now be composed with a separately
proven active wallet account at the same finalized masterchain anchor. The
composition decodes exact TEP-74 wallet data and binds the escrow owner,
allowlisted master, active pinned code and embedded wallet code. It emits only
an audit composition hash and keeps sealing authorization false and verification
evidence null. See `ADR-012-TON-PROVEN-CANONICAL-WALLET-COMPOSITION.md`.

Finalized shard blocks can now prove a complete transaction through the
canonical `BlockExtra`, `ShardAccountBlocks`, `AccountBlock` and transaction
augmented dictionaries. A complete transaction BOC is locally decoded and must
match the reference committed by the proof; unrelated pruning is allowed, while
an unproven target path fails closed. The result keeps settlement authorization
false and remains unwired. See `ADR-013-TON-FINALIZED-TRANSACTION-INCLUSION.md`.

The raw payout reconciler can now be composed with finalized inclusion proofs
for its exact owner, sender-wallet and recipient-wallet transactions. The
composer requires one network/anchor, binds every structural block fingerprint
and sender/recipient pre/post state hash, and can report reconciliation finality
without settlement authorization. Its composition hash remains audit-only. See
`ADR-014-TON-FINALIZED-JETTON-RECONCILIATION-COMPOSITION.md`.

The proof outputs now have a separate verification-evidence and threshold
approval boundary. Wallet-seal and settlement wrappers re-run their complete
proof compositions, then commit the exact network, finalized anchor, subject
and proof hash under a policy that also pins the trusted-network configuration,
minimum sequence, captured-fixture manifest and independent review. A distinct
immutable Ed25519 authority must reach its threshold over a scope-separated
payload before the pure result can express authorization. No key custody,
message composition, broadcast, persistence or adapter wiring is included.
See `ADR-015-TON-VERIFICATION-EVIDENCE-AND-THRESHOLD-APPROVAL.md`.

The sixteen proof-kernel/evidence suites currently pass 278 focused tests;
finalized reconciliation composition adds 23 adversarial tests.

Complete the proof pipeline before lifecycle work: the pinned capture tool now
understands ordinary and Simplex LiteServer responses, and strict manifest
validation plus provider-free full replay are implemented. Immutable mainnet
and testnet corpora, successful replay of both, the cryptographic per-layer
bit-flip matrix and independent proof/executor-policy review remain required.
The separate domain-separated verification commitment and threshold approval
boundary exist but remain pure and unwired. The structural or local execution
transcript hash must never be used as the contract's seal evidence.
See `ADR-017-TON-OFFLINE-PROOF-FIXTURE-REPLAY.md`.
The initializer and reconciliation authority are money-critical and must remain
distinct from every transaction role.

Update deterministic config/StateInit and seal-message composition for the new
ABI. No component may sign, broadcast or enable funding merely because the
structural evidence agrees.

### 2. Complete Jetton masterchain finality proof

The corrected pure reconciliation v2 no longer trusts provider-decoded message
objects. It parses raw transaction/message BOCs locally, binds the complete
committed owner outbox and selected settlement attempt, validates the exact
recipient notification/optional excess set, and binds raw pre/post
`ShardAccount` cells to transaction state updates and locally decoded Jetton
wallet code/data/balances. Collector operators come from immutable expectation
configuration, and the consensus fingerprint covers transaction LT/hash,
block metadata, message hashes and state identities.

This is only a structural precheck. It deliberately returns `accepted: false`
and `MASTERCHAIN_PROOF_REQUIRED` after all current checks pass because local
shard-to-finalized-masterchain inclusion verification is not implemented. Keep
it unwired. The next slice must verify those proofs from raw liteserver data,
add proof-vector/adversarial tests, and only then introduce a result capable of
authorizing durable settlement. Do not convert agreement on provider block
metadata into finality.

### 3. Complete the Jetton escrow lifecycle

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

### 4. Wire durable Jetton ingestion only after 1, 2 and 3

- Register the new migration/entities in the production composition root.
- Add immutable Jetton preparations, watched accounts and lifecycle intents.
- Feed only locally proof-verified, finalized observations into the durable
  event service; the current structural precheck can never authorize this.
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
