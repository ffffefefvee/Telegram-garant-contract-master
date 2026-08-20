import { Cell } from "@ton/ton";
import { normalizeTonAddress } from "../escrow/adapters/ton-address";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import {
  TonCenterMessage,
  TonCenterTransaction,
} from "./ton-center-v3.service";
import {
  parseTonNativeLifecyclePayload,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";

const PAYOUT_NOTIFICATION_OPCODE = 0x7061796f;
const PAYOUT_SELLER = 1;
const PAYOUT_BUYER = 2;
const PAYOUT_TREASURY = 3;

export interface TonNativeLifecycleValidation {
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

export function validateTonNativeLifecycleTransaction(
  transaction: TonCenterTransaction,
  preparation: TonNativeEscrowPreparation,
  intent: TonNativeLifecycleIntent,
): TonNativeLifecycleValidation {
  const result = baseResult(transaction);
  const reject = (reasonCode: string): TonNativeLifecycleValidation => ({
    ...result,
    accepted: false,
    reasonCode,
  });

  if (result.accountAddress !== preparation.escrowAddress) {
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
  const actionPhase = transaction.description.action;
  if (
    actionPhase &&
    (actionPhase.success !== true ||
      actionPhase.valid !== true ||
      actionPhase.result_code !== 0)
  ) {
    return reject("ACTION_FAILED");
  }
  if (
    transaction.end_status !== "active" ||
    transaction.account_state_after?.account_status !== "active"
  ) {
    return reject("CONTRACT_NOT_ACTIVE");
  }

  const inbound = transaction.in_msg;
  if (!inbound) return reject("MISSING_INBOUND_MESSAGE");
  if (inbound.bounced === true) return reject("BOUNCED_MESSAGE");
  if (result.sourceAddress !== intent.senderAddress) {
    return reject("INTENT_SENDER_MISMATCH");
  }
  if (normalizeAddress(inbound.destination) !== preparation.escrowAddress) {
    return reject("DESTINATION_MISMATCH");
  }
  if (!result.valueAtomic || !/^\d+$/.test(result.valueAtomic)) {
    return reject("INVALID_MESSAGE_VALUE");
  }
  if (BigInt(result.valueAtomic) < BigInt(intent.actionValueAtomic)) {
    return reject("INSUFFICIENT_ACTION_VALUE");
  }

  const body = inbound.message_content?.body;
  if (!body) return reject("MISSING_MESSAGE_BODY");
  try {
    const parsed = parseTonNativeLifecyclePayload(body);
    result.payloadHash = parsed.hash;
    if (
      parsed.action !== intent.action ||
      parsed.queryId !== BigInt(intent.queryId) ||
      parsed.hash !== intent.payloadHash ||
      (intent.action === TonNativeLifecycleAction.RESOLVE &&
        (parsed.buyerAward !== requiredAward(intent.buyerAwardAtomic) ||
          parsed.sellerAward !== requiredAward(intent.sellerAwardAtomic)))
    ) {
      return reject("INTENT_PAYLOAD_MISMATCH");
    }
  } catch {
    return reject("INVALID_LIFECYCLE_PAYLOAD");
  }

  if (!matchesCommittedTiming(intent, transaction.now, preparation)) {
    return reject("ACTION_DEADLINE_MISMATCH");
  }
  result.postCodeHash = normalizeHash(
    transaction.account_state_after?.code_hash,
  );
  if (result.postCodeHash !== preparation.codeHash) {
    return reject("CODE_HASH_MISMATCH");
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
    if (status !== intent.expectedToStatus) {
      return reject("POST_STATE_STATUS_MISMATCH");
    }
    if (fundedAmount !== BigInt(preparation.buyerTotalAtomic)) {
      return reject("FUNDED_AMOUNT_MISMATCH");
    }
    if (lastQueryId !== BigInt(intent.queryId)) {
      return reject("POST_STATE_QUERY_ID_MISMATCH");
    }
    if (result.postConfigHash !== preparation.configHash) {
      return reject("CONFIG_HASH_MISMATCH");
    }
  } catch {
    return reject("INVALID_POST_STATE");
  }

  const payoutError = validatePayouts(
    transaction.out_msgs ?? [],
    intent,
    preparation,
  );
  if (payoutError) return reject(payoutError);
  return { ...result, accepted: true, reasonCode: "LIFECYCLE_CONFIRMED" };
}

function validatePayouts(
  messages: TonCenterMessage[],
  intent: TonNativeLifecycleIntent,
  preparation: TonNativeEscrowPreparation,
): string | null {
  const expected: Array<{
    destination: string;
    value: bigint;
    kind: number;
  }> = [];
  if (
    intent.action === TonNativeLifecycleAction.RELEASE ||
    intent.action === TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT
  ) {
    expected.push(
      {
        destination: preparation.sellerAddress,
        value: BigInt(preparation.sellerPayoutAtomic),
        kind: PAYOUT_SELLER,
      },
      {
        destination: preparation.treasuryAddress,
        value: BigInt(preparation.platformFeeAtomic),
        kind: PAYOUT_TREASURY,
      },
    );
  }
  if (
    intent.action === TonNativeLifecycleAction.REFUND_BUYER ||
    intent.action === TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT
  ) {
    expected.push(
      {
        destination: preparation.buyerAddress,
        value: BigInt(preparation.refundToBuyerAtomic),
        kind: PAYOUT_BUYER,
      },
      {
        destination: preparation.treasuryAddress,
        value: BigInt(preparation.refundFeeAtomic),
        kind: PAYOUT_TREASURY,
      },
    );
  }
  if (intent.action === TonNativeLifecycleAction.RESOLVE) {
    expected.push(
      {
        destination: preparation.buyerAddress,
        value: requiredAward(intent.buyerAwardAtomic),
        kind: PAYOUT_BUYER,
      },
      {
        destination: preparation.sellerAddress,
        value: requiredAward(intent.sellerAwardAtomic),
        kind: PAYOUT_SELLER,
      },
      {
        destination: preparation.treasuryAddress,
        value: BigInt(preparation.platformFeeAtomic),
        kind: PAYOUT_TREASURY,
      },
    );
  }
  const nonZeroExpected = expected.filter((item) => item.value > 0n);
  if (messages.length !== nonZeroExpected.length) {
    return "PAYOUT_COUNT_MISMATCH";
  }
  const unmatched = [...nonZeroExpected];
  for (const message of messages) {
    if (
      normalizeAddress(message.source) !== preparation.escrowAddress ||
      message.bounced === true ||
      !message.value ||
      !/^\d+$/.test(message.value)
    ) {
      return "INVALID_PAYOUT_MESSAGE";
    }
    let notification: { queryId: bigint; dealId: bigint; kind: number };
    try {
      notification = parsePayoutNotification(message.message_content?.body);
    } catch {
      return "INVALID_PAYOUT_BODY";
    }
    const index = unmatched.findIndex(
      (item) =>
        item.destination === normalizeAddress(message.destination) &&
        item.value === BigInt(message.value!) &&
        item.kind === notification.kind,
    );
    if (
      index < 0 ||
      notification.queryId !== BigInt(intent.queryId) ||
      notification.dealId !== uuidToUint256(preparation.dealId)
    ) {
      return "PAYOUT_MISMATCH";
    }
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0 ? null : "PAYOUT_MISMATCH";
}

function parsePayoutNotification(value: string | undefined): {
  queryId: bigint;
  dealId: bigint;
  kind: number;
} {
  const cell = parseSingleRootBoc(value);
  const slice = cell.beginParse();
  const opcode = slice.loadUint(32);
  const queryId = slice.loadUintBig(64);
  const dealId = slice.loadUintBig(256);
  const kind = slice.loadUint(8);
  if (
    opcode !== PAYOUT_NOTIFICATION_OPCODE ||
    slice.remainingBits !== 0 ||
    slice.remainingRefs !== 0
  ) {
    throw new Error("invalid payout notification");
  }
  return { queryId, dealId, kind };
}

function matchesCommittedTiming(
  intent: TonNativeLifecycleIntent,
  timestamp: number | undefined,
  preparation: TonNativeEscrowPreparation,
): boolean {
  if (!Number.isSafeInteger(timestamp)) return false;
  const now = timestamp!;
  const action = intent.action;
  if (action === TonNativeLifecycleAction.MARK_DELIVERED) {
    return now <= Number(preparation.deliveryDeadline);
  }
  if (action === TonNativeLifecycleAction.RELEASE) {
    return now <= Number(preparation.confirmationDeadline);
  }
  if (action === TonNativeLifecycleAction.OPEN_DISPUTE) {
    const deadline =
      intent.expectedFromStatus === 1
        ? Number(preparation.deliveryDeadline)
        : Number(preparation.confirmationDeadline);
    return now <= deadline;
  }
  if (action === TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT) {
    return now > Number(preparation.deliveryDeadline);
  }
  if (action === TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT) {
    return now > Number(preparation.confirmationDeadline);
  }
  return true;
}

function baseResult(
  transaction: TonCenterTransaction,
): TonNativeLifecycleValidation {
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
      actionResultCode: transaction.description?.action?.result_code ?? null,
      outMessageCount: transaction.out_msgs?.length ?? 0,
    },
  };
}

function normalizeAddress(value: string | undefined): string | null {
  return value ? normalizeTonAddress(value) : null;
}

function normalizeHash(value: string | undefined): string | null {
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  const bytes = Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  return bytes.length === 32 ? bytes.toString("hex") : null;
}

function parseSingleRootBoc(value: string | undefined): Cell {
  if (!value) throw new Error("missing BOC");
  const roots = Cell.fromBoc(
    Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
  if (roots.length !== 1) throw new Error("unexpected root count");
  return roots[0];
}

function uuidToUint256(value: string): bigint {
  const hex = value.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("invalid deal UUID");
  return BigInt(`0x${hex}`);
}

function requiredAward(value: string | null): bigint {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("missing immutable resolution award");
  }
  return BigInt(value);
}
