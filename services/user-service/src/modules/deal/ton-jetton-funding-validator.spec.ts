import { Address, beginCell, Cell } from "@ton/core";
import {
  TEP74_TRANSFER_NOTIFICATION_OPCODE,
  TonJettonWalletEvidence,
} from "../escrow/adapters/ton-jetton-notification";
import { TonCenterTransaction } from "./ton-center-v3.service";
import {
  TonJettonFundingExpectation,
  TonJettonFundingObservation,
  validateTonJettonFundingObservation,
} from "./ton-jetton-funding-validator";

const rawAddress = (digit: string) => `0:${digit.repeat(64)}`;
const master = rawAddress("1");
const escrow = rawAddress("2");
const escrowWallet = rawAddress("3");
const buyer = rawAddress("4");
const other = rawAddress("5");
const transactionHash = "aa".repeat(32);
const messageHash = "bb".repeat(32);
const fundingDeadline = 2_000_000_000;

function notificationBody(input?: {
  amount?: bigint;
  sender?: string;
  queryId?: bigint;
  payload?: Cell;
}): { body: string; payload: Cell } {
  const payload =
    input?.payload ??
    beginCell().storeUint(0xfeed, 32).storeUint(123, 64).endCell();
  return {
    body: beginCell()
      .storeUint(TEP74_TRANSFER_NOTIFICATION_OPCODE, 32)
      .storeUint(input?.queryId ?? 42n, 64)
      .storeCoins(input?.amount ?? 5_000_000n)
      .storeAddress(Address.parse(input?.sender ?? buyer))
      .storeBit(1)
      .storeRef(payload)
      .endCell()
      .toBoc()
      .toString("base64"),
    payload,
  };
}

function validFixture(): {
  observation: TonJettonFundingObservation;
  expected: TonJettonFundingExpectation;
} {
  const built = notificationBody();
  const canonicalWalletEvidence: TonJettonWalletEvidence = {
    allowlistedMasterAddress: master,
    expectedOwnerAddress: escrow,
    expectedWalletAddress: escrowWallet,
    masterReportedWalletAddress: escrowWallet,
    walletData: {
      walletAddress: escrowWallet,
      ownerAddress: escrow,
      masterAddress: master,
    },
  };
  return {
    observation: {
      transaction: {
        account: escrow,
        lt: "987654321",
        hash: transactionHash,
        mc_block_seqno: 123456,
        now: fundingDeadline - 1,
        emulated: false,
        description: {
          aborted: false,
          compute_ph: {
            skipped: false,
            success: true,
            exit_code: 0,
          },
          action: { success: true, valid: true, result_code: 0 },
        },
        in_msg: {
          bounced: false,
          hash: messageHash,
          source: escrowWallet,
          destination: escrow,
          message_content: { body: built.body },
        },
        out_msgs: [],
      },
      canonicalWalletEvidence,
    },
    expected: {
      allowlistedMasterAddress: master,
      escrowAddress: escrow,
      escrowJettonWalletAddress: escrowWallet,
      buyerAddress: buyer,
      amountAtomic: "5000000",
      queryId: "42",
      forwardPayloadHash: built.payload.hash().toString("hex"),
      fundingDeadline,
    },
  };
}

function validate(fixture = validFixture()) {
  return validateTonJettonFundingObservation(
    fixture.observation,
    fixture.expected,
  );
}

describe("finalized TON Jetton funding observation", () => {
  it("accepts exact finalized transaction, wallet and TEP-74 evidence", () => {
    const result = validate();

    expect(result).toEqual({
      accepted: true,
      reasonCode: "JETTON_FUNDING_CONFIRMED",
      evidence: expect.objectContaining({
        accountAddress: escrow,
        transactionLt: "987654321",
        transactionHash,
        masterchainSeqno: 123456,
        transactionTime: fundingDeadline - 1,
        messageHash,
        inboundSourceAddress: escrowWallet,
        inboundDestinationAddress: escrow,
        canonicalMasterAddress: master,
        canonicalOwnerAddress: escrow,
        canonicalWalletAddress: escrowWallet,
        queryId: "42",
        amountAtomic: "5000000",
        notificationSenderAddress: buyer,
        outboundMessageCount: 0,
      }),
    });
  });

  it("accepts a canonical base64 transaction and message hash", () => {
    const fixture = validFixture();
    fixture.observation.transaction.hash = Buffer.from(
      transactionHash,
      "hex",
    ).toString("base64");
    fixture.observation.transaction.in_msg!.hash = Buffer.from(
      messageHash,
      "hex",
    ).toString("base64url");

    expect(validate(fixture)).toMatchObject({
      accepted: true,
      evidence: { transactionHash, messageHash },
    });
  });

  it.each([
    ["ACCOUNT_MISMATCH", (tx: TonCenterTransaction) => (tx.account = other)],
    ["INVALID_TRANSACTION_LT", (tx: TonCenterTransaction) => (tx.lt = "0")],
    ["INVALID_TRANSACTION_LT", (tx: TonCenterTransaction) => (tx.lt = "1e3")],
    [
      "INVALID_TRANSACTION_HASH",
      (tx: TonCenterTransaction) => (tx.hash = "short"),
    ],
    [
      "NOT_MASTERCHAIN_FINALIZED",
      (tx: TonCenterTransaction) => (tx.mc_block_seqno = 0),
    ],
    ["INVALID_TRANSACTION_TIME", (tx: TonCenterTransaction) => (tx.now = 0)],
    [
      "FUNDING_DEADLINE_EXCEEDED",
      (tx: TonCenterTransaction) => (tx.now = fundingDeadline + 1),
    ],
    [
      "INVALID_MESSAGE_HASH",
      (tx: TonCenterTransaction) => (tx.in_msg!.hash = "invalid"),
    ],
  ])("rejects incomplete durable identity with %s", (reasonCode, mutate) => {
    const fixture = validFixture();
    mutate(fixture.observation.transaction);
    expect(validate(fixture)).toMatchObject({ accepted: false, reasonCode });
  });

  it.each([
    [
      "EMULATED_OR_UNKNOWN_TRANSACTION",
      (tx: TonCenterTransaction) => (tx.emulated = true),
    ],
    [
      "EMULATED_OR_UNKNOWN_TRANSACTION",
      (tx: TonCenterTransaction) => delete tx.emulated,
    ],
    [
      "TRANSACTION_ABORTED_OR_UNKNOWN",
      (tx: TonCenterTransaction) => (tx.description!.aborted = true),
    ],
    [
      "COMPUTE_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) =>
        (tx.description!.compute_ph!.success = false),
    ],
    [
      "COMPUTE_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) =>
        (tx.description!.compute_ph!.skipped = true),
    ],
    [
      "COMPUTE_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) => (tx.description!.compute_ph!.exit_code = 1),
    ],
    [
      "ACTION_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) => delete tx.description!.action,
    ],
    [
      "ACTION_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) => (tx.description!.action!.valid = false),
    ],
    [
      "ACTION_FAILED_OR_UNKNOWN",
      (tx: TonCenterTransaction) => (tx.description!.action!.result_code = 32),
    ],
  ])(
    "rejects unsuccessful or unknown execution with %s",
    (reasonCode, mutate) => {
      const fixture = validFixture();
      mutate(fixture.observation.transaction);
      expect(validate(fixture)).toMatchObject({ accepted: false, reasonCode });
    },
  );

  it.each([
    [
      "MISSING_INBOUND_NOTIFICATION",
      (tx: TonCenterTransaction) => delete tx.in_msg,
    ],
    [
      "BOUNCED_OR_UNKNOWN_NOTIFICATION",
      (tx: TonCenterTransaction) => (tx.in_msg!.bounced = true),
    ],
    [
      "BOUNCED_OR_UNKNOWN_NOTIFICATION",
      (tx: TonCenterTransaction) => delete tx.in_msg!.bounced,
    ],
    [
      "DESTINATION_MISMATCH",
      (tx: TonCenterTransaction) => (tx.in_msg!.destination = other),
    ],
    [
      "INVALID_OUTBOUND_MESSAGES",
      (tx: TonCenterTransaction) => delete tx.out_msgs,
    ],
    [
      "UNEXPLAINED_OUTBOUND_MESSAGES",
      (tx: TonCenterTransaction) => tx.out_msgs!.push({ destination: other }),
    ],
  ])("rejects an unsafe message envelope with %s", (reasonCode, mutate) => {
    const fixture = validFixture();
    mutate(fixture.observation.transaction);
    expect(validate(fixture)).toMatchObject({ accepted: false, reasonCode });
  });

  it.each([
    [
      "JETTON_MASTER_MISMATCH",
      (evidence: TonJettonWalletEvidence) =>
        (evidence.walletData.masterAddress = other),
    ],
    [
      "JETTON_OWNER_MISMATCH",
      (evidence: TonJettonWalletEvidence) =>
        (evidence.walletData.ownerAddress = other),
    ],
    [
      "JETTON_WALLET_MISMATCH",
      (evidence: TonJettonWalletEvidence) =>
        (evidence.walletData.walletAddress = other),
    ],
    [
      "JETTON_WALLET_MISMATCH",
      (evidence: TonJettonWalletEvidence) =>
        (evidence.masterReportedWalletAddress = other),
    ],
  ])("rejects non-canonical wallet evidence with %s", (reasonCode, mutate) => {
    const fixture = validFixture();
    mutate(fixture.observation.canonicalWalletEvidence);
    expect(validate(fixture)).toMatchObject({ accepted: false, reasonCode });
  });

  it.each([
    [
      "NOTIFICATION_WALLET_MISMATCH",
      (tx: TonCenterTransaction) => (tx.in_msg!.source = other),
    ],
    [
      "MALFORMED_NOTIFICATION_BODY",
      (tx: TonCenterTransaction) =>
        (tx.in_msg!.message_content!.body = "not-a-boc"),
    ],
  ])("rejects invalid TEP-74 evidence with %s", (reasonCode, mutate) => {
    const fixture = validFixture();
    mutate(fixture.observation.transaction);
    expect(validate(fixture)).toMatchObject({ accepted: false, reasonCode });
  });

  it("rejects a notification amount different from the committed amount", () => {
    const fixture = validFixture();
    fixture.expected.amountAtomic = "4999999";
    expect(validate(fixture)).toMatchObject({
      accepted: false,
      reasonCode: "NOTIFICATION_AMOUNT_MISMATCH",
    });
  });

  it("rejects an invalid expectation before trusting its evidence", () => {
    const fixture = validFixture();
    fixture.expected.fundingDeadline = Number.NaN;
    expect(validate(fixture)).toMatchObject({
      accepted: false,
      reasonCode: "INVALID_EXPECTATION",
    });
  });

  it("never throws for structurally malformed observations", () => {
    const fixture = validFixture();
    expect(() =>
      validateTonJettonFundingObservation(
        null as unknown as TonJettonFundingObservation,
        fixture.expected,
      ),
    ).not.toThrow();
    expect(
      validateTonJettonFundingObservation(
        {
          transaction: [] as unknown as TonCenterTransaction,
          canonicalWalletEvidence: null as unknown as TonJettonWalletEvidence,
        },
        fixture.expected,
      ),
    ).toMatchObject({ accepted: false, reasonCode: "MALFORMED_OBSERVATION" });
  });
});
