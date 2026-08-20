import {
  Account,
  Address,
  beginCell,
  Builder,
  Cell,
  Dictionary,
  DictionaryValue,
  loadMessage,
  Message,
  storeAccount,
  storeMessage,
  storeTransaction,
  Transaction,
} from "@ton/core";
import {
  TonJettonReconciliationExpectation,
  validateTonJettonPayoutReconciliation,
} from "./ton-jetton-reconciliation-validator";

const address = (digit: string) => Address.parseRaw(`0:${digit.repeat(64)}`);
const raw = (value: Address) => value.toRawString();
const owner = address("1");
const senderWallet = address("2");
const recipientOwner = address("3");
const recipientWallet = address("4");
const master = address("5");
const responseDestination = address("6");
const other = address("7");
const walletCode = beginCell().storeUint(0xcafe, 16).endCell();
const payload = beginCell().storeUint(0xbeef, 16).endCell();
const codeHash = walletCode.hash().toString("hex");
const payloadHash = payload.hash().toString("hex");
const hex = (digit: string) => digit.repeat(64);
const hashBigInt = (digit: string) => BigInt(`0x${hex(digit)}`);

const MESSAGE_VALUE: DictionaryValue<Message> = {
  serialize(source: Message, builder: Builder) {
    builder.storeRef(beginCell().store(storeMessage(source)).endCell());
  },
  parse(slice) {
    return loadMessage(slice.loadRef().beginParse());
  },
};

const block = {
  workchain: 0,
  shard: "8000000000000000",
  seqno: 100,
  rootHash: hex("a"),
  fileHash: hex("b"),
  masterchainSeqno: 200,
};

interface FixtureOptions {
  forwardTon?: bigint;
  includeNotification?: boolean;
  includeExcesses?: boolean;
  wrongNotification?: boolean;
  wrongExcessDestination?: boolean;
  extraRecipientMessage?: boolean;
  multiLeg?: boolean;
  transferTrailingData?: boolean;
  breakOwnerSenderLink?: boolean;
  bouncedInternal?: boolean;
  abortedSender?: boolean;
  senderAfter?: bigint;
  recipientAfter?: bigint;
  senderStateMaster?: Address;
}

function transferBody(input: {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  forwardTon: bigint;
  trailing?: boolean;
}): Cell {
  const builder = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(input.queryId, 64)
    .storeCoins(input.amount)
    .storeAddress(input.destination)
    .storeAddress(responseDestination)
    .storeBit(false)
    .storeCoins(input.forwardTon)
    .storeBit(true)
    .storeRef(payload);
  if (input.trailing) builder.storeBit(true);
  return builder.endCell();
}

function internalTransferBody(
  input: {
    amount?: bigint;
    queryId?: bigint;
    forwardTon?: bigint;
  } = {},
): Cell {
  return beginCell()
    .storeUint(0x178d4519, 32)
    .storeUint(input.queryId ?? 42n, 64)
    .storeCoins(input.amount ?? 5_000_000n)
    .storeAddress(owner)
    .storeAddress(responseDestination)
    .storeCoins(input.forwardTon ?? 1n)
    .storeBit(true)
    .storeRef(payload)
    .endCell();
}

function notificationBody(wrong = false): Cell {
  return beginCell()
    .storeUint(0x7362d09c, 32)
    .storeUint(42n, 64)
    .storeCoins(wrong ? 4_999_999n : 5_000_000n)
    .storeAddress(owner)
    .storeBit(true)
    .storeRef(payload)
    .endCell();
}

function excessesBody(): Cell {
  return beginCell().storeUint(0xd53276db, 32).storeUint(42n, 64).endCell();
}

function message(
  source: Address,
  destination: Address,
  body: Cell,
  createdLt: bigint,
  bounced = false,
): Message {
  return {
    info: {
      type: "internal",
      ihrDisabled: true,
      bounce: true,
      bounced,
      src: source,
      dest: destination,
      value: { coins: 100_000_000n },
      ihrFee: 0n,
      forwardFee: 0n,
      createdLt,
      createdAt: 1_700_000_000,
    },
    body,
  };
}

function accountCell(
  wallet: Address,
  walletOwner: Address,
  walletMaster: Address,
  balance: bigint,
  lastTransLt: bigint,
): Cell {
  const data = beginCell()
    .storeCoins(balance)
    .storeAddress(walletOwner)
    .storeAddress(walletMaster)
    .storeRef(walletCode)
    .endCell();
  const account: Account = {
    addr: wallet,
    storageStats: {
      used: { cells: 1n, bits: 1n },
      storageExtra: null,
      lastPaid: 0,
    },
    storage: {
      lastTransLt,
      balance: { coins: 1_000_000_000n },
      state: {
        type: "active",
        state: { code: walletCode, data },
      },
    },
  };
  return beginCell().storeBit(true).store(storeAccount(account)).endCell();
}

function shardAccountBoc(
  account: Cell,
  lastTransactionHash: bigint,
  lastTransactionLt: bigint,
): string {
  return beginCell()
    .storeRef(account)
    .storeUint(lastTransactionHash, 256)
    .storeUint(lastTransactionLt, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

function transactionCell(input: {
  account: Address;
  lt: bigint;
  previousHash: bigint;
  previousLt: bigint;
  inMessage: Message;
  outMessages: Message[];
  oldStateHash: Buffer;
  newStateHash: Buffer;
  aborted?: boolean;
}): Cell {
  const outMessages = Dictionary.empty(Dictionary.Keys.Uint(15), MESSAGE_VALUE);
  input.outMessages.forEach((out, index) => outMessages.set(index, out));
  const transaction: Transaction = {
    address: BigInt(`0x${input.account.hash.toString("hex")}`),
    lt: input.lt,
    prevTransactionHash: input.previousHash,
    prevTransactionLt: input.previousLt,
    now: 1_700_000_000,
    outMessagesCount: input.outMessages.length,
    oldStatus: "active",
    endStatus: "active",
    inMessage: input.inMessage,
    outMessages,
    totalFees: { coins: 0n },
    stateUpdate: {
      oldHash: input.oldStateHash,
      newHash: input.newStateHash,
    },
    description: {
      type: "generic",
      creditFirst: false,
      computePhase: {
        type: "vm",
        success: !input.aborted,
        messageStateUsed: false,
        accountActivated: false,
        gasFees: 0n,
        gasUsed: 1n,
        gasLimit: 2n,
        mode: 0,
        exitCode: input.aborted ? 1 : 0,
        vmSteps: 1,
        vmInitStateHash: 0n,
        vmFinalStateHash: 0n,
      },
      actionPhase: {
        success: !input.aborted,
        valid: true,
        noFunds: false,
        statusChange: "unchanged",
        resultCode: input.aborted ? 1 : 0,
        totalActions: input.outMessages.length,
        specActions: 0,
        skippedActions: 0,
        messagesCreated: input.outMessages.length,
        actionListHash: 0n,
        totalMessageSize: { cells: 1n, bits: 1n },
      },
      aborted: input.aborted ?? false,
      destroyed: false,
    },
    raw: beginCell().endCell(),
    hash: () => Buffer.alloc(32),
  };
  return beginCell().store(storeTransaction(transaction)).endCell();
}

function walletTransaction(input: {
  wallet: Address;
  walletOwner: Address;
  walletMaster: Address;
  lt: bigint;
  previousHashDigit: string;
  previousLt: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  inMessage: Message;
  outMessages: Message[];
  aborted?: boolean;
}) {
  const before = accountCell(
    input.wallet,
    input.walletOwner,
    input.walletMaster,
    input.balanceBefore,
    input.previousLt,
  );
  const after = accountCell(
    input.wallet,
    input.walletOwner,
    input.walletMaster,
    input.balanceAfter,
    input.lt,
  );
  const previousHash = hashBigInt(input.previousHashDigit);
  const tx = transactionCell({
    account: input.wallet,
    lt: input.lt,
    previousHash,
    previousLt: input.previousLt,
    inMessage: input.inMessage,
    outMessages: input.outMessages,
    oldStateHash: before.hash(),
    newStateHash: after.hash(),
    aborted: input.aborted,
  });
  const transactionHash = BigInt(`0x${tx.hash().toString("hex")}`);
  return {
    bocBase64: tx.toBoc().toString("base64"),
    block: structuredClone(block),
    shardAccountBeforeBocBase64: shardAccountBoc(
      before,
      previousHash,
      input.previousLt,
    ),
    shardAccountAfterBocBase64: shardAccountBoc(
      after,
      transactionHash,
      input.lt,
    ),
  };
}

function fixture(options: FixtureOptions = {}) {
  const forwardTon = options.forwardTon ?? 1n;
  const ownerToWallet = message(
    owner,
    senderWallet,
    transferBody({
      queryId: 42n,
      amount: 5_000_000n,
      destination: recipientOwner,
      forwardTon,
      trailing: options.transferTrailingData,
    }),
    101n,
  );
  const secondOwnerMessage = message(
    owner,
    senderWallet,
    transferBody({
      queryId: 43n,
      amount: 1_000_000n,
      destination: other,
      forwardTon: 0n,
    }),
    102n,
  );
  const walletToWallet = message(
    senderWallet,
    recipientWallet,
    internalTransferBody({ forwardTon }),
    201n,
    options.bouncedInternal,
  );
  const ownerTx = transactionCell({
    account: owner,
    lt: 100n,
    previousHash: hashBigInt("1"),
    previousLt: 99n,
    inMessage: message(
      other,
      owner,
      beginCell().storeUint(1, 32).endCell(),
      99n,
    ),
    outMessages: options.multiLeg
      ? [ownerToWallet, secondOwnerMessage]
      : [ownerToWallet],
    oldStateHash: Buffer.from(hex("2"), "hex"),
    newStateHash: Buffer.from(hex("3"), "hex"),
  });

  const recipientOut: Message[] = [];
  const includeNotification = options.includeNotification ?? forwardTon > 0n;
  if (includeNotification) {
    recipientOut.push(
      message(
        recipientWallet,
        recipientOwner,
        notificationBody(options.wrongNotification),
        301n,
      ),
    );
  }
  if (options.includeExcesses) {
    recipientOut.push(
      message(
        recipientWallet,
        options.wrongExcessDestination ? other : responseDestination,
        excessesBody(),
        302n,
      ),
    );
  }
  if (options.extraRecipientMessage) {
    recipientOut.push(
      message(
        recipientWallet,
        other,
        beginCell().storeUint(0x12345678, 32).endCell(),
        303n,
      ),
    );
  }

  const senderTx = walletTransaction({
    wallet: senderWallet,
    walletOwner: owner,
    walletMaster: options.senderStateMaster ?? master,
    lt: 200n,
    previousHashDigit: "4",
    previousLt: 199n,
    balanceBefore: 9_000_000n,
    balanceAfter: options.senderAfter ?? 4_000_000n,
    inMessage: options.breakOwnerSenderLink
      ? message(owner, senderWallet, ownerToWallet.body, 999n)
      : ownerToWallet,
    outMessages: [walletToWallet],
    aborted: options.abortedSender,
  });
  const recipientTx = walletTransaction({
    wallet: recipientWallet,
    walletOwner: recipientOwner,
    walletMaster: master,
    lt: 300n,
    previousHashDigit: "5",
    previousLt: 299n,
    balanceBefore: 1_000_000n,
    balanceAfter: options.recipientAfter ?? 6_000_000n,
    inMessage: walletToWallet,
    outMessages: recipientOut,
  });
  const ownerOutbox: TonJettonReconciliationExpectation["ownerOutbox"] = [
    {
      leg: "seller",
      attempt: 1,
      queryId: "42",
      amountAtomic: "5000000",
      destinationOwnerAddress: raw(recipientOwner),
      recipientWalletAddress: raw(recipientWallet),
      responseDestinationAddress: raw(responseDestination),
      forwardTonAmountAtomic: forwardTon.toString(),
      forwardPayloadHash: payloadHash,
    },
  ];
  if (options.multiLeg) {
    ownerOutbox.push({
      leg: "treasury",
      attempt: 1,
      queryId: "43",
      amountAtomic: "1000000",
      destinationOwnerAddress: raw(other),
      recipientWalletAddress: raw(other),
      responseDestinationAddress: raw(responseDestination),
      forwardTonAmountAtomic: "0",
      forwardPayloadHash: payloadHash,
    });
  }
  const expected: TonJettonReconciliationExpectation = {
    settlementId: "settlement-1",
    leg: "seller",
    attempt: 1,
    allowlistedMasterAddress: raw(master),
    jettonWalletCodeHash: codeHash,
    senderOwnerAddress: raw(owner),
    senderWalletAddress: raw(senderWallet),
    recipientOwnerAddress: raw(recipientOwner),
    recipientWalletAddress: raw(recipientWallet),
    amountAtomic: "5000000",
    queryId: "42",
    responseDestinationAddress: raw(responseDestination),
    forwardTonAmountAtomic: forwardTon.toString(),
    forwardPayloadHash: payloadHash,
    ownerTransaction: {
      accountAddress: raw(owner),
      lt: "100",
      hash: ownerTx.hash().toString("hex"),
    },
    ownerOutbox,
    collectors: [
      { sourceId: "archive-a", operatorId: "operator-a" },
      { sourceId: "archive-b", operatorId: "operator-b" },
    ],
  };
  const observation = {
    ownerTransferTransaction: {
      bocBase64: ownerTx.toBoc().toString("base64"),
      block: structuredClone(block),
    },
    senderWalletTransaction: senderTx,
    recipientWalletTransaction: recipientTx,
  };
  return {
    expected,
    input: {
      sources: [
        { sourceId: "archive-a", observation },
        { sourceId: "archive-b", observation: structuredClone(observation) },
      ],
    },
  };
}

function result(options: FixtureOptions = {}) {
  const value = fixture(options);
  return validateTonJettonPayoutReconciliation(value.input, value.expected);
}

describe("Jetton payout raw-evidence reconciliation precheck", () => {
  it("parses and cross-links raw transaction/account BOCs but refuses settlement without a masterchain proof", () => {
    expect(result()).toMatchObject({
      accepted: false,
      reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
      evidence: {
        sourceIds: ["archive-a", "archive-b"],
        operatorIds: ["operator-a", "operator-b"],
        settlementId: "settlement-1",
        leg: "seller",
        attempt: 1,
        senderBalanceBefore: "9000000",
        senderBalanceAfter: "4000000",
        recipientBalanceBefore: "1000000",
        recipientBalanceAfter: "6000000",
        structuralChecksPassed: true,
        finalityProven: false,
        settlementAuthorized: false,
        remainingRequirement: "VERIFIED_MASTERCHAIN_SHARD_INCLUSION",
        agreementFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("supports a complete committed multi-leg owner outbox", () => {
    expect(result({ multiLeg: true })).toMatchObject({
      reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
      evidence: { structuralChecksPassed: true },
    });
  });

  it("accepts an exact optional excesses message structurally", () => {
    expect(result({ includeExcesses: true })).toMatchObject({
      reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
      evidence: { structuralChecksPassed: true },
    });
  });

  it("accepts no notification only when forward TON is zero", () => {
    expect(result({ forwardTon: 0n })).toMatchObject({
      reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
      evidence: { structuralChecksPassed: true },
    });
  });

  it.each([null, undefined, [], "bad", 1, true])(
    "fails closed without throwing for malformed input %p",
    (input) => {
      const value = fixture();
      expect(() =>
        validateTonJettonPayoutReconciliation(input, value.expected),
      ).not.toThrow();
      expect(
        validateTonJettonPayoutReconciliation(input, value.expected),
      ).toMatchObject({ accepted: false, reasonCode: "MALFORMED_INPUT" });
    },
  );

  it("rejects self-declared collector independence fields", () => {
    const value = fixture();
    (value.input.sources[0] as any).operatorId = "forged-operator";
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "UNEXPECTED_SOURCE_IDENTITY" });
  });

  it("rejects duplicate configured operators", () => {
    const value = fixture();
    value.expected.collectors[1].operatorId = "operator-a";
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "INVALID_EXPECTATION" });
  });

  it("rejects a raw owner transaction not bound to the submitted attempt", () => {
    const value = fixture();
    value.expected.ownerTransaction.hash = hex("f");
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "TRANSACTION_IDENTITY_MISMATCH" });
  });

  it("rejects provider-decoded body objects at the boundary", () => {
    const value = fixture();
    (value.input.sources[0].observation.ownerTransferTransaction as any).body =
      {
        queryId: "42",
      };
    (value.input.sources[1].observation.ownerTransferTransaction as any).body =
      {
        queryId: "42",
      };
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "INVALID_RAW_TRANSACTION" });
  });

  it("rejects malformed raw transaction BOCs", () => {
    const value = fixture();
    value.input.sources.forEach((source) => {
      source.observation.ownerTransferTransaction.bocBase64 = "AAAA";
    });
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "INVALID_RAW_TRANSACTION" });
  });

  it("rejects trailing data after a referenced transfer payload", () => {
    expect(result({ transferTrailingData: true })).toMatchObject({
      reasonCode: "OWNER_OUTBOX_MISMATCH",
    });
  });

  it("rejects a raw message-link mismatch", () => {
    expect(result({ breakOwnerSenderLink: true })).toMatchObject({
      reasonCode: "MESSAGE_LINK_MISMATCH",
    });
  });

  it("rejects bounced internal transfers", () => {
    expect(result({ bouncedInternal: true })).toMatchObject({
      reasonCode: "BOUNCED_MESSAGE",
    });
  });

  it("rejects failed raw transaction execution", () => {
    expect(result({ abortedSender: true })).toMatchObject({
      reasonCode: "TRANSACTION_EXECUTION_FAILED",
    });
  });

  it("requires transfer_notification for positive forward TON", () => {
    expect(result({ includeNotification: false })).toMatchObject({
      reasonCode: "RECIPIENT_OUTBOX_MISMATCH",
    });
  });

  it("rejects a wrong transfer_notification body", () => {
    expect(result({ wrongNotification: true })).toMatchObject({
      reasonCode: "TRANSFER_NOTIFICATION_MISMATCH",
    });
  });

  it("rejects a wrong excesses destination", () => {
    expect(
      result({ includeExcesses: true, wrongExcessDestination: true }),
    ).toMatchObject({ reasonCode: "EXCESSES_MISMATCH" });
  });

  it("rejects unexplained recipient messages", () => {
    expect(result({ extraRecipientMessage: true })).toMatchObject({
      reasonCode: "RECIPIENT_OUTBOX_MISMATCH",
    });
  });

  it("binds raw account roots and last transaction identities to state_update", () => {
    const value = fixture();
    value.input.sources.forEach((source) => {
      source.observation.senderWalletTransaction.shardAccountBeforeBocBase64 =
        source.observation.senderWalletTransaction.shardAccountAfterBocBase64;
    });
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "STATE_UPDATE_MISMATCH" });
  });

  it("locally authenticates Jetton wallet master and code from account data", () => {
    expect(result({ senderStateMaster: other })).toMatchObject({
      reasonCode: "JETTON_WALLET_DATA_MISMATCH",
    });
  });

  it("rejects incorrect sender and recipient balance deltas", () => {
    expect(result({ senderAfter: 4_000_001n })).toMatchObject({
      reasonCode: "SENDER_DEBIT_MISMATCH",
    });
    expect(result({ recipientAfter: 5_999_999n })).toMatchObject({
      reasonCode: "RECIPIENT_CREDIT_MISMATCH",
    });
  });

  it("expands source consensus over block identities", () => {
    const value = fixture();
    value.input.sources[1].observation.senderWalletTransaction.block.seqno += 1;
    expect(
      validateTonJettonPayoutReconciliation(value.input, value.expected),
    ).toMatchObject({ reasonCode: "SOURCE_DISAGREEMENT" });
  });
});
