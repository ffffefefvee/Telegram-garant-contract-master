import { Account, Address, beginCell, Cell, storeAccount } from "@ton/core";
import {
  TonWalletSealObservation,
  TonWalletSealVerifierInput,
  validateTonJettonWalletSealEvidence,
} from "./ton-jetton-wallet-seal-verifier";

const owner = Address.parseRaw(`0:${"11".repeat(32)}`);
const master = Address.parseRaw(`0:${"22".repeat(32)}`);
const wallet = Address.parseRaw(`0:${"33".repeat(32)}`);
const other = Address.parseRaw(`0:${"44".repeat(32)}`);
const walletCode = beginCell().storeUint(0xcafe, 16).endCell();
const otherCode = beginCell().storeUint(0xbabe, 16).endCell();

function addressBoc(address: Address, trailing = false): string {
  const builder = beginCell().storeAddress(address);
  if (trailing) builder.storeBit(true);
  return builder.endCell().toBoc().toString("base64");
}

function walletShardAccountBoc(input?: {
  wallet?: Address;
  owner?: Address;
  master?: Address;
  activeCode?: Cell;
  embeddedCode?: Cell;
  dataTrailing?: boolean;
  accountTrailing?: boolean;
  accountLastTransactionLt?: bigint;
  shardLastTransactionLt?: bigint;
  shardLastTransactionHash?: bigint;
}): string {
  const activeCode = input?.activeCode ?? walletCode;
  const dataBuilder = beginCell()
    .storeCoins(123_000_000n)
    .storeAddress(input?.owner ?? owner)
    .storeAddress(input?.master ?? master)
    .storeRef(input?.embeddedCode ?? activeCode);
  if (input?.dataTrailing) dataBuilder.storeBit(true);
  const account: Account = {
    addr: input?.wallet ?? wallet,
    storageStats: {
      used: { cells: 2n, bits: 512n },
      storageExtra: null,
      lastPaid: 1_700_000_000,
    },
    storage: {
      lastTransLt: input?.accountLastTransactionLt ?? 700n,
      balance: { coins: 1_000_000_000n },
      state: {
        type: "active",
        state: { code: activeCode, data: dataBuilder.endCell() },
      },
    },
  };
  const accountBuilder = beginCell()
    .storeBit(true)
    .store(storeAccount(account));
  if (input?.accountTrailing) accountBuilder.storeBit(true);
  return beginCell()
    .storeRef(accountBuilder.endCell())
    .storeUint(
      input?.shardLastTransactionHash ?? BigInt(`0x${"55".repeat(32)}`),
      256,
    )
    .storeUint(input?.shardLastTransactionLt ?? 700n, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

function block(workchain: number, shard: string, seqno: number, digit: string) {
  return {
    workchain,
    shard,
    seqno,
    rootHash: digit.repeat(64),
    fileHash: (digit === "f" ? "e" : "f").repeat(64),
  };
}

function observation(
  sourceId: string,
  operatorId: string,
): TonWalletSealObservation {
  return {
    sourceId,
    operatorId,
    network: "testnet",
    masterchainBlock: block(-1, "-9223372036854775808", 123, "a"),
    masterShardBlock: block(0, "-4611686018427387904", 456, "b"),
    walletShardBlock: block(0, "4611686018427387904", 789, "c"),
    masterGetWalletAddress: {
      exitCode: 0,
      ownerArgumentBocBase64: addressBoc(owner),
      resultBocBase64: addressBoc(wallet),
    },
    walletShardAccountBocBase64: walletShardAccountBoc(),
  };
}

function validInput(): TonWalletSealVerifierInput {
  return {
    expectation: {
      network: "testnet",
      escrowOwnerAddress: owner.toRawString(),
      allowlistedMasterAddress: master.toRawString(),
      candidateWalletAddress: wallet.toRawString(),
      pinnedWalletCodeHash: walletCode.hash().toString("hex"),
      collectors: [
        { sourceId: "tonapi-a", operatorId: "operator-a" },
        { sourceId: "toncenter-b", operatorId: "operator-b" },
      ],
    },
    observations: [
      observation("tonapi-a", "operator-a"),
      observation("toncenter-b", "operator-b"),
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("TON Jetton canonical wallet seal evidence", () => {
  it("emits a deterministic structural commitment but fails closed without proofs", () => {
    const input = validInput();
    const result = validateTonJettonWalletSealEvidence(input);
    expect(result).toMatchObject({
      accepted: false,
      sealingAuthorized: false,
      structuralChecksPassed: true,
      reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
      escrowOwnerAddress: owner.toRawString(),
      masterAddress: master.toRawString(),
      walletAddress: wallet.toRawString(),
      walletCodeHash: walletCode.hash().toString("hex"),
    });
    expect(result.structuralEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.structuralEvidenceHash).toBe(
      "bef1f1247f5cd907a7e227f3f789027aa4e506ad98fc0812db778d023fcee5dc",
    );
    expect(result.structuralEvidenceHash).not.toBe("0".repeat(64));
    expect(result.verificationEvidenceHash).toBeNull();
    expect(result.remainingChecks).toEqual([
      "VERIFIED_MASTERCHAIN_BLOCK_PROOF",
      "VERIFIED_SHARD_BLOCK_INCLUSION",
      "VERIFIED_ACCOUNT_STATE_PROOF",
      "LOCAL_GET_WALLET_ADDRESS_EXECUTION",
    ]);

    const reversed = clone(input);
    reversed.observations.reverse();
    expect(
      validateTonJettonWalletSealEvidence(reversed).structuralEvidenceHash,
    ).toBe(result.structuralEvidenceHash);
  });

  it("binds the network into the evidence commitment", () => {
    const testnet = validInput();
    const mainnet = clone(testnet);
    mainnet.expectation.network = "mainnet";
    mainnet.observations[0].network = "mainnet";
    mainnet.observations[1].network = "mainnet";
    expect(
      validateTonJettonWalletSealEvidence(mainnet).structuralEvidenceHash,
    ).not.toBe(
      validateTonJettonWalletSealEvidence(testnet).structuralEvidenceHash,
    );
  });

  it.each([
    ["source", "sourceId"],
    ["operator", "operatorId"],
  ])("rejects collectors sharing one %s identity", (_label, key) => {
    const input = validInput() as unknown as Record<string, any>;
    input.expectation.collectors[1][key] = input.expectation.collectors[0][key];
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_EXPECTATION",
    );
  });

  it("rejects the zero wallet-code commitment reserved by the contract", () => {
    const input = validInput();
    input.expectation.pinnedWalletCodeHash = "0".repeat(64);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_EXPECTATION",
    );
  });

  it("rejects caller-declared independence or finality flags", () => {
    const independence = clone(validInput()) as unknown as Record<string, any>;
    independence.observations[0].independent = true;
    expect(validateTonJettonWalletSealEvidence(independence).reasonCode).toBe(
      "COLLECTOR_IDENTITY_MISMATCH",
    );

    const finality = clone(validInput()) as unknown as Record<string, any>;
    finality.observations[0].finalized = true;
    expect(validateTonJettonWalletSealEvidence(finality).reasonCode).toBe(
      "COLLECTOR_IDENTITY_MISMATCH",
    );
  });

  it("rejects evidence from an unconfigured collector", () => {
    const input = validInput();
    input.observations[1].sourceId = "attacker-source";
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "CONFIGURED_COLLECTOR_EVIDENCE_MISSING",
    );
  });

  it("rejects duplicate collector evidence", () => {
    const input = validInput();
    input.observations[1].sourceId = input.observations[0].sourceId;
    input.observations[1].operatorId = input.observations[0].operatorId;
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "DUPLICATE_COLLECTOR_EVIDENCE",
    );
  });

  it("rejects a network mismatch", () => {
    const input = validInput();
    input.observations[0].network = "mainnet";
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "NETWORK_MISMATCH",
    );
  });

  it("rejects block identities outside the canonical ranges", () => {
    const input = validInput();
    input.observations[0].masterchainBlock.shard = "9223372036854775808";
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_BLOCK_IDENTITY",
    );
  });

  it.each(["rootHash", "fileHash"])(
    "rejects a zero %s block commitment",
    (field) => {
      const input = validInput() as unknown as Record<string, any>;
      input.observations[0].masterchainBlock[field] = "0".repeat(64);
      expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
        "INVALID_BLOCK_IDENTITY",
      );
    },
  );

  it("rejects a non-masterchain anchor", () => {
    const input = validInput();
    input.observations[0].masterchainBlock.workchain = 0;
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_MASTERCHAIN_BLOCK",
    );
  });

  it("rejects a non-canonical masterchain shard", () => {
    const input = validInput();
    input.observations[0].masterchainBlock.shard = "0";
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_MASTERCHAIN_BLOCK",
    );
  });

  it("rejects source disagreement on any block identity", () => {
    const input = validInput();
    input.observations[1].walletShardBlock.seqno += 1;
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "COLLECTOR_EVIDENCE_DISAGREEMENT",
    );
  });

  it("rejects a getter call for a different owner", () => {
    const input = validInput();
    input.observations[0].masterGetWalletAddress.ownerArgumentBocBase64 =
      addressBoc(other);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "GETTER_OWNER_MISMATCH",
    );
  });

  it("rejects a getter result for a different wallet", () => {
    const input = validInput();
    input.observations[0].masterGetWalletAddress.resultBocBase64 =
      addressBoc(other);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "GETTER_WALLET_MISMATCH",
    );
  });

  it.each([
    [
      "non-zero exit",
      (input: TonWalletSealVerifierInput) => {
        input.observations[0].masterGetWalletAddress.exitCode = 1;
      },
    ],
    [
      "malformed BOC",
      (input: TonWalletSealVerifierInput) => {
        input.observations[0].masterGetWalletAddress.resultBocBase64 = "AAAA";
      },
    ],
    [
      "trailing result data",
      (input: TonWalletSealVerifierInput) => {
        input.observations[0].masterGetWalletAddress.resultBocBase64 =
          addressBoc(wallet, true);
      },
    ],
  ])("rejects an invalid getter result: %s", (_label, mutate) => {
    const input = validInput();
    mutate(input);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_GET_WALLET_ADDRESS_RESULT",
    );
  });

  it.each([
    ["wallet address", "WALLET_ACCOUNT_ADDRESS_MISMATCH", { wallet: other }],
    ["owner", "WALLET_OWNER_MISMATCH", { owner: other }],
    ["master", "WALLET_MASTER_MISMATCH", { master: other }],
    ["active code", "WALLET_CODE_HASH_MISMATCH", { activeCode: otherCode }],
  ])("rejects a mismatched wallet %s", (_label, reasonCode, options) => {
    const input = validInput();
    input.observations[0].walletShardAccountBocBase64 =
      walletShardAccountBoc(options);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      reasonCode,
    );
  });

  it("rejects disagreement between active and embedded wallet code", () => {
    const input = validInput();
    input.observations[0].walletShardAccountBocBase64 = walletShardAccountBoc({
      embeddedCode: otherCode,
    });
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_WALLET_ACCOUNT_BOC",
    );
  });

  it.each([
    ["wallet data", { dataTrailing: true }],
    ["account state", { accountTrailing: true }],
  ])("rejects trailing %s fields", (_label, options) => {
    const input = validInput();
    input.observations[0].walletShardAccountBocBase64 =
      walletShardAccountBoc(options);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_WALLET_ACCOUNT_BOC",
    );
  });

  it.each([
    ["zero transaction hash", { shardLastTransactionHash: 0n }],
    ["zero transaction LT", { shardLastTransactionLt: 0n }],
    [
      "inconsistent transaction LT",
      { accountLastTransactionLt: 699n, shardLastTransactionLt: 700n },
    ],
  ])("rejects %s in raw ShardAccount evidence", (_label, options) => {
    const input = validInput();
    input.observations[0].walletShardAccountBocBase64 =
      walletShardAccountBoc(options);
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "INVALID_WALLET_ACCOUNT_BOC",
    );
  });

  it("rejects arbitrary decoded wallet fields instead of raw account state", () => {
    const input = clone(validInput()) as unknown as Record<string, any>;
    input.observations[0].walletData = {
      ownerAddress: owner.toRawString(),
      masterAddress: master.toRawString(),
    };
    expect(validateTonJettonWalletSealEvidence(input).reasonCode).toBe(
      "COLLECTOR_IDENTITY_MISMATCH",
    );
  });

  it("rejects malformed top-level input without throwing", () => {
    expect(validateTonJettonWalletSealEvidence(null).reasonCode).toBe(
      "INVALID_INPUT",
    );
    expect(validateTonJettonWalletSealEvidence({}).reasonCode).toBe(
      "INVALID_INPUT",
    );
  });
});
