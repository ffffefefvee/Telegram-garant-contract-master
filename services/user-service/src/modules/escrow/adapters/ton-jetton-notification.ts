import { Cell } from "@ton/core";
import { normalizeTonAddress } from "./ton-address";

export const TEP74_TRANSFER_NOTIFICATION_OPCODE = 0x7362d09c;

export interface TonJettonWalletEvidence {
  allowlistedMasterAddress: string;
  expectedOwnerAddress: string;
  expectedWalletAddress: string;
  masterReportedWalletAddress: string;
  walletData: {
    walletAddress: string;
    ownerAddress: string;
    masterAddress: string;
  };
}

export interface TonJettonWalletValidation {
  accepted: boolean;
  reasonCode: string;
  masterAddress: string | null;
  ownerAddress: string | null;
  walletAddress: string | null;
}

export interface TonJettonNotificationExpectation {
  escrowAddress: string;
  escrowJettonWalletAddress: string;
  buyerAddress: string;
  amountAtomic: string;
  queryId: string;
  forwardPayloadHash: string;
}

export interface TonJettonNotificationInput {
  bounced?: boolean;
  sourceAddress?: string;
  destinationAddress?: string;
  bodyBase64?: string;
}

export interface TonJettonNotificationValidation {
  accepted: boolean;
  reasonCode: string;
  queryId: string | null;
  amountAtomic: string | null;
  senderAddress: string | null;
  forwardPayloadHash: string | null;
}

/**
 * Validate independently collected get_wallet_address and get_wallet_data
 * evidence. Token metadata is deliberately absent because symbol/name/image
 * are not authentication data.
 */
export function validateCanonicalJettonWallet(
  evidence: TonJettonWalletEvidence,
): TonJettonWalletValidation {
  const masterAddress = normalizeTonAddress(evidence.allowlistedMasterAddress);
  const expectedOwnerAddress = normalizeTonAddress(
    evidence.expectedOwnerAddress,
  );
  const expectedWalletAddress = normalizeTonAddress(
    evidence.expectedWalletAddress,
  );
  const masterReportedWalletAddress = normalizeTonAddress(
    evidence.masterReportedWalletAddress,
  );
  const walletAddress = normalizeTonAddress(evidence.walletData.walletAddress);
  const ownerAddress = normalizeTonAddress(evidence.walletData.ownerAddress);
  const walletMasterAddress = normalizeTonAddress(
    evidence.walletData.masterAddress,
  );
  const reject = (reasonCode: string): TonJettonWalletValidation => ({
    accepted: false,
    reasonCode,
    masterAddress,
    ownerAddress,
    walletAddress,
  });

  if (
    !masterAddress ||
    !expectedOwnerAddress ||
    !expectedWalletAddress ||
    !masterReportedWalletAddress ||
    !walletAddress ||
    !ownerAddress ||
    !walletMasterAddress
  ) {
    return reject("INVALID_ADDRESS_EVIDENCE");
  }
  if (walletMasterAddress !== masterAddress) {
    return reject("JETTON_MASTER_MISMATCH");
  }
  if (ownerAddress !== expectedOwnerAddress) {
    return reject("JETTON_OWNER_MISMATCH");
  }
  if (
    masterReportedWalletAddress !== expectedWalletAddress ||
    walletAddress !== expectedWalletAddress
  ) {
    return reject("JETTON_WALLET_MISMATCH");
  }

  return {
    accepted: true,
    reasonCode: "ACCEPTED",
    masterAddress,
    ownerAddress,
    walletAddress,
  };
}

/**
 * Parse and validate the exact TEP-74 transfer_notification received by the
 * escrow owner. The caller must separately require finalized transaction
 * execution and canonical-wallet evidence from validateCanonicalJettonWallet.
 */
export function validateTonJettonTransferNotification(
  input: TonJettonNotificationInput,
  expected: TonJettonNotificationExpectation,
): TonJettonNotificationValidation {
  const result: TonJettonNotificationValidation = {
    accepted: false,
    reasonCode: "UNVALIDATED",
    queryId: null,
    amountAtomic: null,
    senderAddress: null,
    forwardPayloadHash: null,
  };
  const reject = (reasonCode: string): TonJettonNotificationValidation => ({
    ...result,
    accepted: false,
    reasonCode,
  });

  if (input.bounced === true) return reject("BOUNCED_NOTIFICATION");

  const sourceAddress = normalizeTonAddress(input.sourceAddress ?? "");
  const destinationAddress = normalizeTonAddress(
    input.destinationAddress ?? "",
  );
  const expectedWallet = normalizeTonAddress(
    expected.escrowJettonWalletAddress,
  );
  const expectedEscrow = normalizeTonAddress(expected.escrowAddress);
  const expectedBuyer = normalizeTonAddress(expected.buyerAddress);
  if (!expectedWallet || !expectedEscrow || !expectedBuyer) {
    return reject("INVALID_EXPECTATION_ADDRESS");
  }
  if (sourceAddress !== expectedWallet) {
    return reject("NOTIFICATION_WALLET_MISMATCH");
  }
  if (destinationAddress !== expectedEscrow) {
    return reject("NOTIFICATION_DESTINATION_MISMATCH");
  }
  if (
    !/^\d+$/.test(expected.amountAtomic) ||
    BigInt(expected.amountAtomic) < 1n
  ) {
    return reject("INVALID_EXPECTED_AMOUNT");
  }
  if (!/^\d+$/.test(expected.queryId)) {
    return reject("INVALID_EXPECTED_QUERY_ID");
  }
  if (!/^[0-9a-f]{64}$/.test(expected.forwardPayloadHash)) {
    return reject("INVALID_EXPECTED_PAYLOAD_HASH");
  }

  try {
    if (!input.bodyBase64) return reject("MISSING_NOTIFICATION_BODY");
    const roots = Cell.fromBoc(Buffer.from(input.bodyBase64, "base64"));
    if (roots.length !== 1) return reject("INVALID_NOTIFICATION_BODY");
    const slice = roots[0].beginParse();
    const opcode = slice.loadUint(32);
    if (opcode !== TEP74_TRANSFER_NOTIFICATION_OPCODE) {
      return reject("INVALID_NOTIFICATION_OPCODE");
    }

    const queryId = slice.loadUintBig(64);
    const amount = slice.loadCoins();
    const sender = slice.loadAddress();
    const payloadInRef = slice.loadBit();
    const payload = payloadInRef ? slice.loadRef() : slice.asCell();

    if (
      payloadInRef &&
      (slice.remainingBits !== 0 || slice.remainingRefs !== 0)
    ) {
      return reject("NOTIFICATION_TRAILING_DATA");
    }

    result.queryId = queryId.toString();
    result.amountAtomic = amount.toString();
    result.senderAddress = normalizeTonAddress(sender.toRawString());
    result.forwardPayloadHash = payload.hash().toString("hex");
  } catch {
    return reject("MALFORMED_NOTIFICATION_BODY");
  }

  if (result.queryId !== expected.queryId) {
    return reject("NOTIFICATION_QUERY_ID_MISMATCH");
  }
  if (result.amountAtomic !== expected.amountAtomic) {
    return reject("NOTIFICATION_AMOUNT_MISMATCH");
  }
  if (result.senderAddress !== expectedBuyer) {
    return reject("NOTIFICATION_SENDER_MISMATCH");
  }
  if (result.forwardPayloadHash !== expected.forwardPayloadHash) {
    return reject("NOTIFICATION_PAYLOAD_MISMATCH");
  }

  return { ...result, accepted: true, reasonCode: "ACCEPTED" };
}
