import { Address, beginCell, Cell } from "@ton/core";
import type { TonProvenActiveAccountState } from "./ton-account-state-proof";
import type { TonVerifiedLocalWalletGetterResult } from "./ton-local-wallet-getter";
import {
  composeTonProvenCanonicalWallet,
  TonProvenWalletCompositionError,
} from "./ton-proven-wallet-composition";

const MASTERCHAIN_SHARD = "-9223372036854775808";
const owner = Address.parseRaw(`0:${"11".repeat(32)}`);
const master = Address.parseRaw(`0:${"22".repeat(32)}`);
const walletAddress = Address.parseRaw(`0:${"33".repeat(32)}`);
const other = Address.parseRaw(`0:${"44".repeat(32)}`);
const walletCode = beginCell().storeUint(0xcafe, 16).endCell();
const otherCode = beginCell().storeUint(0xbeef, 16).endCell();

function anchor() {
  return {
    workchain: -1,
    shard: MASTERCHAIN_SHARD,
    seqno: 120,
    rootHash: "55".repeat(32),
    fileHash: "66".repeat(32),
  };
}

function getter(): TonVerifiedLocalWalletGetterResult {
  return {
    kind: "TON_VERIFIED_LOCAL_WALLET_GETTER_RESULT",
    masterAccountStateProofVerified: true,
    tvmEnvironmentProofVerified: true,
    localGetterExecutionVerified: true,
    canonicalWalletAddressVerified: true,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: -3,
    finalizedByMasterchainBlock: anchor(),
    masterAccountBlock: {
      workchain: 0,
      shard: MASTERCHAIN_SHARD,
      seqno: 70,
      rootHash: "77".repeat(32),
      fileHash: "88".repeat(32),
    },
    masterAddress: master.toRawString(),
    ownerAddress: owner.toRawString(),
    canonicalWalletAddress: walletAddress.toRawString(),
    methodId: 103289,
    gasLimit: "10000000",
    gasUsed: "453",
    executorPolicyVersion: "ton-local-getter-v1/sandbox-0.40.0",
    emulatorCommitHash: "d97fc197f07bb0070eeb3e6fcb8137a240ea5365",
    emulatorCommitDate: "2025-11-21 20:36:54 +0300",
    configurationRootHash: "99".repeat(32),
    masterAccountStateHash: "aa".repeat(32),
    masterCodeHash: "bb".repeat(32),
    masterDataHash: "cc".repeat(32),
    getterInputHash: "dd".repeat(32),
    deterministicRandomSeedHash: "ee".repeat(32),
    executionTranscriptHash: "ff".repeat(32),
  };
}

function walletData(
  storedOwner = owner,
  storedMaster = master,
  embeddedCode = walletCode,
  trailing = false,
): Cell {
  const builder = beginCell()
    .storeCoins(123_456n)
    .storeAddress(storedOwner)
    .storeAddress(storedMaster)
    .storeRef(embeddedCode);
  if (trailing) builder.storeBit(true);
  return builder.endCell();
}

function wallet(data = walletData(), code = walletCode): TonProvenActiveAccountState {
  const accountStateRoot = beginCell()
    .storeUint(0xa, 4)
    .storeRef(code)
    .storeRef(data)
    .endCell();
  return {
    kind: "TON_PROVEN_ACTIVE_ACCOUNT_STATE",
    shardBlockFinalityProven: true,
    shardStateProofVerified: true,
    accountDictionaryInclusionVerified: true,
    accountStateProofVerified: true,
    transactionInclusionVerified: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: -3,
    finalizedByMasterchainBlock: anchor(),
    block: {
      workchain: 0,
      shard: MASTERCHAIN_SHARD,
      seqno: 77,
      rootHash: "12".repeat(32),
      fileHash: "34".repeat(32),
    },
    generatedAtUnix: 1_800_000_190,
    blockEndLt: "20000",
    accountAddress: walletAddress.toRawString(),
    shardStateHash: "56".repeat(32),
    shardStateProofRootHash: "67".repeat(32),
    accountProofBocHash: "78".repeat(32),
    accountStateHash: accountStateRoot.hash(0).toString("hex"),
    accountStateBocHash: "89".repeat(32),
    lastTransactionHash: "9a".repeat(32),
    lastTransactionLt: "700",
    balanceNanotons: "2000000000",
    codeHash: code.hash(0).toString("hex"),
    dataHash: data.hash(0).toString("hex"),
    accountStateRoot,
    code,
    data,
  };
}

function expectation() {
  return {
    ownerAddress: owner.toRawString(),
    masterAddress: master.toRawString(),
    candidateWalletAddress: walletAddress.toRawString(),
    pinnedWalletCodeHash: walletCode.hash(0).toString("hex"),
  };
}

function prunedBranch(cell: Cell): Cell {
  return beginCell()
    .storeUint(1, 8)
    .storeUint(1, 8)
    .storeBuffer(cell.hash(0))
    .storeUint(cell.depth(0), 16)
    .endCell({ exotic: true });
}

describe("TON proven canonical-wallet composition", () => {
  it("composes the local getter with a proven wallet and remains non-authorizing", () => {
    const result = composeTonProvenCanonicalWallet(
      getter(),
      wallet(),
      expectation(),
    );
    expect(result).toMatchObject({
      kind: "TON_PROVEN_CANONICAL_WALLET_COMPOSITION",
      localGetterExecutionVerified: true,
      canonicalWalletAddressVerified: true,
      walletAccountStateProofVerified: true,
      walletIdentityVerified: true,
      walletDataVerified: true,
      activeCodeHashVerified: true,
      embeddedCodeHashVerified: true,
      sealPreconditionsVerified: true,
      sealingAuthorized: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      ownerAddress: owner.toRawString(),
      masterAddress: master.toRawString(),
      walletAddress: walletAddress.toRawString(),
      jettonBalance: "123456",
      walletCodeHash: walletCode.hash(0).toString("hex"),
    });
    expect(result.proofCompositionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a deterministic audit-only composition hash", () => {
    const first = composeTonProvenCanonicalWallet(getter(), wallet(), expectation());
    const second = composeTonProvenCanonicalWallet(getter(), wallet(), expectation());
    expect(second.proofCompositionHash).toBe(first.proofCompositionHash);
  });

  it("rejects a getter result from another finalized anchor", () => {
    const input = getter();
    input.finalizedByMasterchainBlock = {
      ...input.finalizedByMasterchainBlock,
      seqno: 121,
    };
    expect(() =>
      composeTonProvenCanonicalWallet(input, wallet(), expectation()),
    ).toThrow("different finalized anchors");
  });

  it("rejects a getter result for another network", () => {
    const input = getter();
    input.networkGlobalId = -239;
    expect(() =>
      composeTonProvenCanonicalWallet(input, wallet(), expectation()),
    ).toThrow("different finalized anchors");
  });

  it.each([
    ["owner", "ownerAddress", other.toRawString()],
    ["master", "masterAddress", other.toRawString()],
    ["candidate", "canonicalWalletAddress", other.toRawString()],
  ] as const)("rejects substituted getter %s", (_label, field, value) => {
    const input = getter();
    input[field] = value;
    expect(() =>
      composeTonProvenCanonicalWallet(input, wallet(), expectation()),
    ).toThrow("seal expectation");
  });

  it("rejects a proven account at another wallet address", () => {
    const input = wallet();
    input.accountAddress = other.toRawString();
    expect(() =>
      composeTonProvenCanonicalWallet(getter(), input, expectation()),
    ).toThrow("account address");
  });

  it("rejects a wallet whose active code is not pinned", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(
        getter(),
        wallet(walletData(other, master, otherCode), otherCode),
        expectation(),
      ),
    ).toThrow("active wallet code hash");
  });

  it.each([
    ["owner", walletData(other, master)],
    ["master", walletData(owner, other)],
  ])("rejects substituted wallet %s", (_label, data) => {
    expect(() =>
      composeTonProvenCanonicalWallet(getter(), wallet(data), expectation()),
    ).toThrow(`wallet ${_label}`);
  });

  it("rejects embedded code different from the active code", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(
        getter(),
        wallet(walletData(owner, master, otherCode)),
        expectation(),
      ),
    ).toThrow("embedded wallet code");
  });

  it("rejects trailing wallet-data fields", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(
        getter(),
        wallet(walletData(owner, master, walletCode, true)),
        expectation(),
      ),
    ).toThrow("wallet data is malformed");
  });

  it("rejects a wallet-data cell hidden by pruning", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(
        getter(),
        wallet(prunedBranch(walletData())),
        expectation(),
      ),
    ).toThrow("ordinary cells");
  });

  it("rejects an embedded code cell hidden by pruning", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(
        getter(),
        wallet(walletData(owner, master, prunedBranch(walletCode))),
        expectation(),
      ),
    ).toThrow("ordinary cell");
  });

  it("rejects drift in the proven wallet data commitment", () => {
    const input = wallet();
    input.dataHash = "ab".repeat(32);
    expect(() =>
      composeTonProvenCanonicalWallet(getter(), input, expectation()),
    ).toThrow("proven hashes");
  });

  it("rejects a malformed pinned code hash", () => {
    expect(() =>
      composeTonProvenCanonicalWallet(getter(), wallet(), {
        ...expectation(),
        pinnedWalletCodeHash: "0".repeat(64),
      }),
    ).toThrow("pinnedWalletCodeHash");
  });

  it("uses a dedicated error for forged local-getter provenance", () => {
    const input = getter();
    input.authorizationAllowed = true as false;
    expect(() =>
      composeTonProvenCanonicalWallet(input, wallet(), expectation()),
    ).toThrow(TonProvenWalletCompositionError);
  });

  it("rejects forged wallet-proof provenance", () => {
    const input = wallet();
    input.transactionInclusionVerified = true as false;
    expect(() =>
      composeTonProvenCanonicalWallet(getter(), input, expectation()),
    ).toThrow("wallet-account proof provenance");
  });
});
