import { Address, beginCell, Cell } from "@ton/core";
import { defaultConfig } from "@ton/sandbox";
import type { TonProvenActiveAccountState } from "./ton-account-state-proof";
import {
  executeTonCanonicalWalletGetter,
  TonLocalWalletGetterError,
} from "./ton-local-wallet-getter";
import type { TonProvenTvmEnvironment } from "./ton-tvm-environment-proof";

const MASTERCHAIN_SHARD = "-9223372036854775808";
const masterAddress = Address.parseRaw(`0:${"11".repeat(32)}`);
const ownerAddress = Address.parseRaw(`0:${"22".repeat(32)}`);
const walletAddress = Address.parseRaw(`0:${"33".repeat(32)}`);
const otherWalletAddress = Address.parseRaw(`0:${"44".repeat(32)}`);
const getterCode = Cell.fromBase64(
  "te6ccgEBBAEAIAABFP8A9KQT9LzyyAsBAgFiAgMABtBfAwANoSbyYdqJoQ==",
);
const ownerEchoGetterCode = Cell.fromBase64(
  "te6ccgEBBAEAHAABFP8A9KQT9LzyyAsBAgFiAgMABtBfAwAFoSbz",
);
const trailingStackGetterCode = Cell.fromBase64(
  "te6ccgEBBAEAHQABFP8A9KQT9LzyyAsBAgFiAgMABtBfAwAHoSbyQQ==",
);
const getterData = beginCell().storeAddress(walletAddress).endCell();
const libraryWalletCode = beginCell()
  .storeUint(2, 8)
  .storeBuffer(Buffer.from("ab".repeat(32), "hex"))
  .endCell({ exotic: true });
const configurationRoot = Cell.fromBase64(defaultConfig);

function anchor() {
  return {
    workchain: -1,
    shard: MASTERCHAIN_SHARD,
    seqno: 120,
    rootHash: "11".repeat(32),
    fileHash: "22".repeat(32),
  };
}

function provenMaster(): TonProvenActiveAccountState {
  const accountStateRoot = beginCell()
    .storeUint(0xa, 4)
    .storeRef(getterCode)
    .storeRef(getterData)
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
      rootHash: "33".repeat(32),
      fileHash: "44".repeat(32),
    },
    generatedAtUnix: 1_800_000_190,
    blockEndLt: "20000",
    accountAddress: masterAddress.toRawString(),
    shardStateHash: "55".repeat(32),
    shardStateProofRootHash: "66".repeat(32),
    accountProofBocHash: "77".repeat(32),
    accountStateHash: accountStateRoot.hash(0).toString("hex"),
    accountStateBocHash: "88".repeat(32),
    lastTransactionHash: "99".repeat(32),
    lastTransactionLt: "700",
    balanceNanotons: "2000000000",
    codeHash: getterCode.hash(0).toString("hex"),
    dataHash: getterData.hash(0).toString("hex"),
    accountStateRoot,
    code: getterCode,
    data: getterData,
  };
}

function provenEnvironment(): TonProvenTvmEnvironment {
  return {
    kind: "TON_PROVEN_TVM_ENVIRONMENT",
    masterchainFinalityProven: true,
    masterchainStateProofVerified: true,
    configurationDictionaryProofVerified: true,
    configurationComplete: true,
    localGetterExecutionVerified: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: -3,
    masterchainBlock: anchor(),
    masterchainStateHash: "aa".repeat(32),
    masterchainStateProofRootHash: "bb".repeat(32),
    generatedAtUnix: 1_800_000_200,
    generatedLt: "30000",
    configurationAddress: "cc".repeat(32),
    configurationRootHash: configurationRoot.hash(0).toString("hex"),
    configurationRoot,
  };
}

function replaceMasterCode(
  master: TonProvenActiveAccountState,
  replacement: Cell,
): void {
  master.code = replacement;
  master.codeHash = replacement.hash(0).toString("hex");
  master.accountStateRoot = beginCell()
    .storeUint(0xa, 4)
    .storeRef(replacement)
    .storeRef(master.data)
    .endCell();
  master.accountStateHash = master.accountStateRoot.hash(0).toString("hex");
}

function stablecoinMaster(): TonProvenActiveAccountState {
  const master = provenMaster();
  const data = beginCell()
    .storeCoins(1_000_000n)
    .storeAddress(ownerAddress)
    .storeAddress(null)
    .storeRef(libraryWalletCode)
    .storeRef(beginCell().storeUint(0, 8).endCell())
    .endCell();
  replaceMasterCode(master, ownerEchoGetterCode);
  master.data = data;
  master.dataHash = data.hash(0).toString("hex");
  master.accountStateRoot = beginCell()
    .storeUint(0xa, 4)
    .storeRef(master.code)
    .storeRef(data)
    .endCell();
  master.accountStateHash = master.accountStateRoot.hash(0).toString("hex");
  return master;
}

function execute(
  master = provenMaster(),
  environment = provenEnvironment(),
  candidateWalletAddress = walletAddress.toRawString(),
) {
  return executeTonCanonicalWalletGetter(master, environment, {
    masterAddress: masterAddress.toRawString(),
    ownerAddress: ownerAddress.toRawString(),
    candidateWalletAddress,
    walletContractProfile: "tep74-reference-wallet-v1",
    gasLimit: 10_000_000n,
  });
}

describe("TON local canonical-wallet getter", () => {
  jest.setTimeout(30_000);

  it("executes get_wallet_address locally and preserves the non-authorizing boundary", async () => {
    const result = await execute();
    expect(result).toMatchObject({
      kind: "TON_VERIFIED_LOCAL_WALLET_GETTER_RESULT",
      masterAccountStateProofVerified: true,
      tvmEnvironmentProofVerified: true,
      localGetterExecutionVerified: true,
      canonicalWalletAddressVerified: true,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: -3,
      masterAddress: masterAddress.toRawString(),
      ownerAddress: ownerAddress.toRawString(),
      canonicalWalletAddress: walletAddress.toRawString(),
      executorPolicyVersion: "ton-local-getter-v1/sandbox-0.40.0",
      configurationRootHash: configurationRoot.hash(0).toString("hex"),
      masterCodeHash: getterCode.hash(0).toString("hex"),
      masterDataHash: getterData.hash(0).toString("hex"),
    });
    expect(result.gasUsed).toMatch(/^[1-9][0-9]*$/);
    expect(result.executionTranscriptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same proven state and policy", async () => {
    const first = await execute();
    const second = await execute();
    expect(second).toMatchObject({
      getterInputHash: first.getterInputHash,
      deterministicRandomSeedHash: first.deterministicRandomSeedHash,
      gasUsed: first.gasUsed,
      executionTranscriptHash: first.executionTranscriptHash,
    });
  });

  it("passes the exact owner slice to the local getter", async () => {
    const master = provenMaster();
    replaceMasterCode(master, ownerEchoGetterCode);
    const result = await execute(
      master,
      provenEnvironment(),
      ownerAddress.toRawString(),
    );
    expect(result.canonicalWalletAddress).toBe(ownerAddress.toRawString());
  });

  it("binds the stablecoin wallet library reference from proven master data", async () => {
    const result = await executeTonCanonicalWalletGetter(
      stablecoinMaster(),
      provenEnvironment(),
      {
        masterAddress: masterAddress.toRawString(),
        ownerAddress: ownerAddress.toRawString(),
        candidateWalletAddress: ownerAddress.toRawString(),
        walletContractProfile: "ton-stablecoin-governance-wallet-v1",
        gasLimit: 10_000_000n,
      },
    );
    expect(result).toMatchObject({
      walletContractProfile: "ton-stablecoin-governance-wallet-v1",
      masterWalletCodeHash: libraryWalletCode.hash(0).toString("hex"),
      authorizationAllowed: false,
    });
  });

  it("rejects a getter that returns an address plus a trailing stack item", async () => {
    const master = provenMaster();
    replaceMasterCode(master, trailingStackGetterCode);
    await expect(
      execute(master, provenEnvironment(), ownerAddress.toRawString()),
    ).rejects.toThrow("trailing stack items");
  });

  it("rejects a candidate different from the locally derived wallet", async () => {
    await expect(execute(undefined, undefined, otherWalletAddress.toRawString()))
      .rejects.toThrow("does not match");
  });

  it("rejects a master account paired with configuration from another finalized anchor", async () => {
    const environment = provenEnvironment();
    environment.masterchainBlock = {
      ...environment.masterchainBlock,
      rootHash: "dd".repeat(32),
    };
    await expect(execute(provenMaster(), environment)).rejects.toThrow(
      "different finalized anchors",
    );
  });

  it("rejects a substituted expected master address", async () => {
    await expect(
      executeTonCanonicalWalletGetter(provenMaster(), provenEnvironment(), {
        masterAddress: ownerAddress.toRawString(),
        ownerAddress: ownerAddress.toRawString(),
        candidateWalletAddress: walletAddress.toRawString(),
        walletContractProfile: "tep74-reference-wallet-v1",
        gasLimit: 10_000_000n,
      }),
    ).rejects.toThrow("does not match the proven account");
  });

  it("rejects drift in the proven master code commitment", async () => {
    const master = provenMaster();
    master.codeHash = "ee".repeat(32);
    await expect(execute(master)).rejects.toThrow("proven hashes");
  });

  it("rejects drift in the proven configuration commitment", async () => {
    const environment = provenEnvironment();
    environment.configurationRootHash = "ff".repeat(32);
    await expect(execute(provenMaster(), environment)).rejects.toThrow(
      "proven hash",
    );
  });

  it.each([0n, -1n, 100_000_001n])(
    "rejects gas policy value %s",
    async (gasLimit) => {
      await expect(
        executeTonCanonicalWalletGetter(provenMaster(), provenEnvironment(), {
          masterAddress: masterAddress.toRawString(),
          ownerAddress: ownerAddress.toRawString(),
          candidateWalletAddress: walletAddress.toRawString(),
          walletContractProfile: "tep74-reference-wallet-v1",
          gasLimit,
        }),
      ).rejects.toThrow("gasLimit");
    },
  );

  it("rejects an execution that cannot complete within the gas policy", async () => {
    await expect(
      executeTonCanonicalWalletGetter(provenMaster(), provenEnvironment(), {
        masterAddress: masterAddress.toRawString(),
        ownerAddress: ownerAddress.toRawString(),
        candidateWalletAddress: walletAddress.toRawString(),
        walletContractProfile: "tep74-reference-wallet-v1",
        gasLimit: 1n,
      }),
    ).rejects.toThrow("local getter");
  });

  it("rejects malformed address encodings before execution", async () => {
    await expect(
      executeTonCanonicalWalletGetter(provenMaster(), provenEnvironment(), {
        masterAddress: `0:${"AA".repeat(32)}`,
        ownerAddress: ownerAddress.toRawString(),
        candidateWalletAddress: walletAddress.toRawString(),
        walletContractProfile: "tep74-reference-wallet-v1",
        gasLimit: 10_000_000n,
      }),
    ).rejects.toThrow("canonical raw lowercase");
  });

  it("uses a dedicated error for forged proof provenance", async () => {
    const master = provenMaster();
    master.authorizationAllowed = true as false;
    await expect(execute(master)).rejects.toThrow(TonLocalWalletGetterError);
  });
});
