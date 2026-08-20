import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cell } from "@ton/ton";
import { normalizeTonAddress } from "../escrow/adapters/ton-address";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";

export const TON_NATIVE_FUND_OPCODE = 0x66756e64;
const PAGE_LIMIT = 100;

export interface TonCenterMessage {
  bounced?: boolean;
  destination?: string;
  hash?: string;
  source?: string;
  value?: string;
  opcode?: number;
  message_content?: { body?: string; hash?: string };
}

export interface TonCenterTransaction {
  account?: string;
  account_state_after?: {
    account_status?: string;
    code_hash?: string;
    data_boc?: string;
    hash?: string;
  };
  description?: {
    aborted?: boolean;
    installed?: boolean;
    compute_ph?: {
      skipped?: boolean;
      success?: boolean;
      exit_code?: number;
    };
    action?: {
      success?: boolean;
      valid?: boolean;
      result_code?: number;
    };
  };
  emulated?: boolean;
  end_status?: string;
  hash?: string;
  in_msg?: TonCenterMessage;
  out_msgs?: TonCenterMessage[];
  lt?: string;
  mc_block_seqno?: number;
  now?: number;
}

export interface TonNativeTransactionValidation {
  accepted: boolean;
  reasonCode: string;
  accountAddress: string | null;
  transactionLt: string | null;
  transactionHash: string | null;
  masterchainSeqno: number | null;
  transactionTime: number | null;
  messageHash: string | null;
  sourceAddress: string | null;
  valueAtomic: string | null;
  payloadHash: string | null;
  postCodeHash: string | null;
  postConfigHash: string | null;
  postStateHash: string | null;
  postDataHash: string | null;
  evidence: Record<string, unknown>;
}

/** Indexed, finalized TON transaction reader for native escrow accounts. */
@Injectable()
export class TonCenterV3Service {
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (
      this.config.get<string>("TON_NATIVE_INGESTION_ENABLED", "false") ===
      "true"
    );
  }

  async listFinalizedTransactions(input: {
    network: TonNetwork;
    account: string;
    startUtime: number;
    startLt?: string;
  }): Promise<TonCenterTransaction[]> {
    const baseUrl = this.baseUrl(input.network);
    const url = new URL(`${baseUrl}/transactions`);
    url.searchParams.set("account", input.account);
    url.searchParams.set("start_utime", String(Math.max(0, input.startUtime)));
    if (input.startLt) url.searchParams.set("start_lt", input.startLt);
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", String(PAGE_LIMIT));

    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = this.config.get<string>("TONCENTER_API_KEY", "").trim();
    if (apiKey) headers["X-API-Key"] = apiKey;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `TON Center transactions request failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as {
      transactions?: TonCenterTransaction[];
    };
    if (!Array.isArray(body.transactions)) {
      throw new Error("TON Center transactions response is malformed");
    }
    return body.transactions;
  }

  private baseUrl(network: TonNetwork): string {
    const configured = this.config
      .get<string>("TONCENTER_V3_BASE_URL", "")
      .trim()
      .replace(/\/+$/, "");
    if (configured) return configured;
    return network === TonNetwork.MAINNET
      ? "https://toncenter.com/api/v3"
      : "https://testnet.toncenter.com/api/v3";
  }
}

/**
 * Fail-closed recognition of a successful Fund transaction. The indexed
 * transaction must already have a masterchain inclusion and its post-state
 * must contain our approved code plus the exact immutable config commitment.
 */
export function validateTonNativeFundingTransaction(
  transaction: TonCenterTransaction,
  preparation: TonNativeEscrowPreparation,
): TonNativeTransactionValidation {
  const result = baseValidation(transaction);
  const reject = (reasonCode: string): TonNativeTransactionValidation => ({
    ...result,
    accepted: false,
    reasonCode,
  });

  if (
    !result.accountAddress ||
    result.accountAddress !== preparation.escrowAddress
  ) {
    return reject("ACCOUNT_MISMATCH");
  }
  if (!result.transactionLt || !/^\d+$/.test(result.transactionLt)) {
    return reject("INVALID_TRANSACTION_LT");
  }
  if (!result.transactionHash) return reject("MISSING_TRANSACTION_HASH");
  if (!result.masterchainSeqno || result.masterchainSeqno < 1) {
    return reject("NOT_MASTERCHAIN_FINALIZED");
  }
  if (transaction.emulated === true) return reject("EMULATED_TRANSACTION");
  if (transaction.description?.aborted !== false) {
    return reject("TRANSACTION_ABORTED_OR_UNKNOWN");
  }
  const compute = transaction.description.compute_ph;
  if (
    !compute ||
    compute.skipped === true ||
    compute.success !== true ||
    compute.exit_code !== 0
  ) {
    return reject("COMPUTE_FAILED");
  }
  const action = transaction.description.action;
  if (
    action &&
    (action.success !== true ||
      action.valid !== true ||
      action.result_code !== 0)
  ) {
    return reject("ACTION_FAILED");
  }
  if (transaction.end_status !== "active") {
    return reject("CONTRACT_NOT_ACTIVE");
  }

  const message = transaction.in_msg;
  if (!message) return reject("MISSING_INBOUND_MESSAGE");
  if (message.bounced === true) return reject("BOUNCED_MESSAGE");
  if (result.sourceAddress !== preparation.buyerAddress) {
    return reject("BUYER_ADDRESS_MISMATCH");
  }
  const destination = normalizeAddress(message.destination);
  if (destination !== preparation.escrowAddress) {
    return reject("DESTINATION_MISMATCH");
  }
  if (!result.valueAtomic || !/^\d+$/.test(result.valueAtomic)) {
    return reject("INVALID_MESSAGE_VALUE");
  }
  if (BigInt(result.valueAtomic) < BigInt(preparation.requestAmountAtomic)) {
    return reject("INSUFFICIENT_MESSAGE_VALUE");
  }
  if (
    !Number.isSafeInteger(result.transactionTime) ||
    result.transactionTime! > Number(preparation.fundingDeadline)
  ) {
    return reject("FUNDING_DEADLINE_MISMATCH");
  }

  let actualBody: Cell;
  let expectedBody: Cell;
  try {
    actualBody = parseSingleRootBoc(message.message_content?.body);
    expectedBody = parseSingleRootBoc(preparation.payload);
    result.payloadHash = actualBody.hash().toString("hex");
  } catch {
    return reject("INVALID_MESSAGE_BODY");
  }
  if (!actualBody.hash().equals(expectedBody.hash())) {
    return reject("PAYLOAD_MISMATCH");
  }
  try {
    const slice = actualBody.beginParse();
    const opcode = slice.loadUint(32);
    const queryId = slice.loadUintBig(64);
    if (
      opcode !== TON_NATIVE_FUND_OPCODE ||
      queryId !== BigInt(preparation.queryId) ||
      slice.remainingBits !== 0 ||
      slice.remainingRefs !== 0
    ) {
      return reject("FUND_MESSAGE_MISMATCH");
    }
  } catch {
    return reject("INVALID_FUND_MESSAGE");
  }

  result.postCodeHash = normalizeHash(
    transaction.account_state_after?.code_hash,
  );
  if (result.postCodeHash !== preparation.codeHash) {
    return reject("CODE_HASH_MISMATCH");
  }
  if (transaction.account_state_after?.account_status !== "active") {
    return reject("POST_STATE_NOT_ACTIVE");
  }

  try {
    const data = parseSingleRootBoc(transaction.account_state_after?.data_boc);
    result.postDataHash = data.hash().toString("hex");
    const slice = data.beginParse();
    const status = slice.loadUint(8);
    const fundedAmount = slice.loadCoins();
    const lastQueryId = slice.loadUintBig(64);
    const config = slice.loadRef();
    result.postConfigHash = config.hash().toString("hex");
    if (slice.remainingBits !== 0 || slice.remainingRefs !== 0) {
      return reject("POST_STATE_TRAILING_DATA");
    }
    if (status !== 1) return reject("POST_STATE_NOT_FUNDED");
    if (fundedAmount !== BigInt(preparation.buyerTotalAtomic)) {
      return reject("FUNDED_AMOUNT_MISMATCH");
    }
    if (lastQueryId !== BigInt(preparation.queryId)) {
      return reject("POST_STATE_QUERY_ID_MISMATCH");
    }
    if (result.postConfigHash !== preparation.configHash) {
      return reject("CONFIG_HASH_MISMATCH");
    }
  } catch {
    return reject("INVALID_POST_STATE");
  }

  return { ...result, accepted: true, reasonCode: "FUND_CONFIRMED" };
}

function baseValidation(
  transaction: TonCenterTransaction,
): TonNativeTransactionValidation {
  return {
    accepted: false,
    reasonCode: "UNVALIDATED",
    accountAddress: normalizeAddress(transaction.account),
    transactionLt: transaction.lt ?? null,
    transactionHash: transaction.hash ?? null,
    masterchainSeqno: Number.isSafeInteger(transaction.mc_block_seqno)
      ? transaction.mc_block_seqno!
      : null,
    transactionTime: Number.isSafeInteger(transaction.now)
      ? transaction.now!
      : null,
    messageHash: transaction.in_msg?.hash ?? null,
    sourceAddress: normalizeAddress(transaction.in_msg?.source),
    valueAtomic: transaction.in_msg?.value ?? null,
    payloadHash: null,
    postCodeHash: null,
    postConfigHash: null,
    postStateHash: normalizeHash(transaction.account_state_after?.hash),
    postDataHash: null,
    evidence: {
      aborted: transaction.description?.aborted ?? null,
      computeExitCode: transaction.description?.compute_ph?.exit_code ?? null,
      computeSuccess: transaction.description?.compute_ph?.success ?? null,
      actionResultCode: transaction.description?.action?.result_code ?? null,
      actionSuccess: transaction.description?.action?.success ?? null,
      endStatus: transaction.end_status ?? null,
      emulated: transaction.emulated ?? null,
    },
  };
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeTonAddress(value);
  } catch {
    return null;
  }
}

function normalizeHash(value: string | undefined): string | null {
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Buffer.from(normalized, "base64");
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function parseSingleRootBoc(value: string | undefined): Cell {
  if (!value) throw new Error("missing BOC");
  const bytes =
    /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0
      ? Buffer.from(value, "hex")
      : Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const roots = Cell.fromBoc(bytes);
  if (roots.length !== 1) throw new Error("BOC must have one root");
  return roots[0];
}
