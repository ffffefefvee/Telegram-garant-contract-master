import { normalizeTonAddress } from "../escrow/adapters/ton-address";
import {
  TonJettonNotificationExpectation,
  TonJettonWalletEvidence,
  validateCanonicalJettonWallet,
  validateTonJettonTransferNotification,
} from "../escrow/adapters/ton-jetton-notification";
import { TonCenterTransaction } from "./ton-center-v3.service";

export type TonJettonFundingReasonCode =
  | "JETTON_FUNDING_CONFIRMED"
  | "MALFORMED_OBSERVATION"
  | "INVALID_EXPECTATION"
  | "ACCOUNT_MISMATCH"
  | "INVALID_TRANSACTION_LT"
  | "INVALID_TRANSACTION_HASH"
  | "NOT_MASTERCHAIN_FINALIZED"
  | "INVALID_TRANSACTION_TIME"
  | "FUNDING_DEADLINE_EXCEEDED"
  | "INVALID_MESSAGE_HASH"
  | "EMULATED_OR_UNKNOWN_TRANSACTION"
  | "TRANSACTION_ABORTED_OR_UNKNOWN"
  | "COMPUTE_FAILED_OR_UNKNOWN"
  | "ACTION_FAILED_OR_UNKNOWN"
  | "MISSING_INBOUND_NOTIFICATION"
  | "BOUNCED_OR_UNKNOWN_NOTIFICATION"
  | "DESTINATION_MISMATCH"
  | "INVALID_OUTBOUND_MESSAGES"
  | "UNEXPLAINED_OUTBOUND_MESSAGES"
  | "INVALID_CANONICAL_WALLET_EVIDENCE"
  | "JETTON_MASTER_MISMATCH"
  | "JETTON_OWNER_MISMATCH"
  | "JETTON_WALLET_MISMATCH"
  | "INVALID_ADDRESS_EVIDENCE"
  | "INVALID_TEP74_NOTIFICATION"
  | string;

export interface TonJettonFundingExpectation extends TonJettonNotificationExpectation {
  allowlistedMasterAddress: string;
  fundingDeadline: number;
}

export interface TonJettonFundingObservation {
  transaction: TonCenterTransaction;
  canonicalWalletEvidence: TonJettonWalletEvidence;
}

export interface TonJettonFundingValidationEvidence {
  accountAddress: string | null;
  transactionLt: string | null;
  transactionHash: string | null;
  masterchainSeqno: number | null;
  transactionTime: number | null;
  messageHash: string | null;
  inboundSourceAddress: string | null;
  inboundDestinationAddress: string | null;
  canonicalMasterAddress: string | null;
  canonicalOwnerAddress: string | null;
  canonicalWalletAddress: string | null;
  queryId: string | null;
  amountAtomic: string | null;
  notificationSenderAddress: string | null;
  forwardPayloadHash: string | null;
  outboundMessageCount: number | null;
  execution: {
    emulated: boolean | null;
    aborted: boolean | null;
    computeSkipped: boolean | null;
    computeSuccess: boolean | null;
    computeExitCode: number | null;
    actionSuccess: boolean | null;
    actionValid: boolean | null;
    actionResultCode: number | null;
  };
}

export interface TonJettonFundingValidation {
  accepted: boolean;
  reasonCode: TonJettonFundingReasonCode;
  evidence: TonJettonFundingValidationEvidence;
}

/**
 * Pure, fail-closed recognition of a finalized Jetton funding notification.
 *
 * This validates transaction and independently collected canonical-wallet
 * evidence only. It neither persists state nor enables the TON adapter.
 */
export function validateTonJettonFundingObservation(
  observation: TonJettonFundingObservation,
  expected: TonJettonFundingExpectation,
): TonJettonFundingValidation {
  try {
    const transaction = observation?.transaction;
    const result = baseResult(transaction);
    const reject = (
      reasonCode: TonJettonFundingReasonCode,
    ): TonJettonFundingValidation => ({
      accepted: false,
      reasonCode,
      evidence: result,
    });

    if (!isRecord(transaction) || !isRecord(expected)) {
      return reject("MALFORMED_OBSERVATION");
    }

    const expectedEscrow = normalizeTonAddress(expected.escrowAddress);
    const expectedWallet = normalizeTonAddress(
      expected.escrowJettonWalletAddress,
    );
    const expectedMaster = normalizeTonAddress(
      expected.allowlistedMasterAddress,
    );
    const expectedBuyer = normalizeTonAddress(expected.buyerAddress);
    if (
      !expectedEscrow ||
      !expectedWallet ||
      !expectedMaster ||
      !expectedBuyer ||
      !Number.isSafeInteger(expected.fundingDeadline) ||
      expected.fundingDeadline < 1
    ) {
      return reject("INVALID_EXPECTATION");
    }

    if (result.accountAddress !== expectedEscrow) {
      return reject("ACCOUNT_MISMATCH");
    }
    if (
      !result.transactionLt ||
      !/^\d+$/.test(result.transactionLt) ||
      BigInt(result.transactionLt) < 1n
    ) {
      return reject("INVALID_TRANSACTION_LT");
    }
    if (!result.transactionHash) {
      return reject("INVALID_TRANSACTION_HASH");
    }
    if (!result.masterchainSeqno || result.masterchainSeqno < 1) {
      return reject("NOT_MASTERCHAIN_FINALIZED");
    }
    if (!result.transactionTime || result.transactionTime < 1) {
      return reject("INVALID_TRANSACTION_TIME");
    }
    if (result.transactionTime > expected.fundingDeadline) {
      return reject("FUNDING_DEADLINE_EXCEEDED");
    }
    if (transaction.emulated !== false) {
      return reject("EMULATED_OR_UNKNOWN_TRANSACTION");
    }
    if (transaction.description?.aborted !== false) {
      return reject("TRANSACTION_ABORTED_OR_UNKNOWN");
    }
    const compute = transaction.description.compute_ph;
    if (
      !compute ||
      compute.skipped !== false ||
      compute.success !== true ||
      compute.exit_code !== 0
    ) {
      return reject("COMPUTE_FAILED_OR_UNKNOWN");
    }
    const action = transaction.description.action;
    if (
      !action ||
      action.success !== true ||
      action.valid !== true ||
      action.result_code !== 0
    ) {
      return reject("ACTION_FAILED_OR_UNKNOWN");
    }

    const inbound = transaction.in_msg;
    if (!isRecord(inbound)) return reject("MISSING_INBOUND_NOTIFICATION");
    if (!result.messageHash) return reject("INVALID_MESSAGE_HASH");
    if (inbound.bounced !== false) {
      return reject("BOUNCED_OR_UNKNOWN_NOTIFICATION");
    }
    if (result.inboundDestinationAddress !== expectedEscrow) {
      return reject("DESTINATION_MISMATCH");
    }

    if (!Array.isArray(transaction.out_msgs)) {
      return reject("INVALID_OUTBOUND_MESSAGES");
    }
    if (transaction.out_msgs.length !== 0) {
      return reject("UNEXPLAINED_OUTBOUND_MESSAGES");
    }

    if (!isRecord(observation.canonicalWalletEvidence)) {
      return reject("INVALID_CANONICAL_WALLET_EVIDENCE");
    }
    const observedWalletEvidence = observation.canonicalWalletEvidence;
    if (!isRecord(observedWalletEvidence.walletData)) {
      return reject("INVALID_CANONICAL_WALLET_EVIDENCE");
    }
    const walletValidation = validateCanonicalJettonWallet({
      allowlistedMasterAddress: expected.allowlistedMasterAddress,
      expectedOwnerAddress: expected.escrowAddress,
      expectedWalletAddress: expected.escrowJettonWalletAddress,
      masterReportedWalletAddress:
        observedWalletEvidence.masterReportedWalletAddress,
      walletData: observedWalletEvidence.walletData,
    });
    result.canonicalMasterAddress = walletValidation.masterAddress;
    result.canonicalOwnerAddress = walletValidation.ownerAddress;
    result.canonicalWalletAddress = walletValidation.walletAddress;
    if (!walletValidation.accepted) {
      return reject(walletValidation.reasonCode);
    }

    const notificationValidation = validateTonJettonTransferNotification(
      {
        bounced: inbound.bounced,
        sourceAddress: inbound.source,
        destinationAddress: inbound.destination,
        bodyBase64: inbound.message_content?.body,
      },
      expected,
    );
    result.queryId = notificationValidation.queryId;
    result.amountAtomic = notificationValidation.amountAtomic;
    result.notificationSenderAddress = notificationValidation.senderAddress;
    result.forwardPayloadHash = notificationValidation.forwardPayloadHash;
    if (!notificationValidation.accepted) {
      return reject(
        notificationValidation.reasonCode || "INVALID_TEP74_NOTIFICATION",
      );
    }

    return {
      accepted: true,
      reasonCode: "JETTON_FUNDING_CONFIRMED",
      evidence: result,
    };
  } catch {
    return {
      accepted: false,
      reasonCode: "MALFORMED_OBSERVATION",
      evidence: emptyEvidence(),
    };
  }
}

function baseResult(
  transaction: TonCenterTransaction | undefined,
): TonJettonFundingValidationEvidence {
  if (!isRecord(transaction)) return emptyEvidence();
  const inbound = isRecord(transaction.in_msg) ? transaction.in_msg : undefined;
  const description = isRecord(transaction.description)
    ? transaction.description
    : undefined;
  const compute = isRecord(description?.compute_ph)
    ? description.compute_ph
    : undefined;
  const action = isRecord(description?.action) ? description.action : undefined;
  return {
    accountAddress: normalizeAddress(transaction.account),
    transactionLt: typeof transaction.lt === "string" ? transaction.lt : null,
    transactionHash: normalizeHash(transaction.hash),
    masterchainSeqno: Number.isSafeInteger(transaction.mc_block_seqno)
      ? transaction.mc_block_seqno!
      : null,
    transactionTime: Number.isSafeInteger(transaction.now)
      ? transaction.now!
      : null,
    messageHash: normalizeHash(inbound?.hash),
    inboundSourceAddress: normalizeAddress(inbound?.source),
    inboundDestinationAddress: normalizeAddress(inbound?.destination),
    canonicalMasterAddress: null,
    canonicalOwnerAddress: null,
    canonicalWalletAddress: null,
    queryId: null,
    amountAtomic: null,
    notificationSenderAddress: null,
    forwardPayloadHash: null,
    outboundMessageCount: Array.isArray(transaction.out_msgs)
      ? transaction.out_msgs.length
      : null,
    execution: {
      emulated: booleanOrNull(transaction.emulated),
      aborted: booleanOrNull(description?.aborted),
      computeSkipped: booleanOrNull(compute?.skipped),
      computeSuccess: booleanOrNull(compute?.success),
      computeExitCode: integerOrNull(compute?.exit_code),
      actionSuccess: booleanOrNull(action?.success),
      actionValid: booleanOrNull(action?.valid),
      actionResultCode: integerOrNull(action?.result_code),
    },
  };
}

function emptyEvidence(): TonJettonFundingValidationEvidence {
  return {
    accountAddress: null,
    transactionLt: null,
    transactionHash: null,
    masterchainSeqno: null,
    transactionTime: null,
    messageHash: null,
    inboundSourceAddress: null,
    inboundDestinationAddress: null,
    canonicalMasterAddress: null,
    canonicalOwnerAddress: null,
    canonicalWalletAddress: null,
    queryId: null,
    amountAtomic: null,
    notificationSenderAddress: null,
    forwardPayloadHash: null,
    outboundMessageCount: null,
    execution: {
      emulated: null,
      aborted: null,
      computeSkipped: null,
      computeSuccess: null,
      computeExitCode: null,
      actionSuccess: null,
      actionValid: null,
      actionResultCode: null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" ? normalizeTonAddress(value) : null;
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return null;
  try {
    const bytes = Buffer.from(
      value.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}
