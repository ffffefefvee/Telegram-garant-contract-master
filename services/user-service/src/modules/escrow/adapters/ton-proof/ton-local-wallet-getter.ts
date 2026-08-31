import { createHash } from "crypto";
import {
  Address,
  beginCell,
  Cell,
  CellType,
  getMethodId,
  parseTuple,
  TupleReader,
} from "@ton/core";
import { Executor, loadConfig } from "@ton/sandbox";
import type { TonProvenActiveAccountState } from "./ton-account-state-proof";
import type { TonProofBlockId } from "./ton-proof-envelope";
import type { TonProvenTvmEnvironment } from "./ton-tvm-environment-proof";
import {
  isTonJettonWalletContractProfile,
  type TonJettonWalletContractProfile,
} from "./ton-jetton-wallet-profile";

const GET_WALLET_ADDRESS = "get_wallet_address";
const GET_JETTON_DATA = "get_jetton_data";
const GETTER_POLICY_VERSION = "ton-local-getter-v1/sandbox-0.40.0";
const MAX_GETTER_GAS = 100_000_000n;

export interface TonLocalWalletGetterExpectation {
  masterAddress: string;
  ownerAddress: string;
  candidateWalletAddress: string;
  walletContractProfile: TonJettonWalletContractProfile;
  gasLimit: bigint;
}

export interface TonVerifiedLocalWalletGetterResult {
  kind: "TON_VERIFIED_LOCAL_WALLET_GETTER_RESULT";
  masterAccountStateProofVerified: true;
  tvmEnvironmentProofVerified: true;
  localGetterExecutionVerified: true;
  canonicalWalletAddressVerified: true;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  finalizedByMasterchainBlock: TonProofBlockId;
  masterAccountBlock: TonProofBlockId;
  masterAddress: string;
  ownerAddress: string;
  canonicalWalletAddress: string;
  walletContractProfile: TonJettonWalletContractProfile;
  masterWalletCodeHash: string | null;
  walletCodeGetterMethodId: number | null;
  walletCodeGetterGasUsed: string | null;
  methodId: number;
  gasLimit: string;
  gasUsed: string;
  executorPolicyVersion: string;
  emulatorCommitHash: string;
  emulatorCommitDate: string;
  configurationRootHash: string;
  masterAccountStateHash: string;
  masterCodeHash: string;
  masterDataHash: string;
  getterInputHash: string;
  deterministicRandomSeedHash: string;
  executionTranscriptHash: string;
}

function stablecoinMasterWalletCodeHash(master: TonProvenActiveAccountState): string {
  if (master.data.type !== CellType.Ordinary) {
    reject("stablecoin master data must be an ordinary cell");
  }
  try {
    const data = master.data.beginParse();
    data.loadCoins();
    data.loadAddress();
    data.loadMaybeAddress();
    const walletCode = data.loadRef();
    data.loadRef();
    data.endParse();
    if (walletCode.type !== CellType.Library) {
      reject("stablecoin master wallet code must be a library reference");
    }
    return walletCode.hash(0).toString("hex");
  } catch (error) {
    if (error instanceof TonLocalWalletGetterError) throw error;
    reject(
      `stablecoin master data is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export class TonLocalWalletGetterError extends Error {
  readonly name = "TonLocalWalletGetterError";
}

function reject(message: string): never {
  throw new TonLocalWalletGetterError(message);
}

function blockIdsEqual(left: TonProofBlockId, right: TonProofBlockId): boolean {
  return (
    left.workchain === right.workchain &&
    left.shard === right.shard &&
    left.seqno === right.seqno &&
    left.rootHash === right.rootHash &&
    left.fileHash === right.fileHash
  );
}

function parseRawAddress(value: string, label: string): Address {
  if (!/^-?\d+:[0-9a-f]{64}$/.test(value)) {
    reject(`${label} must be canonical raw lowercase form`);
  }
  try {
    const result = Address.parseRaw(value);
    if (result.toRawString() !== value) reject(`${label} is not canonical`);
    return result;
  } catch (error) {
    if (error instanceof TonLocalWalletGetterError) throw error;
    reject(`${label} is invalid`);
  }
}

function canonicalUint(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) reject(`${label} is invalid`);
  return BigInt(value);
}

function hashParts(domain: string, parts: readonly (string | Buffer)[]): Buffer {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  for (const part of parts) {
    const value = typeof part === "string" ? Buffer.from(part, "utf8") : part;
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    hash.update(length);
    hash.update(value);
  }
  return hash.digest();
}

function validateProvenInputs(
  master: TonProvenActiveAccountState,
  environment: TonProvenTvmEnvironment,
): void {
  if (
    master.shardBlockFinalityProven !== true ||
    master.shardStateProofVerified !== true ||
    master.accountDictionaryInclusionVerified !== true ||
    master.accountStateProofVerified !== true ||
    master.transactionInclusionVerified !== false ||
    master.authorizationAllowed !== false ||
    master.verificationEvidenceHash !== null
  ) {
    reject("master-account proof provenance is invalid");
  }
  if (
    environment.masterchainFinalityProven !== true ||
    environment.masterchainStateProofVerified !== true ||
    environment.configurationDictionaryProofVerified !== true ||
    environment.configurationComplete !== true ||
    environment.localGetterExecutionVerified !== false ||
    environment.authorizationAllowed !== false ||
    environment.verificationEvidenceHash !== null
  ) {
    reject("TVM-environment proof provenance is invalid");
  }
  if (
    master.networkGlobalId !== environment.networkGlobalId ||
    !blockIdsEqual(
      master.finalizedByMasterchainBlock,
      environment.masterchainBlock,
    )
  ) {
    reject("master account and TVM environment use different finalized anchors");
  }
  if (
    master.accountStateRoot.hash(0).toString("hex") !== master.accountStateHash ||
    master.code.hash(0).toString("hex") !== master.codeHash ||
    master.data.hash(0).toString("hex") !== master.dataHash
  ) {
    reject("master-account cells no longer match their proven hashes");
  }
  if (
    environment.configurationRoot.hash(0).toString("hex") !==
    environment.configurationRootHash
  ) {
    reject("TVM configuration cell no longer matches its proven hash");
  }
}

export async function executeTonCanonicalWalletGetter(
  master: TonProvenActiveAccountState,
  environment: TonProvenTvmEnvironment,
  expectation: TonLocalWalletGetterExpectation,
): Promise<TonVerifiedLocalWalletGetterResult> {
  validateProvenInputs(master, environment);
  const masterAddress = parseRawAddress(expectation.masterAddress, "masterAddress");
  const ownerAddress = parseRawAddress(expectation.ownerAddress, "ownerAddress");
  const candidateWalletAddress = parseRawAddress(
    expectation.candidateWalletAddress,
    "candidateWalletAddress",
  );
  if (!isTonJettonWalletContractProfile(expectation.walletContractProfile)) {
    reject("walletContractProfile is unsupported");
  }
  const masterWalletCodeHash =
    expectation.walletContractProfile === "ton-stablecoin-governance-wallet-v1"
      ? stablecoinMasterWalletCodeHash(master)
      : null;
  if (master.accountAddress !== masterAddress.toRawString()) {
    reject("expected Jetton master address does not match the proven account");
  }
  if (
    typeof expectation.gasLimit !== "bigint" ||
    expectation.gasLimit <= 0n ||
    expectation.gasLimit > MAX_GETTER_GAS
  ) {
    reject("gasLimit is outside the local-getter policy");
  }

  try {
    loadConfig(environment.configurationRoot);
  } catch (error) {
    reject(
      `proven TVM configuration cannot be decoded: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const ownerCell = beginCell().storeAddress(ownerAddress).endCell();
  const methodId = getMethodId(GET_WALLET_ADDRESS);
  const randomSeed = hashParts("TON_LOCAL_GETTER_RANDOM_SEED_V1", [
    environment.masterchainBlock.rootHash,
    master.accountStateHash,
    ownerCell.hash(0),
  ]);
  const getterInputHash = hashParts("TON_LOCAL_GETTER_INPUT_V1", [
    methodId.toString(),
    masterAddress.toRawString(),
    ownerCell.hash(0),
  ]).toString("hex");

  let executor: Executor;
  try {
    executor = await Executor.create();
  } catch (error) {
    reject(
      `local TVM executor could not start: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const version = executor.getVersion();
  let execution;
  try {
    execution = await executor.runGetMethod({
      code: master.code,
      data: master.data,
      methodId,
      stack: [{ type: "slice", cell: ownerCell }],
      config: environment.configurationRoot
        .toBoc({ idx: false, crc32: false })
        .toString("base64"),
      verbosity: "short",
      address: masterAddress,
      unixTime: environment.generatedAtUnix,
      balance: canonicalUint(master.balanceNanotons, "master balance"),
      randomSeed,
      gasLimit: expectation.gasLimit,
      debugEnabled: false,
    });
  } catch (error) {
    reject(
      `local getter execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!execution.output.success) {
    reject(`local getter execution failed: ${execution.output.error}`);
  }
  if (execution.output.vm_exit_code !== 0) {
    reject(`local getter exited with code ${execution.output.vm_exit_code}`);
  }
  if (execution.output.missing_library !== null) {
    reject("local getter requires an unproven global library");
  }
  const gasUsed = canonicalUint(execution.output.gas_used, "getter gas usage");
  if (gasUsed > expectation.gasLimit) reject("local getter exceeded its gas limit");

  let returnedWallet: Address;
  try {
    const stack = new TupleReader(parseTuple(Cell.fromBase64(execution.output.stack)));
    returnedWallet = stack.readAddress();
    if (stack.remaining !== 0) reject("local getter returned trailing stack items");
  } catch (error) {
    if (error instanceof TonLocalWalletGetterError) throw error;
    reject(
      `local getter result is not exactly one address: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!returnedWallet.equals(candidateWalletAddress)) {
    reject("locally derived wallet does not match the candidate wallet");
  }

  let boundMasterWalletCodeHash = masterWalletCodeHash;
  let walletCodeGetterMethodId: number | null = null;
  let walletCodeGetterGasUsed: bigint | null = null;
  if (expectation.walletContractProfile === "tep74-library-wallet-v1") {
    walletCodeGetterMethodId = getMethodId(GET_JETTON_DATA);
    let walletCodeExecution;
    try {
      walletCodeExecution = await executor.runGetMethod({
        code: master.code,
        data: master.data,
        methodId: walletCodeGetterMethodId,
        stack: [],
        config: environment.configurationRoot
          .toBoc({ idx: false, crc32: false })
          .toString("base64"),
        verbosity: "short",
        address: masterAddress,
        unixTime: environment.generatedAtUnix,
        balance: canonicalUint(master.balanceNanotons, "master balance"),
        randomSeed: hashParts("TON_LOCAL_JETTON_DATA_RANDOM_SEED_V1", [
          environment.masterchainBlock.rootHash,
          master.accountStateHash,
        ]),
        gasLimit: expectation.gasLimit,
        debugEnabled: false,
      });
    } catch (error) {
      reject(
        `local get_jetton_data execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (!walletCodeExecution.output.success) {
      reject(
        `local get_jetton_data execution failed: ${walletCodeExecution.output.error}`,
      );
    }
    if (walletCodeExecution.output.vm_exit_code !== 0) {
      reject(
        `local get_jetton_data exited with code ${walletCodeExecution.output.vm_exit_code}`,
      );
    }
    if (walletCodeExecution.output.missing_library !== null) {
      reject("local get_jetton_data requires an unproven global library");
    }
    walletCodeGetterGasUsed = canonicalUint(
      walletCodeExecution.output.gas_used,
      "get_jetton_data gas usage",
    );
    if (walletCodeGetterGasUsed > expectation.gasLimit) {
      reject("local get_jetton_data exceeded its gas limit");
    }
    try {
      const stack = new TupleReader(
        parseTuple(Cell.fromBase64(walletCodeExecution.output.stack)),
      );
      stack.readBigNumber();
      stack.readBigNumber();
      const admin = stack.readCell().beginParse();
      admin.loadMaybeAddress();
      admin.endParse();
      stack.readCell();
      const walletCode = stack.readCell();
      if (stack.remaining !== 0) {
        reject("local get_jetton_data returned trailing stack items");
      }
      if (walletCode.type !== CellType.Library) {
        reject("local get_jetton_data wallet code is not a library reference");
      }
      boundMasterWalletCodeHash = walletCode.hash(0).toString("hex");
    } catch (error) {
      if (error instanceof TonLocalWalletGetterError) throw error;
      reject(
        `local get_jetton_data result is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const executionTranscriptHash = hashParts("TON_LOCAL_GETTER_TRANSCRIPT_V1", [
    GETTER_POLICY_VERSION,
    environment.networkGlobalId.toString(),
    environment.masterchainBlock.rootHash,
    environment.masterchainBlock.fileHash,
    environment.configurationRootHash,
    master.block.rootHash,
    master.accountStateHash,
    master.codeHash,
    master.dataHash,
    expectation.walletContractProfile,
    boundMasterWalletCodeHash ?? "none",
    walletCodeGetterMethodId?.toString() ?? "none",
    walletCodeGetterGasUsed?.toString() ?? "none",
    getterInputHash,
    returnedWallet.toRawString(),
    gasUsed.toString(),
    version.commitHash,
  ]).toString("hex");
  return {
    kind: "TON_VERIFIED_LOCAL_WALLET_GETTER_RESULT",
    masterAccountStateProofVerified: true,
    tvmEnvironmentProofVerified: true,
    localGetterExecutionVerified: true,
    canonicalWalletAddressVerified: true,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: environment.networkGlobalId,
    finalizedByMasterchainBlock: { ...environment.masterchainBlock },
    masterAccountBlock: { ...master.block },
    masterAddress: masterAddress.toRawString(),
    ownerAddress: ownerAddress.toRawString(),
    canonicalWalletAddress: returnedWallet.toRawString(),
    walletContractProfile: expectation.walletContractProfile,
    masterWalletCodeHash: boundMasterWalletCodeHash,
    walletCodeGetterMethodId,
    walletCodeGetterGasUsed: walletCodeGetterGasUsed?.toString() ?? null,
    methodId,
    gasLimit: expectation.gasLimit.toString(),
    gasUsed: gasUsed.toString(),
    executorPolicyVersion: GETTER_POLICY_VERSION,
    emulatorCommitHash: version.commitHash,
    emulatorCommitDate: version.commitDate,
    configurationRootHash: environment.configurationRootHash,
    masterAccountStateHash: master.accountStateHash,
    masterCodeHash: master.codeHash,
    masterDataHash: master.dataHash,
    getterInputHash,
    deterministicRandomSeedHash: createHash("sha256")
      .update(randomSeed)
      .digest("hex"),
    executionTranscriptHash,
  };
}
