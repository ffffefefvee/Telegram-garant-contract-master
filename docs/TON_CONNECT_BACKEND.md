# TON Connect backend contract

Date: 2026-08-17

This slice provides the backend contract that the redesigned Telegram Mini App
and the website will share. It does not select visual behavior and it does not
remove or alter Polygon. Polygon continues to use its independent verified EVM
wallet flow; a TON deal does not require an EVM wallet.

## Runtime configuration

```dotenv
TON_CONNECT_ENABLED=true
TON_CONNECT_PROOF_DOMAIN=app.example.com
TON_CONNECT_NETWORK=-3
TON_CONNECT_PROOF_TTL_SECONDS=300
TON_CONNECT_FUTURE_SKEW_SECONDS=30
```

`TON_CONNECT_PROOF_DOMAIN` is the exact host the wallet signs, without scheme
or path. `TON_CONNECT_NETWORK` is `-239` for mainnet or `-3` for testnet. The
service fails closed when enabled with an unsafe domain, network or time bound.

## Authenticated API

All routes use the existing Bearer JWT. Telegram identity and TON wallet
ownership remain two separate proofs.

### `POST /api/users/me/ton-wallet/challenge`

Returns a random, single-use payload and expiry. The client passes `payload` as
the TON Connect `tonProof` request value. Issuing a newer challenge consumes
older unused challenges for the same user.

```json
{
  "payload": "base64url-encoded-random-value",
  "expiresAt": "2026-08-17T10:05:00.000Z"
}
```

Only the SHA-256 digest is stored in the database.

### `POST /api/users/me/ton-wallet/verify`

The client forwards the account and successful `ton_proof` object returned by
TON Connect:

```json
{
  "account": {
    "address": "0:64-hex-characters",
    "chain": "-3",
    "publicKey": "64-hex-characters",
    "walletStateInit": "base64-boc"
  },
  "proof": {
    "timestamp": 1786957200,
    "domain": { "lengthBytes": 15, "value": "app.example.com" },
    "payload": "the-issued-challenge",
    "signature": "base64-ed25519-signature"
  }
}
```

The verifier checks the exact configured network and domain, UTF-8 byte
lengths, timestamp bounds and unused challenge. It derives the address and
public key from `walletStateInit`, compares the wallet-reported public key, and
then verifies the TON Connect Ed25519 digest. The challenge consume and binding
write commit in one database transaction, so a concurrent replay cannot create
two successful bindings.

Standard wallet contracts v1R1 through v5R1 are supported. Unknown wallet code
is rejected. We will add non-standard-wallet support only with a trusted,
independently verified on-chain `get_public_key` resolver; the client-provided
key is never an acceptable fallback.

### `GET /api/users/me/ton-wallet`

Returns the verified binding for the configured network, or `null`. The
response excludes `walletStateInit` and internal database identifiers.

### `DELETE /api/users/me/ton-wallet`

Removes the binding for the configured network. Existing funded deals retain
their immutable settlement addresses and are not rewritten.

## Transaction request boundary

`buildTonConnectTransactionRequest` produces the same wire object for the Mini
App and website:

```ts
{
  validUntil: number;
  network: '-239' | '-3';
  from: string;
  messages: Array<{
    address: string;
    amount: string;
    payload?: string;
    stateInit?: string;
  }>;
}
```

The backend canonicalizes basechain addresses, requires positive nanotons,
limits request lifetime and message count, and parses payload / StateInit BoCs.
The next funds-flow slice must populate this object exclusively from an
immutable accepted quote, verified participant bindings and an approved native
TON escrow artifact. Clients must not be allowed to override destination,
amount, payload, StateInit, network or sender.

That native-TON composition path is now implemented at
`POST /api/deals/:id/ton-native/funding-request`. It:

- permits only the authenticated buyer of a `pending_payment` native-TON deal;
- requires verified buyer and seller TON bindings on the selected network;
- requires a TON-denominated deal, committed terms and a delivery deadline;
- converts persisted decimal amounts to nanotons without floating-point math;
- commits buyer total, seller payout, platform/refund fees, all role addresses,
  deadlines and the approved code hash into a SHA-256 quote;
- derives and persists the exact escrow address, StateInit, Fund body and
  contract config hash in one transaction; and
- reuses the immutable snapshot on retry while refreshing only `validUntil`.

The route deliberately returns `503` today because `TonEscrowAdapter.isReady()`
is still hard-coded to `false`. Finalized chain ingestion and the reconciliation
code path now exist, but the gate must remain disabled until the independent
source is provisioned, mandatory reconciliation is enabled and release drills
and audits pass.

Additional future-ready configuration:

```dotenv
TON_NATIVE_TREASURY_ADDRESS=0:...
TON_NATIVE_ARBITRATOR_ADDRESS=0:...
TON_NATIVE_FUNDING_WINDOW_SECONDS=900
TON_NATIVE_CONFIRMATION_WINDOW_SECONDS=259200
TON_NATIVE_TRANSACTION_TTL_SECONDS=300
TON_NATIVE_ACTION_VALUE_NANO=50000000
TON_NATIVE_REFUND_FEE_NANO=0
```

### `POST /api/deals/:id/ton-native/action-request`

The authenticated participant supplies an action and, only for a dispute, a
reason:

```json
{ "action": "release", "reason": null }
```

Supported participant actions are `mark_delivered`, `release`, `open_dispute`,
`refund_buyer`, `refund_after_seller_timeout` and
`release_after_buyer_timeout`. The backend derives the required role and
contract state from the immutable preparation, verifies the same committed TON
wallet is still bound to that user, enforces the on-chain deadline, and returns
one exact TON Connect message. Destination, amount, opcode, query ID and sender
cannot be supplied by the client. Retrying returns the same immutable intent.

Like funding, this endpoint currently returns `503` because the native TON
adapter remains hard-disabled. Arbitrator resolution is deliberately not
exposed through this participant endpoint.

### `POST /api/arbitration/decisions/:id/ton-native/resolve-request`

This privileged route prepares the contract's `Resolve` message only after the
assigned human arbitrator's decision is final and its appeal window has ended.
The caller must be an admin/super-admin with a verified TON wallet equal to the
resolver-authority address committed before funding. The backend—not the
client—derives the exact buyer award, seller award, platform fee, decision hash
and payload. A finalized scanner later verifies all three possible payouts
before marking the decision enforced.

The resolver authority is not the dynamically assigned human arbitrator. This
matches the immutable contract configuration and provides a clear production
upgrade path to multisig/threshold enforcement.

## Remaining client and funds-flow work

1. Publish the production TON Connect manifest on the final HTTPS domain.
2. Integrate challenge and proof verification in both clients, restore wallet
   sessions, expose disconnect, and handle wallets without `ton_proof`.
3. Detect embedded-request / gasless capabilities while retaining ordinary
   wallet approval and TON-gas fallback.
4. Funding, participant lifecycle and arbitrator-resolution ingestion now
   validate finalized transactions and exact post-state, require optional
   independent v2/liteserver reconciliation, then apply idempotent ledger/FSM
   effects. Provision and require the secondary source, exercise the
   implemented alerts and dual-authorized recovery, then complete backfill and
   testnet drills before money movement can be enabled.

Scanner configuration (disabled by default):

```dotenv
TON_NATIVE_INGESTION_ENABLED=false
TON_NATIVE_RECONCILIATION_REQUIRED=false
TONCENTER_V3_BASE_URL=
TONCENTER_API_KEY=
TON_LITESERVER_V2_BASE_URL=
TON_LITESERVER_V2_SOURCE=
TON_LITESERVER_V2_API_KEY=
TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS=300000
```

The official network URL is selected automatically when the override is empty.
The funding endpoint remains `503` because ingestion of a deposit is only one
part of a safe escrow lifecycle.

Implementation follows the official [TON proof verification guide](https://docs.ton.org/applications/ton-connect/how-to/ton-proof),
[TON Connect connection guide](https://docs.ton.org/applications/ton-connect/how-to/connect),
and [wallet public-key extraction example](https://docs.ton.org/applications/ton-connect/how-to/sign-data).
