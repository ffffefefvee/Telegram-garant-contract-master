import { Address, beginCell, Cell } from "@ton/core";
import {
  TEP74_TRANSFER_NOTIFICATION_OPCODE,
  TonJettonNotificationExpectation,
  validateCanonicalJettonWallet,
  validateTonJettonTransferNotification,
} from "./ton-jetton-notification";

const address = (digit: string) => `0:${digit.repeat(64)}`;
const master = address("1");
const escrow = address("2");
const escrowWallet = address("3");
const buyer = address("4");
const other = address("5");

function notificationBody(input?: {
  opcode?: number;
  queryId?: bigint;
  amount?: bigint;
  sender?: string;
  payload?: Cell;
  payloadInRef?: boolean;
  trailingRef?: boolean;
}): { bodyBase64: string; payload: Cell } {
  const payload =
    input?.payload ??
    beginCell().storeUint(0xa11ce, 32).storeUint(7, 64).endCell();
  const builder = beginCell()
    .storeUint(input?.opcode ?? TEP74_TRANSFER_NOTIFICATION_OPCODE, 32)
    .storeUint(input?.queryId ?? 42n, 64)
    .storeCoins(input?.amount ?? 5_000_000n)
    .storeAddress(Address.parse(input?.sender ?? buyer));
  if (input?.payloadInRef ?? true) {
    builder.storeBit(1).storeRef(payload);
  } else {
    builder.storeBit(0).storeSlice(payload.beginParse());
  }
  if (input?.trailingRef) builder.storeRef(beginCell().endCell());
  return {
    bodyBase64: builder.endCell().toBoc().toString("base64"),
    payload,
  };
}

function expectation(payload: Cell): TonJettonNotificationExpectation {
  return {
    escrowAddress: escrow,
    escrowJettonWalletAddress: escrowWallet,
    buyerAddress: buyer,
    amountAtomic: "5000000",
    queryId: "42",
    forwardPayloadHash: payload.hash().toString("hex"),
  };
}

describe("canonical TON jetton wallet validation", () => {
  it("requires the allowlisted master, derived wallet and wallet-data owner", () => {
    expect(
      validateCanonicalJettonWallet({
        allowlistedMasterAddress: master,
        expectedOwnerAddress: escrow,
        expectedWalletAddress: escrowWallet,
        masterReportedWalletAddress: escrowWallet,
        walletData: {
          walletAddress: escrowWallet,
          ownerAddress: escrow,
          masterAddress: master,
        },
      }),
    ).toMatchObject({ accepted: true, reasonCode: "ACCEPTED" });
  });

  it.each([
    ["JETTON_MASTER_MISMATCH", { masterAddress: other }],
    ["JETTON_OWNER_MISMATCH", { ownerAddress: other }],
    ["JETTON_WALLET_MISMATCH", { walletAddress: other }],
  ])("fails closed with %s", (reasonCode, walletDataOverride) => {
    expect(
      validateCanonicalJettonWallet({
        allowlistedMasterAddress: master,
        expectedOwnerAddress: escrow,
        expectedWalletAddress: escrowWallet,
        masterReportedWalletAddress: escrowWallet,
        walletData: {
          walletAddress: escrowWallet,
          ownerAddress: escrow,
          masterAddress: master,
          ...walletDataOverride,
        },
      }),
    ).toMatchObject({ accepted: false, reasonCode });
  });
});

describe("TEP-74 transfer_notification validation", () => {
  it.each([true, false])(
    "accepts an exact notification with payloadInRef=%s",
    (payloadInRef) => {
      const built = notificationBody({ payloadInRef });
      expect(
        validateTonJettonTransferNotification(
          {
            sourceAddress: escrowWallet,
            destinationAddress: escrow,
            bodyBase64: built.bodyBase64,
            bounced: false,
          },
          expectation(built.payload),
        ),
      ).toMatchObject({
        accepted: true,
        reasonCode: "ACCEPTED",
        queryId: "42",
        amountAtomic: "5000000",
        senderAddress: buyer,
      });
    },
  );

  it.each([
    ["BOUNCED_NOTIFICATION", { bounced: true }, {}],
    ["NOTIFICATION_WALLET_MISMATCH", { sourceAddress: other }, {}],
    ["NOTIFICATION_DESTINATION_MISMATCH", { destinationAddress: other }, {}],
    ["INVALID_NOTIFICATION_OPCODE", {}, { opcode: 1 }],
    ["NOTIFICATION_QUERY_ID_MISMATCH", {}, { queryId: 43n }],
    ["NOTIFICATION_AMOUNT_MISMATCH", {}, { amount: 4_999_999n }],
    ["NOTIFICATION_SENDER_MISMATCH", {}, { sender: other }],
    ["NOTIFICATION_TRAILING_DATA", {}, { trailingRef: true }],
  ])("rejects %s", (reasonCode, messageOverride, bodyOverride) => {
    const built = notificationBody(bodyOverride);
    expect(
      validateTonJettonTransferNotification(
        {
          sourceAddress: escrowWallet,
          destinationAddress: escrow,
          bodyBase64: built.bodyBase64,
          bounced: false,
          ...messageOverride,
        },
        expectation(built.payload),
      ),
    ).toMatchObject({ accepted: false, reasonCode });
  });

  it("rejects a different immutable forward payload", () => {
    const built = notificationBody();
    const expected = expectation(built.payload);
    expected.forwardPayloadHash = "aa".repeat(32);
    expect(
      validateTonJettonTransferNotification(
        {
          sourceAddress: escrowWallet,
          destinationAddress: escrow,
          bodyBase64: built.bodyBase64,
        },
        expected,
      ),
    ).toMatchObject({
      accepted: false,
      reasonCode: "NOTIFICATION_PAYLOAD_MISMATCH",
    });
  });

  it("rejects malformed BOCs without throwing", () => {
    const built = notificationBody();
    expect(
      validateTonJettonTransferNotification(
        {
          sourceAddress: escrowWallet,
          destinationAddress: escrow,
          bodyBase64: "not-a-boc",
        },
        expectation(built.payload),
      ),
    ).toMatchObject({
      accepted: false,
      reasonCode: "MALFORMED_NOTIFICATION_BODY",
    });
  });
});
