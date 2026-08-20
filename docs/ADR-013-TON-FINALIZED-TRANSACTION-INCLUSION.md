# ADR-013: Finalized shard-transaction inclusion

Date: 2026-08-20

Status: accepted as an isolated Phase 1 proof-kernel slice; not authorized for production

## Decision

A detached transaction BOC is not evidence that the transaction belongs to a
finalized shard block. The backend must bind the complete, locally decoded BOC
to the transaction reference proven through the exact TON path:

```text
finalized Block
  → BlockExtra.account_blocks
  → HashmapAugE 256 AccountBlock
  → AccountBlock.transactions
  → HashmapAug 64 ^Transaction
```

The implementation follows `crypto/block/block.tlb` and the reference
`check-proof.cpp` extraction path. Canonical augmented-dictionary leaves store
their `CurrencyCollection` augmentation before the value; fork nodes store two
references followed by the augmentation.

## Protected invariant and threat-model change

The verifier now rejects:

- a transaction proof detached from the finalized shard-block root;
- a requested account outside the proven workchain/shard prefix;
- malformed or non-canonical account, logical-time or transaction-hash inputs;
- a full transaction BOC whose cell hash, embedded account or LT differs from
  the request;
- proven account-block or transaction absence;
- a target dictionary path hidden by pruning;
- a substituted account embedded in `AccountBlock`;
- a substituted transaction reference or malformed account-block state update;
- malformed, trailing, unreachable or over-budget proof/transaction cells.

Unrelated pruned siblings are accepted. The target transaction reference may
itself be a pruned branch only when its committed virtual hash equals the
separately supplied complete transaction BOC; that BOC is fully decoded with
`loadTransaction` and exact slice consumption.

The output preserves both transaction-level and account-block aggregate state
update hashes so later reconciliation can bind its pre/post account evidence.

## Authorization boundary

Successful inclusion sets `transactionInclusionVerified: true` but fixes
`settlementAuthorized: false`, `authorizationAllowed: false` and
`verificationEvidenceHash: null`.

The module is pure and test-only. The existing Jetton payout reconciler is not
yet wired to it and continues to return `MASTERCHAIN_PROOF_REQUIRED`.

## Verification

Eighteen focused tests cover canonical inclusion, a pruned target reference,
unrelated pruned siblings in both augmented dictionaries, root/shard/account/LT
substitution, absence versus pruning, transaction-reference substitution,
state-update corruption, trailing bytes, resource limits and forged provenance.

Fixtures are schema-correct synthetic cells. Captured mainnet/testnet liteserver
proofs and one-bit corruption vectors remain Phase 1 exit evidence.

## Migration, rollback and observability

There is no database, API, adapter, signing or production-composition migration.
Rollback is a single commit revert. The typed output carries block, proof BOC,
transaction BOC, transaction-chain and state-update hashes for future immutable
evidence persistence, but emits no operational event or money-moving action.

Enablement requires composing a proven transaction for every reconciled owner,
sender-wallet and recipient-wallet transaction, binding their proven account
states, freezing the final evidence schema, captured network replay, independent
review and threshold-controlled authorization.
