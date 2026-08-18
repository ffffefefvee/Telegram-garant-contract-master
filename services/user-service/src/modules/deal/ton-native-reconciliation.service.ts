import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cell, loadTransaction } from "@ton/ton";
import { normalizeTonAddress } from "../escrow/adapters/ton-address";
import { TonNativeChainEvent } from "./entities/ton-native-chain-event.entity";

interface V2Transaction {
  account?: string;
  utime?: number;
  data?: string;
  transaction_id?: { lt?: string; hash?: string };
}

interface V2AccountState {
  code?: string;
  data?: string;
  last_transaction_id?: { lt?: string; hash?: string };
}

export interface TonNativeReconciliationEvidence extends Record<
  string,
  unknown
> {
  source: string;
  transactionHash: string;
  transactionLt: string;
  postStateHash: string;
  postCodeHash: string;
  postDataHash: string;
}

export class TonNativeReconciliationError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = TonNativeReconciliationError.name;
  }
}

/** Independent raw-transaction and latest-state confirmation via API v2. */
@Injectable()
export class TonNativeReconciliationService {
  constructor(private readonly config: ConfigService) {}

  isRequired(): boolean {
    return (
      this.config.get<string>("TON_NATIVE_RECONCILIATION_REQUIRED", "false") ===
      "true"
    );
  }

  async assertReconciled(
    event: TonNativeChainEvent,
  ): Promise<TonNativeReconciliationEvidence | null> {
    if (!this.isRequired()) return null;
    if (event.reconciledAt && event.reconciliationEvidence) {
      return event.reconciliationEvidence as unknown as TonNativeReconciliationEvidence;
    }
    const expected = requirePrimaryEvidence(event);
    const { baseUrl, source } = this.settings();
    const hashBase64 = Buffer.from(expected.transactionHash, "hex").toString(
      "base64",
    );
    const transactionsUrl = new URL(`${baseUrl}/getTransactions`);
    transactionsUrl.searchParams.set("address", event.accountAddress);
    transactionsUrl.searchParams.set("limit", "10");
    transactionsUrl.searchParams.set("lt", event.transactionLt);
    transactionsUrl.searchParams.set("hash", hashBase64);
    transactionsUrl.searchParams.set("archival", "true");
    const stateUrl = new URL(`${baseUrl}/getAddressInformation`);
    stateUrl.searchParams.set("address", event.accountAddress);

    const [transactions, state] = await Promise.all([
      this.get<V2Transaction[]>(transactionsUrl),
      this.get<V2AccountState>(stateUrl),
    ]);
    const candidate = transactions.find(
      (item) =>
        item.transaction_id?.lt === event.transactionLt &&
        normalizeHash(item.transaction_id?.hash) === expected.transactionHash,
    );
    if (!candidate?.data) {
      throw mismatch("SECONDARY_TRANSACTION_NOT_FOUND");
    }
    const roots = Cell.fromBoc(decodeBase64(candidate.data));
    if (roots.length !== 1) throw mismatch("SECONDARY_TRANSACTION_BOC_ROOTS");
    const root = roots[0];
    const transaction = loadTransaction(root.beginParse());
    if (
      root.hash().toString("hex") !== expected.transactionHash ||
      transaction.hash().toString("hex") !== expected.transactionHash ||
      transaction.lt.toString() !== event.transactionLt ||
      transaction.now !== event.transactionTime ||
      rawAccount(transaction.address) !== event.accountAddress ||
      transaction.stateUpdate.newHash.toString("hex") !== expected.postStateHash
    ) {
      throw mismatch("SECONDARY_RAW_TRANSACTION_MISMATCH");
    }
    const inbound = transaction.inMessage;
    if (!inbound || inbound.info.type !== "internal") {
      throw mismatch("SECONDARY_INBOUND_MESSAGE_MISSING");
    }
    if (
      inbound.info.src.toRawString() !== event.sourceAddress ||
      inbound.info.dest.toRawString() !== event.accountAddress ||
      inbound.info.value.coins.toString() !== event.valueAtomic ||
      inbound.body.hash().toString("hex") !== event.payloadHash
    ) {
      throw mismatch("SECONDARY_INBOUND_MESSAGE_MISMATCH");
    }

    if (
      state.last_transaction_id?.lt !== event.transactionLt ||
      normalizeHash(state.last_transaction_id?.hash) !==
        expected.transactionHash
    ) {
      throw mismatch("SECONDARY_ACCOUNT_ADVANCED_OR_LAGGING");
    }
    const codeHash = bocHash(state.code);
    const dataHash = bocHash(state.data);
    if (
      codeHash !== expected.postCodeHash ||
      dataHash !== expected.postDataHash
    ) {
      throw mismatch("SECONDARY_POST_STATE_MISMATCH");
    }
    return {
      source,
      transactionHash: expected.transactionHash,
      transactionLt: event.transactionLt,
      postStateHash: expected.postStateHash,
      postCodeHash: codeHash,
      postDataHash: dataHash,
    };
  }

  private async get<T>(url: URL): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = this.config
      .get<string>("TON_LITESERVER_V2_API_KEY", "")
      .trim();
    if (apiKey) headers["X-API-Key"] = apiKey;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw mismatch(`SECONDARY_HTTP_${response.status}`);
    }
    const body = (await response.json()) as { ok?: boolean; result?: T };
    if (body.ok !== true || body.result === undefined) {
      throw mismatch("SECONDARY_RESPONSE_MALFORMED");
    }
    return body.result;
  }

  private settings(): { baseUrl: string; source: string } {
    const raw = this.config
      .get<string>("TON_LITESERVER_V2_BASE_URL", "")
      .trim()
      .replace(/\/+$/, "");
    const source = this.config
      .get<string>("TON_LITESERVER_V2_SOURCE", "")
      .trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw mismatch("SECONDARY_URL_INVALID");
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((!local && url.protocol !== "https:") || url.username || url.password) {
      throw mismatch("SECONDARY_URL_UNSAFE");
    }
    if (/(^|\.)toncenter\.com$/i.test(url.hostname)) {
      throw mismatch("SECONDARY_NOT_INDEPENDENT");
    }
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(source)) {
      throw mismatch("SECONDARY_SOURCE_INVALID");
    }
    return { baseUrl: url.toString().replace(/\/+$/, ""), source };
  }
}

function requirePrimaryEvidence(event: TonNativeChainEvent): {
  transactionHash: string;
  postStateHash: string;
  postCodeHash: string;
  postDataHash: string;
} {
  const transactionHash = normalizeHash(event.transactionHash);
  const postStateHash = normalizeHash(event.postStateHash ?? undefined);
  const postCodeHash = normalizeHash(event.postCodeHash ?? undefined);
  const postDataHash = normalizeHash(event.postDataHash ?? undefined);
  if (
    !transactionHash ||
    !postStateHash ||
    !postCodeHash ||
    !postDataHash ||
    !event.sourceAddress ||
    !event.valueAtomic ||
    !event.payloadHash
  ) {
    throw mismatch("PRIMARY_RECONCILIATION_EVIDENCE_MISSING");
  }
  return { transactionHash, postStateHash, postCodeHash, postDataHash };
}

function normalizeHash(value: string | undefined): string | null {
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  try {
    const bytes = decodeBase64(value);
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function bocHash(value: string | undefined): string {
  if (!value) throw mismatch("SECONDARY_STATE_BOC_MISSING");
  const roots = Cell.fromBoc(decodeBase64(value));
  if (roots.length !== 1) throw mismatch("SECONDARY_STATE_BOC_ROOTS");
  return roots[0].hash().toString("hex");
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function rawAccount(address: bigint): string {
  const normalized = normalizeTonAddress(
    `0:${address.toString(16).padStart(64, "0")}`,
  );
  if (!normalized) throw mismatch("SECONDARY_ACCOUNT_INVALID");
  return normalized;
}

function mismatch(code: string): TonNativeReconciliationError {
  return new TonNativeReconciliationError(code);
}
