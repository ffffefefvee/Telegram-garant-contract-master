# Native TON implementation status

Date: 2026-08-20

Polygon remains a first-class, independent settlement option. This status is
only for the native TON implementation and does not change Polygon behavior or
enable any production flag.

## Implemented in this slice

- Accepted architecture and security invariants in
  `ADR-001-NATIVE-TON-ESCROW.md`.
- Isolated `contracts-ton` package using Tolk 1.4.1 with pinned Blueprint,
  Sandbox and SDK dependencies.
- Immutable, deterministic per-deal `TonNativeEscrow` configuration committing
  buyer, seller, arbitrator, treasury, terms/quote hashes, amounts and deadlines.
- Acyclic lifecycle for funding, delivery, release, voluntary refund, both
  permissionless timeout paths, dispute and arbitrator resolution.
- Exact release/refund/award conservation, fixed payout destinations, excess
  funding return, terminal-state replay rejection and late-dispute cutoffs.
- Noninteractive artifact generation with code-cell hash and independent BOC
  SHA-256.
- Backend release-artifact verification against an operator-approved exact-file
  digest and code-cell hash.
- Sixty-six `contracts-ton` Jest tests plus twenty-six authoritative Acton tests
  (fourteen native and twelve funding-only Jetton), including 64 deterministic
  fuzz runs, sampled
  award-conservation properties, explicit participant-path fee ceilings,
  maximum encodable economics, outbound-action rollback and cross-build
  artifact tamper rejection.
- Pinned Acton 1.1.0 project configuration and an independent Linux CI job for
  authoritative build, formatting, linting, native lifecycle tests,
  deterministic fuzz, a committed zero-drift gas baseline and critical/major
  mutation testing. The current local mutation score is 100% (110/110 killed),
  and CI now requires the full 100% floor for these mutation levels.
- A dependent reproducibility CI gate decodes both independent BOCs, verifies
  each declared hash, requires exact code-cell hash agreement and emits a
  source-hashed, unsigned, two-approval release candidate. The release ceremony
  explicitly separates this evidence from later signatures and authorization.
- A non-signing release-policy verifier binds the exact candidate-file digest
  to a domain and policy ID, verifies at least two distinct authorized Ed25519
  signatures and emits approval evidence. Sixteen verifier tests cover malformed
  structures, unexpected fields, candidate-byte tampering, private-key
  rejection, duplicate/disabled/unauthorized signers, invalid signatures,
  policy mismatch, below-threshold bundles and output preservation on failure.
- A non-deploying authorization lock re-runs the original Ed25519 policy and
  signature verification over an immutable copy of the exact candidate, rejects
  forged approval evidence, and binds the verified digest/revision/code
  hash/policy/threshold/signer set to an operator-approved mainnet/testnet
  record. Twenty-two adversarial tests cover its schema, cryptographic,
  network-binding and atomic-output boundaries.
- Clean `npm audit` result for the complete pinned `contracts-ton` dependency
  tree after the explicit patched `protobufjs` override.
- Separate persistent TON wallet bindings; the existing EVM `walletAddress`
  and Polygon payout flow are unchanged.
- Authenticated TON Connect challenge/verify/get/detach API with hashed,
  short-lived nonces and transactionally atomic single-use consumption.
- Strict `ton_proof` verification for standard wallet v1R1-v5R1 contracts:
  exact domain/network/payload/time checks, StateInit-derived address and
  public-key verification, and Ed25519 signature verification.
- A deterministic, network- and sender-bound TON Connect transaction request
  builder that validates message addresses, positive nanotons and payload /
  StateInit BoCs before either UI asks a wallet to sign.
- Artifact verification now parses the compiled BOC, requires exactly one root
  cell, compares its actual hash with the approved code hash and pins the
  contract's 0.2 TON minimum operational reserve.
- Exact native-TON StateInit and Fund-body composition with a golden vector
  generated independently from the `contracts-ton` wrapper.
- Transactional, immutable native-TON preparation snapshots: quote/config/code
  hashes, roles, atomic economics, deadlines, address, StateInit and payload.
- Buyer-scoped funding-request endpoint and exact decimal TON-to-nanoton
  conversion. The endpoint remains unreachable for real funding because the
  adapter readiness gate is still hard-disabled.
- Finalized native-TON funding ingestion through TON Center v3, scoped to the
  deterministic escrow addresses in immutable preparations.
- Durable per-account LT cursors and append-only transaction identities using
  network, account, logical time and transaction hash; bounded backfill and
  crash replay are idempotent.
- Fail-closed validation of masterchain inclusion, non-emulated successful TVM
  execution, exact buyer/destination/Fund body, minimum value, approved code
  hash and the funded post-state's amount/query/config hash.
- Exact 9-decimal TON ledger entries and idempotent deal-FSM application.
  Rejected transactions remain as audit evidence; five failed business-state
  applications stop automation and place the watch in manual review.
- Immutable, role-scoped TON Connect action intents for seller delivery, buyer
  release, participant disputes, seller refunds and both permissionless timeout
  paths. Requests bind the verified sender, escrow, opcode, query ID, value,
  network and applicable contract state/deadline; retries cannot change them.
- Finalized lifecycle ingestion with the same durable transaction identity and
  fail-closed execution/post-state checks as funding. Release and refund events
  additionally require the exact seller/buyer and treasury payout messages,
  amounts and notification bodies emitted by the committed contract.
- Append-only, idempotent TON settlement ledger movements and deal-FSM
  application for release/refund/delivery/dispute outcomes. Concurrent scanner
  observations converge through the database transaction-identity constraint.
- Privileged native-TON dispute enforcement: only an admin connected to the
  immutable resolver-authority wallet can prepare `Resolve`, and only for the
  assigned arbitrator's committed decision after the appeal window. The intent
  fingerprints the decision and exact buyer/seller awards; finalized ingestion
  verifies all award/treasury messages before enforcing the dispute and deal.
- PostgreSQL row-level application claims using `FOR UPDATE SKIP LOCKED` for
  both funding and lifecycle events. Concurrent scheduler replicas cannot run
  the same event's business effects, and a crashed connection automatically
  releases the unapplied row for replay without an unsafe lease timeout.
- Provider-neutral reconciliation before every accepted event's business
  effects: a separately operated API v2/liteserver source supplies the raw
  transaction and current account state, which are decoded and hashed locally
  against the primary v3 transaction, inbound message and post-state
  commitments. A mismatch fails closed into manual review before ledger/FSM
  changes, with persistent source and evidence fields.
- Authenticated native-TON manual-review operations: paginated stopped-event
  inspection, watch/reconciliation evidence, required-audit keep-blocked notes,
  and a durable two-person super-admin requeue request. The requester cannot
  approve their own recovery, stale error tokens are rejected, and approval
  never bypasses reconciliation or directly marks an event settled.
- Native-TON manual-review metrics and a deduplicated operator alert for
  fail-closed watches/events. Security-sensitive recovery audit failures now
  propagate so the enclosing database transaction rolls back.
- Authenticated rejected-event evidence search, active-watch inspection and a
  super-admin-only 1-10 page targeted backfill. Backfill starts from the durable
  cursor, uses the normal finalized/reconciled application path, refuses
  stopped/terminal watches and cannot rewrite or skip a cursor. The incident
  runbook covers provider outage, disagreement and repeated bounded passes.
- Crash-replay tests now cover two accounting/application boundaries: recovery
  after a seller ledger movement commits before the platform movement, and
  recovery after a funding ledger movement commits before the deal FSM update.
  Both retries converge through existing idempotency keys without duplicating
  the logical movement.
- The crash matrix now also covers three-leg resolution recovery, finalized
  funding-event deduplication, release replay without a duplicate deal
  transition and lifecycle-intent rollback/retry. It exposed and fixed an
  event-stranding defect: lifecycle `appliedAt` is now persisted only after the
  intent and watch, and is cleared on every failed attempt so replay remains
  eligible.
- The first USDT-TON safety slices validate independent
  `get_wallet_address`/`get_wallet_data` evidence against an allowlisted master
  and parses exact TEP-74 `transfer_notification` messages. It rejects fake
  masters, wrong wallet/owner/destination/buyer/query/amount/payload, bounced
  notifications, trailing data and malformed BOCs. It is not yet wired to a
  deal or enabled for settlement.
- A separate funding-only `TonJettonEscrow` now avoids the canonical-wallet
  StateInit fixed-point: its address is derived from configuration containing
  the allowlisted master and pinned wallet-code hash, but not the wallet. A
  distinct immutable initializer may seal one independently verified wallet
  and evidence commitment; funding is impossible before sealing and afterward
  accepts one matching TEP-74 notification only from that wallet. Twelve
  authoritative Acton tests cover the two-phase bootstrap, identity separation,
  seal replay/query/config boundaries, canonical inline/reference funding,
  fake-wallet, malformed, bounced, late and impossible-state paths. The
  critical/major mutation score is 100% (145/145 killed), with a committed
  zero-drift 13-opcode gas baseline. This is not yet a complete
  release/refund/dispute/payout contract, and the initializer workflow still
  needs finalized independent wallet proof and threshold approval.
- A pure finalized Jetton funding-envelope validator now composes canonical
  wallet and notification evidence with durable transaction identity,
  masterchain inclusion, explicit successful non-emulated execution, exact
  destination/deadline and zero unexplained outbound messages. It remains
  deliberately unwired.
- A deterministic Jetton payout/recovery state model conserves value across
  buyer/seller/treasury legs, assigns unique query IDs and idempotency keys,
  matches exact transaction observations, and permits retry only after a
  recorded bounce. It does not yet send transfers or reconcile balances.
- The corrected pure Jetton payout reconciliation v2 is a raw-evidence
  structural precheck, not a finalized-settlement validator. It locally parses
  raw transaction BOCs and embedded TEP-74 message cells, binds an immutable
  settlement/leg/attempt and exact owner transaction, supports a complete
  committed multi-leg owner outbox, requires the exact notification/optional
  excess semantics, and binds raw pre/post `ShardAccount` cells to transaction
  state updates and locally decoded wallet code/data/balance. Two expected
  collector IDs map to distinct immutable operator identities, and their
  consensus fingerprint covers transaction, block-metadata, message and state
  identities. Malformed input fails closed without throwing.
- Full shard-to-finalized-masterchain inclusion verification is not yet
  implemented. Therefore even a structurally valid, agreed observation returns
  `accepted: false`, `settlementAuthorized: false` and
  `MASTERCHAIN_PROOF_REQUIRED`. The precheck remains pure and unwired and cannot
  update payout state, ledger, deal state or adapter readiness. Its v2 suite
  passes 27 tests; the combined reconciliation, funding, notification and
  payout-state focused run passes 4 suites / 90 tests.
- A separate pure canonical-wallet seal preflight validates raw getter cells
  and active wallet `ShardAccount` evidence from two configured, independently
  identified collectors. It binds the exact network, escrow owner, allowlisted
  master, candidate wallet, pinned code hash and block identities. Its 32 tests
  cover malformed/trailing data, identity and network drift, source
  disagreement, zero commitments, wallet data/code mismatches and transaction
  history integrity. Because proof inclusion and local getter execution are
  still absent, it always returns `sealingAuthorized: false`, exposes only an
  audit-safe `structuralEvidenceHash`, and keeps the contract-ready
  `verificationEvidenceHash` null.
- An isolated Phase 1 proof-envelope foundation now freezes exact trusted
  network/checkpoint and raw proof-bundle schemas. It performs strict,
  resource-bounded base64 and BOC framing checks, rejects incomplete/trailing
  or internally unused bytes, requires one complete Merkle-proof root per role,
  and binds the masterchain proof's embedded virtual root to the target block.
  Its 24 focused adversarial tests pass. This remains an input-safety boundary,
  not cryptographic finality verification: every result is non-authorizing,
  `verificationEvidenceHash` remains null, and no production component imports
  it. The invariant, threat model, observability, evidence and rollback rules
  are recorded in `ADR-002-TON-PROOF-KERNEL-FOUNDATION.md`.
- The envelope now invokes a local masterchain header-proof verifier. It checks
  the Merkle virtual-root hash, canonical TON `Block`/`BlockInfo` tags, network
  global ID, masterchain shard identity, exact sequence and predecessor,
  previous trusted key block, logical and generation times, catchain/validator
  identifiers, and exotic state-update hashes. The parsed block time has an
  independent stale/future policy. This typed header artifact is not finality:
  validator-set derivation, weighted Ed25519 signatures and key-block
  transitions are still absent, so all public results remain non-authorizing
  and unwired. The two proof-kernel suites pass 44 focused tests and the full
  backend passes 80 suites / 755 tests. See
  `ADR-003-TON-MASTERCHAIN-HEADER-PROOF.md`.
- A pure ordinary-signature primitive now strictly decodes raw LiteServer
  `partialBlockProof` TL bytes, validates contiguous masterchain links, derives
  validator node IDs from Ed25519 public keys, reproduces TON's internal signed
  block-ID bytes, rejects duplicate/unknown/invalid signers and enforces the
  protocol's strict more-than-two-thirds weight threshold. Non-ordinary
  (including Simplex) signature sets fail closed. The 21 focused tests pass.
  Because key-block configuration, validator selection and set-hash provenance
  are not yet proven, its result fixes `validatorSetProven` and
  `finalityProven` to false and remains unwired. See
  `ADR-004-TON-ORDINARY-SIGNATURE-PROOF.md`.
- A separate validator-set primitive now parses `validators#11` and
  `validators_ext#12` cells plus catchain parameter 28, enforces exact
  dictionary/descriptor/weight invariants, reproduces the optional SHA-512
  masterchain shuffle, computes TON's order-sensitive CRC32C short hash, and
  binds catchain/hash values to the parsed masterchain header. Its 17 focused
  tests include fixed shuffle and hash vectors plus signature-verifier handoff.
  The configuration cells are still caller-supplied rather than Merkle-proven,
  so `sourceConfigProven`, `validatorSetProven` and `finalityProven` remain false
  and the module stays unwired. See
  `ADR-005-TON-VALIDATOR-SET-DERIVATION.md`.
- The ordinary forward-link verifier now authenticates `config_proof` to an
  exact trusted source key block and `dest_proof` to its destination block,
  extracts the proven key-block configuration, distinguishes dictionary
  presence/absence from a pruned target path, selects parameter 35 before 34,
  applies parameter-28 defaults only after proven absence, binds the derived
  validator hash to the destination header and verifies the weighted Ed25519
  signatures. Its 15 focused tests pass. A successful artifact proves one link
  only and therefore fixes `finalityProven: false`; it remains pure, unwired and
  non-authorizing. See `ADR-006-TON-FORWARD-LINK-CONFIG-PROOF.md`.
- A complete-chain verifier now composes strict raw `partialBlockProof`
  decoding with authenticated forward links from the exact trusted key block,
  requires proven key-block intermediates and an exact fresh endpoint, and
  rejects incomplete, backward, stale/future or endpoint-drifted paths. Its 8
  focused tests include a two-link validator rotation. Only the complete chain
  sets `masterchainFinalityProven: true`; it keeps `authorizationAllowed: false`
  and `verificationEvidenceHash: null` and remains pure and unwired. See
  `ADR-007-TON-MASTERCHAIN-CHECKPOINT-FINALITY.md`.
- The finalized masterchain target can now authenticate its state and exact
  basechain `ShardHashes` descriptor. The verifier binds the state proof to the
  header state-update hash, proves the workchain Patricia path, enforces exact
  split-tree prefix traversal and parses both descriptor layouts. Its 8 tests
  cover full/split shards, scheduling, pruning and metadata/provenance drift.
  The result proves the recorded shard block ID only; it keeps
  `shardBlockProofVerified: false`, authorization false and verification
  evidence null and remains pure/unwired. See
  `ADR-008-TON-FINALIZED-SHARD-DESCRIPTOR.md`.
- The finalized descriptor can now authenticate its exact shard-block Merkle
  proof. The verifier binds the local `Block`/`BlockInfo` parse to network,
  workchain, shard, sequence, time and split/merge metadata, checks ordinary,
  parent and child predecessor relationships, and extracts the old/new state
  hashes committed by the block's exotic `MerkleUpdate`. Its 12 tests cover
  ordinary/split/merge paths, root substitution, identity/metadata drift,
  invalid ancestry, state-update type and provenance failure. The result sets
  `shardBlockFinalityProven: true`, but keeps `shardStateProofVerified: false`,
  authorization false and verification evidence null and remains pure/unwired.
  The eight proof-kernel suites pass 125 focused tests and the full backend
  passes 81 suites / 767 tests. See
  `ADR-009-TON-FINALIZED-SHARD-BLOCK.md`.
- Canonical account proofs now require exactly two Merkle roots and reject
  unreachable cells. The account verifier binds the header/state roots to the
  finalized shard block, validates the complete `ShardStateUnsplit` identity and
  shard prefix, traverses `HashmapAugE 256 ShardAccount` with explicit
  absent/pruned semantics, and binds a separate active account root, address,
  last transaction LT and code/data. Its 26 tests include a complete requested
  path with an unrelated pruned sibling; the corrected envelope has 28 tests.
  The result keeps transaction inclusion and authorization false and verification
  evidence null and remains pure/unwired. The nine proof-kernel suites pass 153
  focused tests and the full backend passes 82 suites / 795 tests. See
  `ADR-010-TON-FINALIZED-ACCOUNT-STATE.md`.
- The shard/account artifacts now preserve their exact finalized masterchain
  anchor. A masterchain-state proof binds a complete TVM configuration
  dictionary to that anchor, and the pinned local sandbox executes
  `get_wallet_address` against the proven master code/data with exact owner
  encoding, exit/result shape, gas and missing-library checks. The 29 new tests
  include real local emulator execution and adversarial anchor/config/code
  drift. The result remains non-authorizing, its fixture is synthetic, and its
  transcript hash is not seal evidence. The eleven proof-kernel suites pass
  182 focused tests, and the full backend passes 84 suites / 824 tests. See
  `ADR-011-TON-PROVEN-TVM-ENVIRONMENT-AND-LOCAL-GETTER.md`.
- The local canonical-wallet result can now be composed with a separately
  proven active wallet at the identical finalized masterchain anchor. Exact
  TEP-74 wallet data binds the escrow owner, allowlisted master, active pinned
  code and embedded code; malformed, trailing, pruned or substituted data fails
  closed. Its 19 tests preserve sealing authorization false and verification
  evidence null. The twelve proof-kernel suites pass 201 focused tests, and the
  full backend passes 85 suites / 843 tests. See
  `ADR-012-TON-PROVEN-CANONICAL-WALLET-COMPOSITION.md`.
- Finalized shard blocks can now prove exact transaction inclusion through
  `BlockExtra.account_blocks`, `HashmapAugE 256 AccountBlock` and the nested
  `HashmapAug 64 ^Transaction`. The complete transaction BOC must decode locally
  and match the proven reference; target pruning, absence, wrong shard/account/LT
  and substituted hashes fail closed while unrelated pruned siblings are
  accepted. Its 18 tests preserve settlement authorization false and verification
  evidence null. The thirteen proof-kernel suites pass 219 focused tests, and
  the full backend passes 86 suites / 861 tests. See
  `ADR-013-TON-FINALIZED-TRANSACTION-INCLUSION.md`.

The current local development code-cell hash is
`1c4ce3fe43382378c3b472d64f8237a19c4e08c696149ebaf5bec501debe3da6`.
It is not an approved release hash and must not be deployed with real funds.

## Deliberately still disabled

`TonEscrowAdapter.isReady()` remains false. Verifying contract bytes does not
make the complete funds flow safe. The existing TON deposit-to-Polygon float is
still classified as a legacy migration path, not native TON escrow.

## Required next implementation slices

1. Run the new Acton assurance and automatic Blueprint-vs-Acton jobs in hosted
   CI. Select real hardware-backed release identities and policy, exercise
   signer loss/recovery, and connect the verified approval evidence to a
   separately controlled deployment workflow; CI output remains intentionally
   unsigned.
2. Continue assurance beyond the deterministic fuzz, gas baseline and 100%
   critical/major mutation gate: add broader native outbound-message failure
   scenarios and subject the contract and backend funds flow to an independent
   audit.
3. Complete TON Connect clients on both surfaces: manifest, capability
   detection, restored sessions, challenge/verify integration and standard
   TON-gas fallback. The exact native-TON deploy/fund request and immutable
   preparation snapshot are implemented behind the disabled adapter gate;
   unknown wallet contracts remain fail-closed until a trusted on-chain
   `get_public_key` fallback is added.
4. Provision the independent/self-hosted API v2 liteserver source, require the
   implemented reconciliation gate in production, and run the implemented
   alert, rejected-event inspection, bounded backfill and dual-authorized
   recovery workflow through disagreement/outage drills. Evaluate or
   independently audit local shard-proof validation. Finalized
   ingestion, durable cursor, immutable post-state verification, deal-FSM
   application and the TON ledger path are implemented but not yet
   production-proven.
5. Replace the development resolver authority with audited multisig/threshold
   governance and add signer recovery drills. Participant and resolution
   actions plus finalized
   award ingestion are implemented behind the gate.
6. Finish the canonical-wallet seal workflow first: independently verify the
   master-derived wallet, raw active wallet code/data, owner and master against
   finalized proofs; bind a domain-separated evidence commitment; require an
   audited threshold initializer approval; and update deterministic config,
   StateInit and seal-message generation for the two-phase ABI.
7. Extend the funding-only `TonJettonEscrow` into an audited lifecycle and wire
   the finalized funding validator into durable, replay-safe ingestion. Add
   verified post-transaction wallet balance deltas, outbound transfers/excess,
   on-chain bounce handling and recovery reconciliation. Keep expanding the
   dedicated Jetton mutation/test gate with each lifecycle addition. The current
   isolated contract, envelope and recovery model do not imply Jetton readiness.
8. Deploy to testnet, run release/refund/dispute/recovery drills, obtain an
   independent contract/backend funds-flow audit, remediate, and only then run
   a value-capped closed beta.
9. Design the Mini App and website against the stabilized transaction/status
   contracts in parallel. The Mini App focuses on TON; the website offers TON
   and Polygon according to channel policy.

External policy/legal, country, payout-partner and public-launch gates in
`MULTICHAIN_PUBLIC_LAUNCH_PLAN.md` remain mandatory and cannot be closed by
code alone.
