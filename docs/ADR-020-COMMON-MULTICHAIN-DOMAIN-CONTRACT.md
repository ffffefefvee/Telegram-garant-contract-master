# ADR-020: Common multichain domain contract

Date: 2026-09-01

Status: local candidate; hosted PostgreSQL and full CI gates pending

## Context

TON and Polygon must remain independent settlement networks while exposing a
consistent product vocabulary. The previous adapter boundary normalized only
preparation and reads. It did not bind funding or settlement actions to one
persisted terms/quote version, did not express proof finality, and did not
require exact buyer and seller confirmation before funding.

This gap could allow fee recomputation, stale quote replay, cross-chain asset
substitution, or a UI/API interpretation that treats an observation as
finalized money movement.

## Decision

Freeze domain contract version 1 with explicit, chain-bound representations of:

- network and chain ID;
- asset, allowlisted asset contract/master, and decimals;
- terms version and SHA-256 commitment;
- quote ID/version and SHA-256 commitment;
- exact unsigned atomic amounts and conservation identities;
- chain transaction reference, including asset identity;
- funding status, settlement status, payout availability, balance, and
  reconciliation output.

Every quote commits the exact terms, network, chain, asset, contract/master,
decimals, amount, fee split, buyer total, seller proceeds, and validity window.
The hash is reproduced locally from a canonical field order. Leading-zero,
fractional, negative, expired, non-conserving, or hash-mismatched quotes fail
closed.

The common adapter interface now covers:

```text
prepareEscrow
buildFundingRequest
verifyFunding
release
refund
resolve
readBalance
reconcile
```

Polygon may compose unsigned, role-scoped wallet requests. It does not claim
finality or independent reconciliation until Phase 5. TON rejects every money
action and returns structured unavailability while its readiness flag remains
hard false.

## Authoritative persistence and confirmation

`settlement_quotes` is append-only and versioned per deal.
`settlement_confirmations` is append-only and unique per quote/party. The deal
stores a separate Phase 4 quote pointer; the historical `quote_id` field is not
reinterpreted.

The application locks the deal row when persisting or confirming a quote. It
derives buyer/seller identity from the authenticated user, rejects stale or
substituted confirmation fields, and requires both exact confirmations before
returning an authorizing quote to a funding caller.

PostgreSQL independently enforces:

- quote arithmetic down to one atomic unit;
- complete quote pointers;
- immutable quote and confirmation rows;
- exact buyer and seller confirmation before a native multichain deal becomes
  funded/paid;
- immutable network, chain, asset, asset contract, terms, and quote after
  funding.

Jetton preparation now also requires its quote ID/version/hash to match the
deal's authoritative Phase 4 pointer.

## Security properties

- A transaction reference cannot silently move between networks or assets.
- Observed Polygon state is never represented as cryptographically finalized.
- Missing independent evidence produces an unavailable reconciliation result.
- TON and Polygon adapters do not call or depend on each other's liquidity,
  RPCs, or action paths.
- Conversion and fiat withdrawal remain outside the settlement adapter.
- Funding confirmation in `DealService` replays the agreement gate for native
  multichain deals; missing gate wiring fails closed.
- No production key, signer, or broadcast capability is added.

## Migration and rollback

Migration `1718000000000-FreezeMultichainDomainContract` creates both append-only
tables, quote-pointer columns, foreign/check constraints, and the funded-deal
trigger. The down migration removes only Phase 4 triggers, constraints, columns,
and tables. Rolling back after quote evidence exists discards an audit boundary
and therefore requires an explicit maintenance window and evidence export; it
must not be used to bypass a rejected funding transition.

## Observability and enabling evidence

The normalized results carry explicit `finalized`, evidence hashes, delta, and
unavailable reason fields. Phase 5 monitoring will aggregate the unavailable
reasons and reconciliation deltas by chain.

This ADR does not enable real funds. Advancing the gate requires:

1. the shared conformance suite passing against both adapters;
2. the Phase 4 PostgreSQL migration/trigger suite passing on a clean schema;
3. the complete backend and hosted CI matrices passing;
4. independent review of the domain and migration invariants;
5. subsequent chain-specific testnet, audit, staging, and beta gates.
