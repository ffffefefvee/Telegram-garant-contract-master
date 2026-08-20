# TON Jetton wallet-seal verification boundary

`TonJettonEscrow` cannot include its Jetton wallet address in `StateInit`:
the wallet address depends on the escrow address, while the escrow address
depends on `StateInit`. The contract therefore pins the allowlisted master and
wallet-code hash first, then permits an immutable initializer to seal one
canonical wallet after deployment.

`ton-jetton-wallet-seal-verifier.ts` is the pure, unwired backend preflight for
that seal. Its expectation contains the exact network, escrow owner,
allowlisted master, candidate wallet, pinned wallet-code hash, and two
configured collector identities. A source/operator pair must be distinct from
the other pair; observations cannot declare their own independence.

For each collector, the preflight locally checks:

- exact mainnet/testnet and masterchain/shard block identities;
- raw `get_wallet_address` owner-argument and result cells, with exit code zero;
- the result equals the candidate wallet for the exact escrow owner;
- a raw active wallet `ShardAccount`, including its address, owner and master;
- the active StateInit code hash and embedded wallet-code hash both equal the
  immutable pinned hash;
- no trailing fields in the getter cells, account, or TEP-74 wallet data; and
- full agreement between the two collectors.

The result intentionally remains `accepted: false`, `sealingAuthorized: false`
and `reasonCode: MASTERCHAIN_PROOF_REQUIRED`. The verifier emits a
domain-separated `structuralEvidenceHash` for audit/deduplication, but
`verificationEvidenceHash` remains `null`. The structural hash must never be
placed in `SealCanonicalJettonWallet`, because the contract can only test that
the supplied hash is nonzero.

Seal authorization remains blocked until the backend verifies the masterchain
block proof, shard-block inclusion, account-state proof, and locally executes
`get_wallet_address` against the proven master state. Only that completed proof
pipeline may define and emit the separate verification-evidence commitment.
No signer, broadcaster, adapter wiring, or durable ingestion is included here.
