import { Address, beginCell, Cell, loadAccount } from "@ton/core";
import { normalizeTonAddress } from "./ton-address";

const HASH_HEX = /^[0-9a-f]{64}$/;
const COLLECTOR_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const DECIMAL = /^-?\d+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BOC_BASE64_LENGTH = 1_400_000;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
// sha256("tg-garant:ton-jetton-wallet-seal-structural-evidence:v1")
const DOMAIN_HASH = Buffer.from(
  "e24b754300dd3bd09b2c09598650419d3c7e6bc4ca2eb69c3dd9bcaf39e85f2c",
  "hex",
);

export type TonWalletSealNetwork = "mainnet" | "testnet";

export interface TonWalletSealCollector {
  sourceId: string;
  operatorId: string;
}

export interface TonWalletSealBlockIdentity {
  workchain: number;
  shard: string;
  seqno: number;
  rootHash: string;
  fileHash: string;
}

export interface TonWalletSealGetterEvidence {
  exitCode: number;
  ownerArgumentBocBase64: string;
  resultBocBase64: string;
}

export interface TonWalletSealObservation {
  sourceId: string;
  operatorId: string;
  network: TonWalletSealNetwork;
  masterchainBlock: TonWalletSealBlockIdentity;
  masterShardBlock: TonWalletSealBlockIdentity;
  walletShardBlock: TonWalletSealBlockIdentity;
  masterGetWalletAddress: TonWalletSealGetterEvidence;
  walletShardAccountBocBase64: string;
}

export interface TonWalletSealExpectation {
  network: TonWalletSealNetwork;
  escrowOwnerAddress: string;
  allowlistedMasterAddress: string;
  candidateWalletAddress: string;
  pinnedWalletCodeHash: string;
  collectors: [TonWalletSealCollector, TonWalletSealCollector];
}

export interface TonWalletSealVerifierInput {
  expectation: TonWalletSealExpectation;
  observations: [TonWalletSealObservation, TonWalletSealObservation];
}

export interface TonWalletSealValidation {
  accepted: false;
  sealingAuthorized: false;
  structuralChecksPassed: boolean;
  reasonCode: string;
  /** Audit/deduplication fingerprint only; never use it in the seal message. */
  structuralEvidenceHash: string | null;
  /** Remains null until proof verification and local get-method execution exist. */
  verificationEvidenceHash: null;
  escrowOwnerAddress: string | null;
  masterAddress: string | null;
  walletAddress: string | null;
  walletCodeHash: string | null;
  remainingChecks: string[];
}

interface NormalizedBlock {
  workchain: number;
  shard: bigint;
  seqno: number;
  rootHash: string;
  fileHash: string;
}

interface ParsedWalletAccount {
  accountRootHash: string;
  accountStateHash: string;
  lastTransactionHash: string;
  lastTransactionLt: string;
  walletAddress: string;
  ownerAddress: string;
  masterAddress: string;
  codeHash: string;
  dataHash: string;
}

interface NormalizedExpectation {
  network: TonWalletSealNetwork;
  escrowOwnerAddress: string;
  allowlistedMasterAddress: string;
  candidateWalletAddress: string;
  pinnedWalletCodeHash: string;
  collectors: [TonWalletSealCollector, TonWalletSealCollector];
}

interface ParsedObservation {
  collector: TonWalletSealCollector;
  network: TonWalletSealNetwork;
  masterchainBlock: NormalizedBlock;
  masterShardBlock: NormalizedBlock;
  walletShardBlock: NormalizedBlock;
  getterOwnerAddress: string;
  getterWalletAddress: string;
  getterOwnerCellHash: string;
  getterResultCellHash: string;
  walletAccount: ParsedWalletAccount;
}

const FINALITY_CHECKS = [
  "VERIFIED_MASTERCHAIN_BLOCK_PROOF",
  "VERIFIED_SHARD_BLOCK_INCLUSION",
  "VERIFIED_ACCOUNT_STATE_PROOF",
  "LOCAL_GET_WALLET_ADDRESS_EXECUTION",
];

/**
 * Performs the locally checkable, two-source preflight for the one-time
 * TonJettonEscrow wallet seal. This function deliberately never authorizes a
 * seal: the repository does not yet contain a verified masterchain/shard proof
 * verifier or local get-method execution against a proven master state.
 */
export function validateTonJettonWalletSealEvidence(
  value: unknown,
): TonWalletSealValidation {
  let expectation: NormalizedExpectation | null = null;
  const reject = (
    reasonCode: string,
    structuralChecksPassed = false,
    structuralEvidenceHash: string | null = null,
  ): TonWalletSealValidation => ({
    accepted: false,
    sealingAuthorized: false,
    structuralChecksPassed,
    reasonCode,
    structuralEvidenceHash,
    verificationEvidenceHash: null,
    escrowOwnerAddress: expectation?.escrowOwnerAddress ?? null,
    masterAddress: expectation?.allowlistedMasterAddress ?? null,
    walletAddress: expectation?.candidateWalletAddress ?? null,
    walletCodeHash: expectation?.pinnedWalletCodeHash ?? null,
    remainingChecks: structuralChecksPassed ? [...FINALITY_CHECKS] : [],
  });

  if (
    !record(value) ||
    !exactKeys(value, ["expectation", "observations"]) ||
    !Array.isArray(value.observations) ||
    value.observations.length !== 2
  ) {
    return reject("INVALID_INPUT");
  }

  expectation = normalizeExpectation(value.expectation);
  if (!expectation) return reject("INVALID_EXPECTATION");

  const observationsByCollector = new Map<string, unknown>();
  for (const observation of value.observations) {
    if (!record(observation)) return reject("INVALID_OBSERVATION");
    const sourceId = observation.sourceId;
    const operatorId = observation.operatorId;
    if (typeof sourceId !== "string" || typeof operatorId !== "string") {
      return reject("INVALID_OBSERVATION");
    }
    const key = collectorKey({ sourceId, operatorId });
    if (observationsByCollector.has(key)) {
      return reject("DUPLICATE_COLLECTOR_EVIDENCE");
    }
    observationsByCollector.set(key, observation);
  }

  const parsed: ParsedObservation[] = [];
  for (const collector of expectation.collectors) {
    const raw = observationsByCollector.get(collectorKey(collector));
    if (!raw) return reject("CONFIGURED_COLLECTOR_EVIDENCE_MISSING");
    const observation = parseObservation(raw, collector, expectation);
    if (typeof observation === "string") return reject(observation);
    parsed.push(observation);
  }
  if (observationsByCollector.size !== parsed.length) {
    return reject("UNCONFIGURED_COLLECTOR_EVIDENCE");
  }

  const firstFingerprint = observationFingerprint(parsed[0]);
  const secondFingerprint = observationFingerprint(parsed[1]);
  if (firstFingerprint !== secondFingerprint) {
    return reject("COLLECTOR_EVIDENCE_DISAGREEMENT");
  }

  const structuralEvidenceHash = evidenceCommitment(expectation, parsed);
  return reject("MASTERCHAIN_PROOF_REQUIRED", true, structuralEvidenceHash);
}

function normalizeExpectation(value: unknown): NormalizedExpectation | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "network",
      "escrowOwnerAddress",
      "allowlistedMasterAddress",
      "candidateWalletAddress",
      "pinnedWalletCodeHash",
      "collectors",
    ]) ||
    !isNetwork(value.network) ||
    typeof value.pinnedWalletCodeHash !== "string" ||
    !HASH_HEX.test(value.pinnedWalletCodeHash) ||
    value.pinnedWalletCodeHash === "0".repeat(64) ||
    !Array.isArray(value.collectors) ||
    value.collectors.length !== 2
  ) {
    return null;
  }

  const escrowOwnerAddress = normalizeAddress(value.escrowOwnerAddress);
  const allowlistedMasterAddress = normalizeAddress(
    value.allowlistedMasterAddress,
  );
  const candidateWalletAddress = normalizeAddress(value.candidateWalletAddress);
  const collectors = value.collectors.map(normalizeCollector);
  if (
    !escrowOwnerAddress ||
    !allowlistedMasterAddress ||
    !candidateWalletAddress ||
    collectors.some((collector) => !collector)
  ) {
    return null;
  }
  const normalizedCollectors = collectors as [
    TonWalletSealCollector,
    TonWalletSealCollector,
  ];
  if (
    normalizedCollectors[0].sourceId === normalizedCollectors[1].sourceId ||
    normalizedCollectors[0].operatorId === normalizedCollectors[1].operatorId
  ) {
    return null;
  }
  if (
    new Set([
      escrowOwnerAddress,
      allowlistedMasterAddress,
      candidateWalletAddress,
    ]).size !== 3
  ) {
    return null;
  }

  return {
    network: value.network,
    escrowOwnerAddress,
    allowlistedMasterAddress,
    candidateWalletAddress,
    pinnedWalletCodeHash: value.pinnedWalletCodeHash,
    collectors: normalizedCollectors,
  };
}

function normalizeCollector(value: unknown): TonWalletSealCollector | null {
  if (
    !record(value) ||
    !exactKeys(value, ["sourceId", "operatorId"]) ||
    typeof value.sourceId !== "string" ||
    typeof value.operatorId !== "string" ||
    !COLLECTOR_ID.test(value.sourceId) ||
    !COLLECTOR_ID.test(value.operatorId)
  ) {
    return null;
  }
  return { sourceId: value.sourceId, operatorId: value.operatorId };
}

function parseObservation(
  value: unknown,
  collector: TonWalletSealCollector,
  expected: NormalizedExpectation,
): ParsedObservation | string {
  if (
    !record(value) ||
    !exactKeys(value, [
      "sourceId",
      "operatorId",
      "network",
      "masterchainBlock",
      "masterShardBlock",
      "walletShardBlock",
      "masterGetWalletAddress",
      "walletShardAccountBocBase64",
    ]) ||
    value.sourceId !== collector.sourceId ||
    value.operatorId !== collector.operatorId
  ) {
    return "COLLECTOR_IDENTITY_MISMATCH";
  }
  if (value.network !== expected.network) return "NETWORK_MISMATCH";
  if (!isNetwork(value.network)) return "INVALID_NETWORK";

  const masterchainBlock = normalizeBlock(value.masterchainBlock);
  const masterShardBlock = normalizeBlock(value.masterShardBlock);
  const walletShardBlock = normalizeBlock(value.walletShardBlock);
  if (!masterchainBlock || !masterShardBlock || !walletShardBlock) {
    return "INVALID_BLOCK_IDENTITY";
  }
  if (masterchainBlock.workchain !== -1) {
    return "INVALID_MASTERCHAIN_BLOCK";
  }
  if (masterchainBlock.shard !== INT64_MIN) {
    return "INVALID_MASTERCHAIN_BLOCK";
  }

  const masterAddress = Address.parseRaw(expected.allowlistedMasterAddress);
  const walletAddress = Address.parseRaw(expected.candidateWalletAddress);
  if (
    masterShardBlock.workchain !== masterAddress.workChain ||
    walletShardBlock.workchain !== walletAddress.workChain
  ) {
    return "SHARD_WORKCHAIN_MISMATCH";
  }

  const getter = parseGetterEvidence(
    value.masterGetWalletAddress,
    expected.escrowOwnerAddress,
    expected.candidateWalletAddress,
  );
  if (typeof getter === "string") return getter;

  if (typeof value.walletShardAccountBocBase64 !== "string") {
    return "INVALID_WALLET_ACCOUNT_BOC";
  }
  const walletAccount = parseWalletShardAccount(
    value.walletShardAccountBocBase64,
  );
  if (!walletAccount) return "INVALID_WALLET_ACCOUNT_BOC";
  if (walletAccount.walletAddress !== expected.candidateWalletAddress) {
    return "WALLET_ACCOUNT_ADDRESS_MISMATCH";
  }
  if (walletAccount.ownerAddress !== expected.escrowOwnerAddress) {
    return "WALLET_OWNER_MISMATCH";
  }
  if (walletAccount.masterAddress !== expected.allowlistedMasterAddress) {
    return "WALLET_MASTER_MISMATCH";
  }
  if (walletAccount.codeHash !== expected.pinnedWalletCodeHash) {
    return "WALLET_CODE_HASH_MISMATCH";
  }

  return {
    collector,
    network: value.network,
    masterchainBlock,
    masterShardBlock,
    walletShardBlock,
    getterOwnerAddress: getter.ownerAddress,
    getterWalletAddress: getter.walletAddress,
    getterOwnerCellHash: getter.ownerCellHash,
    getterResultCellHash: getter.resultCellHash,
    walletAccount,
  };
}

function parseGetterEvidence(
  value: unknown,
  expectedOwnerAddress: string,
  expectedWalletAddress: string,
):
  | {
      ownerAddress: string;
      walletAddress: string;
      ownerCellHash: string;
      resultCellHash: string;
    }
  | string {
  if (
    !record(value) ||
    !exactKeys(value, [
      "exitCode",
      "ownerArgumentBocBase64",
      "resultBocBase64",
    ]) ||
    value.exitCode !== 0 ||
    typeof value.ownerArgumentBocBase64 !== "string" ||
    typeof value.resultBocBase64 !== "string"
  ) {
    return "INVALID_GET_WALLET_ADDRESS_RESULT";
  }
  const ownerCell = singleOrdinaryBoc(value.ownerArgumentBocBase64);
  const resultCell = singleOrdinaryBoc(value.resultBocBase64);
  if (!ownerCell || !resultCell) return "INVALID_GET_WALLET_ADDRESS_RESULT";
  const ownerAddress = exactAddressCell(ownerCell);
  const walletAddress = exactAddressCell(resultCell);
  if (!ownerAddress || !walletAddress) {
    return "INVALID_GET_WALLET_ADDRESS_RESULT";
  }
  if (ownerAddress !== expectedOwnerAddress) return "GETTER_OWNER_MISMATCH";
  if (walletAddress !== expectedWalletAddress) return "GETTER_WALLET_MISMATCH";
  return {
    ownerAddress,
    walletAddress,
    ownerCellHash: ownerCell.hash().toString("hex"),
    resultCellHash: resultCell.hash().toString("hex"),
  };
}

function parseWalletShardAccount(
  bocBase64: string,
): ParsedWalletAccount | null {
  const root = singleOrdinaryBoc(bocBase64);
  if (!root) return null;
  try {
    const shardSlice = root.beginParse();
    const accountState = shardSlice.loadRef();
    const lastTransactionHash = shardSlice.loadUintBig(256);
    const lastTransactionLt = shardSlice.loadUintBig(64);
    shardSlice.endParse();
    if (accountState.isExotic) return null;

    const accountSlice = accountState.beginParse();
    if (!accountSlice.loadBit()) return null;
    const account = loadAccount(accountSlice);
    accountSlice.endParse();
    if (
      lastTransactionHash === 0n ||
      lastTransactionLt === 0n ||
      account.storage.lastTransLt !== lastTransactionLt
    ) {
      return null;
    }
    if (account.storage.state.type !== "active") return null;
    const code = account.storage.state.state.code;
    const data = account.storage.state.state.data;
    if (!code || !data || code.isExotic || data.isExotic) return null;

    const dataSlice = data.beginParse();
    dataSlice.loadCoins();
    const ownerAddress = normalizeLoadedAddress(dataSlice.loadAddress());
    const masterAddress = normalizeLoadedAddress(dataSlice.loadAddress());
    const embeddedWalletCode = dataSlice.loadRef();
    dataSlice.endParse();
    if (!ownerAddress || !masterAddress || embeddedWalletCode.isExotic) {
      return null;
    }
    const codeHash = code.hash().toString("hex");
    if (embeddedWalletCode.hash().toString("hex") !== codeHash) return null;

    return {
      accountRootHash: root.hash().toString("hex"),
      accountStateHash: accountState.hash().toString("hex"),
      lastTransactionHash: hashBigInt(lastTransactionHash),
      lastTransactionLt: lastTransactionLt.toString(),
      walletAddress: account.addr.toRawString(),
      ownerAddress,
      masterAddress,
      codeHash,
      dataHash: data.hash().toString("hex"),
    };
  } catch {
    return null;
  }
}

function normalizeBlock(value: unknown): NormalizedBlock | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "workchain",
      "shard",
      "seqno",
      "rootHash",
      "fileHash",
    ]) ||
    !Number.isInteger(value.workchain) ||
    typeof value.workchain !== "number" ||
    value.workchain < -1 ||
    value.workchain > 0 ||
    !Number.isSafeInteger(value.seqno) ||
    typeof value.seqno !== "number" ||
    value.seqno < 1 ||
    value.seqno > 0xffffffff ||
    typeof value.shard !== "string" ||
    !DECIMAL.test(value.shard) ||
    typeof value.rootHash !== "string" ||
    !HASH_HEX.test(value.rootHash) ||
    value.rootHash === "0".repeat(64) ||
    typeof value.fileHash !== "string" ||
    !HASH_HEX.test(value.fileHash) ||
    value.fileHash === "0".repeat(64)
  ) {
    return null;
  }
  const shard = BigInt(value.shard);
  if (shard < INT64_MIN || shard > INT64_MAX) return null;
  return {
    workchain: value.workchain,
    shard,
    seqno: value.seqno,
    rootHash: value.rootHash,
    fileHash: value.fileHash,
  };
}

function observationFingerprint(value: ParsedObservation): string {
  return beginCell()
    .storeRef(blockCell(value.masterchainBlock))
    .storeRef(blockCell(value.masterShardBlock))
    .storeRef(blockCell(value.walletShardBlock))
    .storeRef(
      beginCell()
        .storeBuffer(Buffer.from(value.getterOwnerCellHash, "hex"))
        .storeBuffer(Buffer.from(value.getterResultCellHash, "hex"))
        .storeBuffer(Buffer.from(value.walletAccount.accountRootHash, "hex"))
        .endCell(),
    )
    .endCell()
    .hash()
    .toString("hex");
}

function evidenceCommitment(
  expected: NormalizedExpectation,
  observations: ParsedObservation[],
): string {
  const addresses = beginCell()
    .storeAddress(Address.parseRaw(expected.escrowOwnerAddress))
    .storeAddress(Address.parseRaw(expected.allowlistedMasterAddress))
    .storeAddress(Address.parseRaw(expected.candidateWalletAddress))
    .endCell();
  const identity = beginCell()
    .storeInt(networkGlobalId(expected.network), 32)
    .storeBuffer(Buffer.from(expected.pinnedWalletCodeHash, "hex"))
    .storeRef(addresses)
    .endCell();
  const collectorCells = observations.map((observation) =>
    beginCell()
      .storeBuffer(identifierHash(observation.collector.sourceId))
      .storeBuffer(identifierHash(observation.collector.operatorId))
      .storeRef(
        beginCell()
          .storeBuffer(Buffer.from(observationFingerprint(observation), "hex"))
          .storeBuffer(
            Buffer.from(observation.walletAccount.accountStateHash, "hex"),
          )
          .endCell(),
      )
      .storeRef(
        beginCell()
          .storeBuffer(
            Buffer.from(observation.walletAccount.lastTransactionHash, "hex"),
          )
          .storeUint(BigInt(observation.walletAccount.lastTransactionLt), 64)
          .storeBuffer(Buffer.from(observation.walletAccount.dataHash, "hex"))
          .endCell(),
      )
      .endCell(),
  );
  return beginCell()
    .storeBuffer(DOMAIN_HASH)
    .storeRef(identity)
    .storeRef(collectorCells[0])
    .storeRef(collectorCells[1])
    .endCell()
    .hash()
    .toString("hex");
}

function blockCell(value: NormalizedBlock): Cell {
  return beginCell()
    .storeInt(value.workchain, 32)
    .storeInt(value.shard, 64)
    .storeUint(value.seqno, 32)
    .storeBuffer(Buffer.from(value.rootHash, "hex"))
    .storeBuffer(Buffer.from(value.fileHash, "hex"))
    .endCell();
}

function exactAddressCell(cell: Cell): string | null {
  try {
    const slice = cell.beginParse();
    const address = slice.loadAddress();
    slice.endParse();
    return normalizeLoadedAddress(address);
  } catch {
    return null;
  }
}

function singleOrdinaryBoc(value: string): Cell | null {
  if (
    value.length < 4 ||
    value.length > MAX_BOC_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !BASE64.test(value)
  ) {
    return null;
  }
  try {
    const roots = Cell.fromBoc(Buffer.from(value, "base64"));
    return roots.length === 1 && !roots[0].isExotic ? roots[0] : null;
  } catch {
    return null;
  }
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" ? normalizeTonAddress(value) : null;
}

function normalizeLoadedAddress(value: Address | null): string | null {
  return value ? normalizeTonAddress(value.toRawString()) : null;
}

function networkGlobalId(network: TonWalletSealNetwork): number {
  return network === "mainnet" ? -239 : -3;
}

function identifierHash(value: string): Buffer {
  return beginCell().storeBuffer(Buffer.from(value, "utf8")).endCell().hash();
}

function hashBigInt(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function collectorKey(value: TonWalletSealCollector): string {
  return `${value.sourceId}\u0000${value.operatorId}`;
}

function isNetwork(value: unknown): value is TonWalletSealNetwork {
  return value === "mainnet" || value === "testnet";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
