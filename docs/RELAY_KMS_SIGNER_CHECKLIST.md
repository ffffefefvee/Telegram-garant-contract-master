# Relay Signer → Web3Signer: checklist

Web3Signer v26.4.2 is the selected external signer for Polygon Amoy. It runs
in `eth1` mode with `--chain-id=80002`; the loaded `SECP256K1 file-raw` key
has relay address `0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf`.

Vault Transit is not applicable: its open-source Transit engine does not
support the required `ecdsa-p256k1` key type.

## 1. Expose the correct API safely

- [ ] Enable Web3Signer's execution-layer **JSON-RPC** listener. The REST API
      on port 9000 performs only basic ETH1 signing and does not return a complete
      Ethereum transaction; it is not the application integration endpoint.
- [ ] Point `WEB3SIGNER_RPC_URL` to the JSON-RPC endpoint (Web3Signer's
      documented default is `http://127.0.0.1:8545`). If a different port is used,
      verify it answers `eth_accounts`.
- [ ] Bind that listener to loopback or a private network only. Never publish
      it to the internet.
- [ ] In non-local environments, use mTLS or an authenticated reverse proxy,
      restrict network access to user-service, and retain request audit logs.
- [ ] Use a different relay key for staging and production. The Amoy key must
      remain testnet-only.

## 2. Configure the service

- [ ] Set `RELAY_SIGNER=web3signer`.
- [ ] Set `WEB3SIGNER_RPC_URL=http://<private-host>:<json-rpc-port>`.
- [ ] Set `WEB3SIGNER_ADDRESS=0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf`.
- [ ] Set `BLOCKCHAIN_CHAIN_ID=80002` and an Amoy RPC URL.
- [ ] Remove `BLOCKCHAIN_PRIVATE_KEY` from this target environment.

The adapter verifies `eth_accounts` at startup, then verifies that every
returned signed transaction was signed by this exact address and for chain
`80002`. A mismatch leaves the blockchain provider unavailable; it cannot
silently fall back to a local key.

## 3. Fund and authorize the Amoy relay

- [ ] Fund the relay with a small Amoy POL balance for gas.
- [ ] Mint/transfer the minimum test USDT float needed for one controlled
      `forwardAndFund` test.
- [ ] Deploy/configure the Amoy factory, treasury, registry, and test USDT
      addresses; grant the relay only the contract roles it needs.
- [ ] Verify the on-chain fee configuration matches the backend fee grid.

## 4. Sandbox acceptance

- [ ] Confirm startup logs `BlockchainProvider connected` with the relay
      address above and `type=web3signer`.
- [ ] Submit `eth_accounts` directly to Web3Signer and confirm the address is
      present.
- [ ] With `MONEY_EGRESS_ENABLED` still false, verify the normal application
      flow never signs or broadcasts a transaction.
- [ ] In an isolated test deployment, enable egress only after migrations and
      reconciliation are active, then run one create-escrow and one
      `forwardAndFund` transaction.
- [ ] Stop Web3Signer or remove the key and verify the payment becomes
      retryable/reviewable without a duplicate transfer.

## Still required before any testnet funds move

- [ ] Complete the remaining payment/reconciliation, managed evidence-storage,
      dependency-upgrade, and live Postgres multi-replica verification gates.
- [ ] Keep testnet funds minimal and never provide a private key through chat.
