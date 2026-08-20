import { createHash } from "node:crypto";
import {
  Address,
  Cell,
  Dictionary,
  loadAccount,
  loadMessage,
  loadTransaction,
  Message,
  Transaction,
} from "@ton/core";
import { normalizeTonAddress } from "../escrow/adapters/ton-address";

const TRANSFER_OPCODE = 0x0f8a7ea5;
const INTERNAL_TRANSFER_OPCODE = 0x178d4519;
const TRANSFER_NOTIFICATION_OPCODE = 0x7362d09c;
const EXCESSES_OPCODE = 0xd53276db;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_BOC_BASE64_LENGTH = 2_000_000;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

export type TonJettonPayoutLegKind = "buyer" | "seller" | "treasury";

export type TonJettonReconciliationReasonCode =
  | "MASTERCHAIN_PROOF_REQUIRED"
  | "MALFORMED_INPUT"
  | "INVALID_EXPECTATION"
  | "INVALID_SOURCE_COUNT"
  | "UNEXPECTED_SOURCE_IDENTITY"
  | "SOURCE_DISAGREEMENT"
  | "INVALID_RAW_TRANSACTION"
  | "TRANSACTION_IDENTITY_MISMATCH"
  | "TRANSACTION_ACCOUNT_MISMATCH"
  | "TRANSACTION_EXECUTION_FAILED"
  | "MISSING_MESSAGE"
  | "BOUNCED_MESSAGE"
  | "MESSAGE_LINK_MISMATCH"
  | "MESSAGE_ENVELOPE_MISMATCH"
  | "OWNER_OUTBOX_MISMATCH"
  | "INTERNAL_TRANSFER_FIELD_MISMATCH"
  | "RECIPIENT_OUTBOX_MISMATCH"
  | "TRANSFER_NOTIFICATION_MISMATCH"
  | "EXCESSES_MISMATCH"
  | "INVALID_STATE_PROOF"
  | "STATE_UPDATE_MISMATCH"
  | "JETTON_WALLET_DATA_MISMATCH"
  | "SENDER_DEBIT_MISMATCH"
  | "RECIPIENT_CREDIT_MISMATCH";

export interface TonJettonCollectorExpectation {
  sourceId: string;
  operatorId: string;
}

export interface TonJettonOwnerOutboxLegExpectation {
  leg: TonJettonPayoutLegKind;
  attempt: number;
  queryId: string;
  amountAtomic: string;
  destinationOwnerAddress: string;
  recipientWalletAddress: string;
  responseDestinationAddress: string;
  forwardTonAmountAtomic: string;
  forwardPayloadHash: string;
}

export interface TonJettonReconciliationExpectation {
  settlementId: string;
  leg: TonJettonPayoutLegKind;
  attempt: number;
  allowlistedMasterAddress: string;
  jettonWalletCodeHash: string;
  senderOwnerAddress: string;
  senderWalletAddress: string;
  recipientOwnerAddress: string;
  recipientWalletAddress: string;
  amountAtomic: string;
  queryId: string;
  responseDestinationAddress: string;
  forwardTonAmountAtomic: string;
  forwardPayloadHash: string;
  ownerTransaction: {
    accountAddress: string;
    lt: string;
    hash: string;
  };
  ownerOutbox: TonJettonOwnerOutboxLegExpectation[];
  collectors: [TonJettonCollectorExpectation, TonJettonCollectorExpectation];
}

export interface TonJettonReconciliationEvidence {
  sourceIds: string[];
  operatorIds: string[];
  settlementId: string | null;
  leg: TonJettonPayoutLegKind | null;
  attempt: number | null;
  transactionHashes: string[];
  transactionLts: string[];
  messageHashes: string[];
  stateHashes: string[];
  blockFingerprints: string[];
  senderWalletAddress: string | null;
  recipientWalletAddress: string | null;
  senderBalanceBefore: string | null;
  senderBalanceAfter: string | null;
  recipientBalanceBefore: string | null;
  recipientBalanceAfter: string | null;
  amountAtomic: string | null;
  queryId: string | null;
  agreementFingerprint: string | null;
  structuralChecksPassed: boolean;
  finalityProven: false;
  settlementAuthorized: false;
  remainingRequirement: "VERIFIED_MASTERCHAIN_SHARD_INCLUSION";
}

export interface TonJettonReconciliationValidation {
  accepted: false;
  reasonCode: TonJettonReconciliationReasonCode;
  evidence: TonJettonReconciliationEvidence;
}

/**
 * Pure structural reconciliation of one Jetton payout leg. Raw transaction and
 * account cells are parsed locally and cross-linked. This function deliberately
 * never authorizes settlement: verified shard inclusion in a finalized
 * masterchain block is not implemented in this slice.
 */
export function validateTonJettonPayoutReconciliation(
  input: unknown,
  expectation: unknown,
): TonJettonReconciliationValidation {
  const evidence = emptyEvidence();
  const reject = (
    reasonCode: TonJettonReconciliationReasonCode,
  ): TonJettonReconciliationValidation => ({
    accepted: false,
    reasonCode,
    evidence,
  });

  try {
    if (!record(input) || !record(expectation))
      return reject("MALFORMED_INPUT");
    const expected = normalizeExpectation(expectation);
    if (!expected) return reject("INVALID_EXPECTATION");
    evidence.settlementId = expected.settlementId;
    evidence.leg = expected.leg;
    evidence.attempt = expected.attempt;
    evidence.amountAtomic = expected.amountAtomic;
    evidence.queryId = expected.queryId;
    evidence.senderWalletAddress = expected.senderWalletAddress;
    evidence.recipientWalletAddress = expected.recipientWalletAddress;

    if (!Array.isArray(input.sources) || input.sources.length !== 2) {
      return reject("INVALID_SOURCE_COUNT");
    }
    if (!input.sources.every(record)) return reject("MALFORMED_INPUT");
    const configured = new Map(
      expected.collectors.map((collector) => [collector.sourceId, collector]),
    );
    const sources = input.sources as Array<{
      sourceId: string;
      observation: unknown;
    }>;
    const sourceIds = sources.map((source) => source.sourceId);
    if (
      sources.some(
        (source) =>
          !exactKeys(source, ["sourceId", "observation"]) ||
          typeof source.sourceId !== "string" ||
          !configured.has(source.sourceId),
      ) ||
      new Set(sourceIds).size !== 2
    ) {
      return reject("UNEXPECTED_SOURCE_IDENTITY");
    }
    evidence.sourceIds = [...sourceIds].sort();
    evidence.operatorIds = evidence.sourceIds.map(
      (id) => configured.get(id)!.operatorId,
    );

    const results = sources
      .map((source) => ({
        sourceId: source.sourceId,
        result: validateSource(source.observation, expected),
      }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const failed = results.find((entry) => !entry.result.valid);
    if (failed) return reject(failed.result.reasonCode!);
    if (results[0].result.fingerprint !== results[1].result.fingerprint) {
      return reject("SOURCE_DISAGREEMENT");
    }

    copyEvidence(evidence, results[0].result.evidence!);
    evidence.agreementFingerprint = results[0].result.fingerprint!;
    evidence.structuralChecksPassed = true;
    return reject("MASTERCHAIN_PROOF_REQUIRED");
  } catch {
    return reject("MALFORMED_INPUT");
  }
}

interface Expected extends Omit<
  TonJettonReconciliationExpectation,
  "collectors"
> {
  collectors: [TonJettonCollectorExpectation, TonJettonCollectorExpectation];
}

interface BlockIdentity {
  workchain: number;
  shard: string;
  seqno: number;
  rootHash: string;
  fileHash: string;
  masterchainSeqno: number;
}

interface ParsedMessage {
  message: Message;
  hash: string;
  source: string;
  destination: string;
  bounced: boolean;
}

interface ParsedTransaction {
  transaction: Transaction;
  hash: string;
  lt: string;
  account: string;
  block: BlockIdentity;
  inMessage: ParsedMessage | null;
  outMessages: ParsedMessage[];
  beforeBoc: string | null;
  afterBoc: string | null;
}

interface ParsedWalletState {
  rootHash: string;
  accountHash: string;
  lastTransactionHash: string;
  lastTransactionLt: string;
  balance: bigint;
  ownerAddress: string;
  masterAddress: string;
  codeHash: string;
}

interface SourceEvidence {
  transactionHashes: string[];
  transactionLts: string[];
  messageHashes: string[];
  stateHashes: string[];
  blockFingerprints: string[];
  senderBefore: string;
  senderAfter: string;
  recipientBefore: string;
  recipientAfter: string;
}

function validateSource(
  value: unknown,
  expected: Expected,
): {
  valid: boolean;
  reasonCode?: TonJettonReconciliationReasonCode;
  evidence?: SourceEvidence;
  fingerprint?: string;
} {
  const fail = (reasonCode: TonJettonReconciliationReasonCode) => ({
    valid: false,
    reasonCode,
  });
  if (
    !record(value) ||
    !exactKeys(value, [
      "ownerTransferTransaction",
      "senderWalletTransaction",
      "recipientWalletTransaction",
    ])
  ) {
    return fail("MALFORMED_INPUT");
  }

  const owner = parseRawTransaction(value.ownerTransferTransaction, false);
  const sender = parseRawTransaction(value.senderWalletTransaction, true);
  const recipient = parseRawTransaction(value.recipientWalletTransaction, true);
  if (!owner || !sender || !recipient) return fail("INVALID_RAW_TRANSACTION");
  if (
    owner.account !== expected.ownerTransaction.accountAddress ||
    sender.account !== expected.senderWalletAddress ||
    recipient.account !== expected.recipientWalletAddress
  ) {
    return fail("TRANSACTION_ACCOUNT_MISMATCH");
  }
  if (
    owner.hash !== expected.ownerTransaction.hash ||
    owner.lt !== expected.ownerTransaction.lt
  ) {
    return fail("TRANSACTION_IDENTITY_MISMATCH");
  }
  if (
    ![owner, sender, recipient].every((tx) =>
      successfulTransaction(tx.transaction),
    )
  ) {
    return fail("TRANSACTION_EXECUTION_FAILED");
  }
  if (!owner.inMessage || !sender.inMessage || !recipient.inMessage) {
    return fail("MISSING_MESSAGE");
  }
  for (const message of [
    owner.inMessage,
    sender.inMessage,
    recipient.inMessage,
    ...owner.outMessages,
    ...sender.outMessages,
    ...recipient.outMessages,
  ]) {
    if (message.bounced) return fail("BOUNCED_MESSAGE");
  }

  const outbox = validateOwnerOutbox(owner, expected);
  if (!outbox) return fail("OWNER_OUTBOX_MISMATCH");
  if (outbox.selected.hash !== sender.inMessage.hash) {
    return fail("MESSAGE_LINK_MISMATCH");
  }
  if (
    outbox.selected.source !== expected.senderOwnerAddress ||
    outbox.selected.destination !== expected.senderWalletAddress
  ) {
    return fail("MESSAGE_ENVELOPE_MISMATCH");
  }
  if (sender.outMessages.length !== 1) {
    return fail("INTERNAL_TRANSFER_FIELD_MISMATCH");
  }
  const internal = sender.outMessages[0];
  if (
    internal.source !== expected.senderWalletAddress ||
    internal.destination !== expected.recipientWalletAddress
  ) {
    return fail("MESSAGE_ENVELOPE_MISMATCH");
  }
  if (internal.hash !== recipient.inMessage.hash) {
    return fail("MESSAGE_LINK_MISMATCH");
  }
  const internalBody = parseInternalTransfer(internal.message.body);
  if (!internalBody || !internalTransferMatches(internalBody, expected)) {
    return fail("INTERNAL_TRANSFER_FIELD_MISMATCH");
  }
  const recipientOutboxError = validateRecipientOutbox(recipient, expected);
  if (recipientOutboxError) return fail(recipientOutboxError);

  const senderStates = validateWalletStates(sender, {
    walletAddress: expected.senderWalletAddress,
    ownerAddress: expected.senderOwnerAddress,
    masterAddress: expected.allowlistedMasterAddress,
    codeHash: expected.jettonWalletCodeHash,
  });
  const recipientStates = validateWalletStates(recipient, {
    walletAddress: expected.recipientWalletAddress,
    ownerAddress: expected.recipientOwnerAddress,
    masterAddress: expected.allowlistedMasterAddress,
    codeHash: expected.jettonWalletCodeHash,
  });
  if (!senderStates || !recipientStates) return fail("INVALID_STATE_PROOF");
  if (!senderStates.linked || !recipientStates.linked) {
    return fail("STATE_UPDATE_MISMATCH");
  }
  if (!senderStates.walletMatches || !recipientStates.walletMatches) {
    return fail("JETTON_WALLET_DATA_MISMATCH");
  }
  const amount = BigInt(expected.amountAtomic);
  if (senderStates.before.balance - senderStates.after.balance !== amount) {
    return fail("SENDER_DEBIT_MISMATCH");
  }
  if (
    recipientStates.after.balance - recipientStates.before.balance !==
    amount
  ) {
    return fail("RECIPIENT_CREDIT_MISMATCH");
  }

  const transactions = [owner, sender, recipient];
  const sourceEvidence: SourceEvidence = {
    transactionHashes: transactions.map((tx) => tx.hash),
    transactionLts: transactions.map((tx) => tx.lt),
    messageHashes: [
      ...owner.outMessages.map((message) => message.hash),
      internal.hash,
      ...recipient.outMessages.map((message) => message.hash),
    ],
    stateHashes: [
      senderStates.before.accountHash,
      senderStates.after.accountHash,
      recipientStates.before.accountHash,
      recipientStates.after.accountHash,
    ],
    blockFingerprints: transactions.map(blockFingerprint),
    senderBefore: senderStates.before.balance.toString(),
    senderAfter: senderStates.after.balance.toString(),
    recipientBefore: recipientStates.before.balance.toString(),
    recipientAfter: recipientStates.after.balance.toString(),
  };
  const consensus = {
    context: {
      settlementId: expected.settlementId,
      leg: expected.leg,
      attempt: expected.attempt,
      queryId: expected.queryId,
      amountAtomic: expected.amountAtomic,
      allowlistedMasterAddress: expected.allowlistedMasterAddress,
      jettonWalletCodeHash: expected.jettonWalletCodeHash,
      senderOwnerAddress: expected.senderOwnerAddress,
      senderWalletAddress: expected.senderWalletAddress,
      recipientOwnerAddress: expected.recipientOwnerAddress,
      recipientWalletAddress: expected.recipientWalletAddress,
      responseDestinationAddress: expected.responseDestinationAddress,
      forwardTonAmountAtomic: expected.forwardTonAmountAtomic,
      forwardPayloadHash: expected.forwardPayloadHash,
      ownerTransaction: expected.ownerTransaction,
      ownerOutbox: expected.ownerOutbox,
      collectors: expected.collectors,
    },
    transactions: transactions.map((tx) => ({
      account: tx.account,
      lt: tx.lt,
      hash: tx.hash,
      previousLt: tx.transaction.prevTransactionLt.toString(),
      previousHash: bigintHash(tx.transaction.prevTransactionHash),
      oldStateHash: tx.transaction.stateUpdate.oldHash.toString("hex"),
      newStateHash: tx.transaction.stateUpdate.newHash.toString("hex"),
      block: tx.block,
      inMessageHash: tx.inMessage?.hash ?? null,
      outMessageHashes: tx.outMessages.map((message) => message.hash),
    })),
    states: {
      sender: [
        stateConsensus(senderStates.before),
        stateConsensus(senderStates.after),
      ],
      recipient: [
        stateConsensus(recipientStates.before),
        stateConsensus(recipientStates.after),
      ],
    },
  };
  return {
    valid: true,
    evidence: sourceEvidence,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(consensus))
      .digest("hex"),
  };
}

function stateConsensus(state: ParsedWalletState) {
  return {
    rootHash: state.rootHash,
    accountHash: state.accountHash,
    lastTransactionHash: state.lastTransactionHash,
    lastTransactionLt: state.lastTransactionLt,
    balance: state.balance.toString(),
    ownerAddress: state.ownerAddress,
    masterAddress: state.masterAddress,
    codeHash: state.codeHash,
  };
}

function parseRawTransaction(
  value: unknown,
  requireStates: boolean,
): ParsedTransaction | null {
  if (!record(value)) return null;
  const expectedKeys = requireStates
    ? [
        "bocBase64",
        "block",
        "shardAccountBeforeBocBase64",
        "shardAccountAfterBocBase64",
      ]
    : ["bocBase64", "block"];
  if (!exactKeys(value, expectedKeys)) return null;
  const root = singleBoc(value.bocBase64);
  const block = normalizeBlock(value.block);
  if (!root || !block) return null;
  try {
    const slice = root.beginParse();
    const transaction = loadTransaction(slice);
    slice.endParse();
    const rawMessages = extractRawMessages(root);
    if (
      !rawMessages ||
      transaction.outMessagesCount !== rawMessages.out.length
    ) {
      return null;
    }
    const accountAddress = addressFromHash(transaction.address);
    if (!accountAddress) return null;
    return {
      transaction,
      hash: root.hash().toString("hex"),
      lt: transaction.lt.toString(),
      account: accountAddress,
      block,
      inMessage: rawMessages.input ? parseMessage(rawMessages.input) : null,
      outMessages: rawMessages.out.map(parseMessage),
      beforeBoc: requireStates
        ? String(value.shardAccountBeforeBocBase64)
        : null,
      afterBoc: requireStates ? String(value.shardAccountAfterBocBase64) : null,
    };
  } catch {
    return null;
  }
}

function extractRawMessages(
  root: Cell,
): { input: Cell | null; out: Cell[] } | null {
  try {
    const slice = root.beginParse();
    if (slice.loadUint(4) !== 7) return null;
    slice.skip(256 + 64 + 256 + 64 + 32 + 15 + 2 + 2);
    const messageSlice = slice.loadRef().beginParse();
    const input = messageSlice.loadBit() ? messageSlice.loadRef() : null;
    const dictionary = messageSlice.loadDict(
      Dictionary.Keys.Uint(15),
      Dictionary.Values.Cell(),
    );
    messageSlice.endParse();
    const entries = [...dictionary].sort((left, right) => left[0] - right[0]);
    if (entries.some(([key], index) => key !== index)) return null;
    return { input, out: entries.map(([, cell]) => cell) };
  } catch {
    return null;
  }
}

function parseMessage(cell: Cell): ParsedMessage {
  const message = loadMessage(cell.beginParse());
  if (message.info.type !== "internal")
    throw new Error("internal message required");
  return {
    message,
    hash: cell.hash().toString("hex"),
    source: requiredAddress(message.info.src),
    destination: requiredAddress(message.info.dest),
    bounced: message.info.bounced,
  };
}

function successfulTransaction(transaction: Transaction): boolean {
  const description = transaction.description;
  const action =
    description.type === "generic" ? description.actionPhase : null;
  return (
    description.type === "generic" &&
    description.aborted === false &&
    description.computePhase.type === "vm" &&
    description.computePhase.success === true &&
    description.computePhase.exitCode === 0 &&
    action != null &&
    action.success === true &&
    action.valid === true &&
    action.resultCode === 0
  );
}

function validateOwnerOutbox(
  owner: ParsedTransaction,
  expected: Expected,
): { selected: ParsedMessage } | null {
  if (owner.outMessages.length !== expected.ownerOutbox.length) return null;
  const remaining = [...expected.ownerOutbox];
  let selected: ParsedMessage | null = null;
  for (const message of owner.outMessages) {
    if (
      message.source !== expected.senderOwnerAddress ||
      message.destination !== expected.senderWalletAddress
    )
      return null;
    const body = parseTransfer(message.message.body);
    if (!body) return null;
    const index = remaining.findIndex((leg) => transferMatches(body, leg));
    if (index < 0) return null;
    const [matched] = remaining.splice(index, 1);
    if (matched.leg === expected.leg && matched.attempt === expected.attempt) {
      selected = message;
    }
  }
  return remaining.length === 0 && selected ? { selected } : null;
}

interface TransferFields {
  queryId: string;
  amountAtomic: string;
  addressField: string;
  responseDestinationAddress: string;
  forwardTonAmountAtomic: string;
  forwardPayloadHash: string;
}

function parseTransfer(body: Cell): TransferFields | null {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== TRANSFER_OPCODE) return null;
    const queryId = slice.loadUintBig(64).toString();
    const amountAtomic = slice.loadCoins().toString();
    const addressField = requiredAddress(slice.loadAddress());
    const responseDestinationAddress = requiredAddress(slice.loadAddress());
    if (slice.loadBit()) return null;
    const forwardTonAmountAtomic = slice.loadCoins().toString();
    const forwardPayloadHash = loadEitherCell(slice).hash().toString("hex");
    return {
      queryId,
      amountAtomic,
      addressField,
      responseDestinationAddress,
      forwardTonAmountAtomic,
      forwardPayloadHash,
    };
  } catch {
    return null;
  }
}

function parseInternalTransfer(body: Cell): TransferFields | null {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== INTERNAL_TRANSFER_OPCODE) return null;
    const queryId = slice.loadUintBig(64).toString();
    const amountAtomic = slice.loadCoins().toString();
    const addressField = requiredAddress(slice.loadAddress());
    const responseDestinationAddress = requiredAddress(slice.loadAddress());
    const forwardTonAmountAtomic = slice.loadCoins().toString();
    const forwardPayloadHash = loadEitherCell(slice).hash().toString("hex");
    return {
      queryId,
      amountAtomic,
      addressField,
      responseDestinationAddress,
      forwardTonAmountAtomic,
      forwardPayloadHash,
    };
  } catch {
    return null;
  }
}

function loadEitherCell(slice: ReturnType<Cell["beginParse"]>): Cell {
  if (slice.loadBit()) {
    const payload = slice.loadRef();
    slice.endParse();
    return payload;
  }
  return slice.asCell();
}

function transferMatches(
  actual: TransferFields,
  expected: TonJettonOwnerOutboxLegExpectation,
): boolean {
  return (
    actual.queryId === expected.queryId &&
    actual.amountAtomic === expected.amountAtomic &&
    actual.addressField === expected.destinationOwnerAddress &&
    actual.responseDestinationAddress === expected.responseDestinationAddress &&
    actual.forwardTonAmountAtomic === expected.forwardTonAmountAtomic &&
    actual.forwardPayloadHash === expected.forwardPayloadHash
  );
}

function internalTransferMatches(
  actual: TransferFields,
  expected: Expected,
): boolean {
  return (
    actual.queryId === expected.queryId &&
    actual.amountAtomic === expected.amountAtomic &&
    actual.addressField === expected.senderOwnerAddress &&
    actual.responseDestinationAddress === expected.responseDestinationAddress &&
    actual.forwardTonAmountAtomic === expected.forwardTonAmountAtomic &&
    actual.forwardPayloadHash === expected.forwardPayloadHash
  );
}

function validateRecipientOutbox(
  recipient: ParsedTransaction,
  expected: Expected,
): TonJettonReconciliationReasonCode | null {
  let notifications = 0;
  let excesses = 0;
  for (const message of recipient.outMessages) {
    if (message.source !== expected.recipientWalletAddress) {
      return "RECIPIENT_OUTBOX_MISMATCH";
    }
    const opcode = readOpcode(message.message.body);
    if (opcode === TRANSFER_NOTIFICATION_OPCODE) {
      notifications += 1;
      if (
        message.destination !== expected.recipientOwnerAddress ||
        !notificationMatches(message.message.body, expected)
      )
        return "TRANSFER_NOTIFICATION_MISMATCH";
    } else if (opcode === EXCESSES_OPCODE) {
      excesses += 1;
      if (
        message.destination !== expected.responseDestinationAddress ||
        !excessesMatches(message.message.body, expected.queryId)
      )
        return "EXCESSES_MISMATCH";
    } else {
      return "RECIPIENT_OUTBOX_MISMATCH";
    }
  }
  const notificationRequired = BigInt(expected.forwardTonAmountAtomic) > 0n;
  return notifications === (notificationRequired ? 1 : 0) && excesses <= 1
    ? null
    : "RECIPIENT_OUTBOX_MISMATCH";
}

function notificationMatches(body: Cell, expected: Expected): boolean {
  try {
    const slice = body.beginParse();
    if (slice.loadUint(32) !== TRANSFER_NOTIFICATION_OPCODE) return false;
    const queryId = slice.loadUintBig(64).toString();
    const amount = slice.loadCoins().toString();
    const sender = requiredAddress(slice.loadAddress());
    const payloadHash = loadEitherCell(slice).hash().toString("hex");
    return (
      queryId === expected.queryId &&
      amount === expected.amountAtomic &&
      sender === expected.senderOwnerAddress &&
      payloadHash === expected.forwardPayloadHash
    );
  } catch {
    return false;
  }
}

function excessesMatches(body: Cell, queryId: string): boolean {
  try {
    const slice = body.beginParse();
    const matches =
      slice.loadUint(32) === EXCESSES_OPCODE &&
      slice.loadUintBig(64).toString() === queryId;
    slice.endParse();
    return matches;
  } catch {
    return false;
  }
}

function readOpcode(body: Cell): number | null {
  try {
    return body.beginParse().loadUint(32);
  } catch {
    return null;
  }
}

function validateWalletStates(
  tx: ParsedTransaction,
  expected: {
    walletAddress: string;
    ownerAddress: string;
    masterAddress: string;
    codeHash: string;
  },
): {
  before: ParsedWalletState;
  after: ParsedWalletState;
  linked: boolean;
  walletMatches: boolean;
} | null {
  const before = parseShardAccount(tx.beforeBoc, expected.walletAddress);
  const after = parseShardAccount(tx.afterBoc, expected.walletAddress);
  if (!before || !after) return null;
  const linked =
    before.accountHash === tx.transaction.stateUpdate.oldHash.toString("hex") &&
    after.accountHash === tx.transaction.stateUpdate.newHash.toString("hex") &&
    before.lastTransactionHash ===
      bigintHash(tx.transaction.prevTransactionHash) &&
    before.lastTransactionLt === tx.transaction.prevTransactionLt.toString() &&
    after.lastTransactionHash === tx.hash &&
    after.lastTransactionLt === tx.lt;
  const walletMatches = [before, after].every(
    (state) =>
      state.ownerAddress === expected.ownerAddress &&
      state.masterAddress === expected.masterAddress &&
      state.codeHash === expected.codeHash,
  );
  return { before, after, linked, walletMatches };
}

function parseShardAccount(
  bocBase64: string | null,
  expectedAddress: string,
): ParsedWalletState | null {
  const root = singleBoc(bocBase64);
  if (!root) return null;
  try {
    const slice = root.beginParse();
    const accountCell = slice.loadRef();
    const lastTransactionHash = slice.loadUintBig(256);
    const lastTransactionLt = slice.loadUintBig(64);
    slice.endParse();
    const accountSlice = accountCell.beginParse();
    if (!accountSlice.loadBit()) return null;
    const account = loadAccount(accountSlice);
    accountSlice.endParse();
    if (normalizeTonAddress(account.addr.toRawString()) !== expectedAddress)
      return null;
    if (account.storage.state.type !== "active") return null;
    const code = account.storage.state.state.code;
    const data = account.storage.state.state.data;
    if (!code || !data) return null;
    const dataSlice = data.beginParse();
    const balance = dataSlice.loadCoins();
    const ownerAddress = requiredAddress(dataSlice.loadAddress());
    const masterAddress = requiredAddress(dataSlice.loadAddress());
    const dataCode = dataSlice.loadRef();
    dataSlice.endParse();
    const codeHash = code.hash().toString("hex");
    if (dataCode.hash().toString("hex") !== codeHash) return null;
    return {
      rootHash: root.hash().toString("hex"),
      accountHash: accountCell.hash().toString("hex"),
      lastTransactionHash: bigintHash(lastTransactionHash),
      lastTransactionLt: lastTransactionLt.toString(),
      balance,
      ownerAddress,
      masterAddress,
      codeHash,
    };
  } catch {
    return null;
  }
}

function normalizeExpectation(value: Record<string, unknown>): Expected | null {
  if (
    !exactKeys(value, [
      "settlementId",
      "leg",
      "attempt",
      "allowlistedMasterAddress",
      "jettonWalletCodeHash",
      "senderOwnerAddress",
      "senderWalletAddress",
      "recipientOwnerAddress",
      "recipientWalletAddress",
      "amountAtomic",
      "queryId",
      "responseDestinationAddress",
      "forwardTonAmountAtomic",
      "forwardPayloadHash",
      "ownerTransaction",
      "ownerOutbox",
      "collectors",
    ]) ||
    typeof value.settlementId !== "string" ||
    !IDENTIFIER.test(value.settlementId) ||
    !isLeg(value.leg) ||
    !positiveSafeInteger(value.attempt) ||
    !record(value.ownerTransaction) ||
    !exactKeys(value.ownerTransaction, ["accountAddress", "lt", "hash"]) ||
    !Array.isArray(value.ownerOutbox) ||
    value.ownerOutbox.length < 1 ||
    value.ownerOutbox.length > 3 ||
    !Array.isArray(value.collectors) ||
    value.collectors.length !== 2
  )
    return null;

  const collectors = value.collectors.map(normalizeCollector);
  if (
    collectors.some((collector) => !collector) ||
    new Set(collectors.map((collector) => collector!.sourceId)).size !== 2 ||
    new Set(collectors.map((collector) => collector!.operatorId)).size !== 2
  )
    return null;
  const outbox = value.ownerOutbox.map(normalizeOutboxLeg);
  if (outbox.some((leg) => !leg)) return null;
  const ownerOutbox = outbox as TonJettonOwnerOutboxLegExpectation[];
  if (
    new Set(ownerOutbox.map((leg) => leg.queryId)).size !==
      ownerOutbox.length ||
    new Set(ownerOutbox.map((leg) => `${leg.leg}:${leg.attempt}`)).size !==
      ownerOutbox.length
  )
    return null;

  const expected = {
    settlementId: value.settlementId,
    leg: value.leg,
    attempt: value.attempt,
    allowlistedMasterAddress: address(value.allowlistedMasterAddress),
    jettonWalletCodeHash: hash(value.jettonWalletCodeHash),
    senderOwnerAddress: address(value.senderOwnerAddress),
    senderWalletAddress: address(value.senderWalletAddress),
    recipientOwnerAddress: address(value.recipientOwnerAddress),
    recipientWalletAddress: address(value.recipientWalletAddress),
    amountAtomic: positive(value.amountAtomic),
    queryId: uint64(value.queryId),
    responseDestinationAddress: address(value.responseDestinationAddress),
    forwardTonAmountAtomic: atomic(value.forwardTonAmountAtomic),
    forwardPayloadHash: hash(value.forwardPayloadHash),
    ownerTransaction: {
      accountAddress: address(value.ownerTransaction.accountAddress),
      lt: positive(value.ownerTransaction.lt),
      hash: hash(value.ownerTransaction.hash),
    },
    ownerOutbox,
    collectors: collectors as [
      TonJettonCollectorExpectation,
      TonJettonCollectorExpectation,
    ],
  };
  if (containsNull(expected)) return null;
  const selected = ownerOutbox.find(
    (leg) => leg.leg === expected.leg && leg.attempt === expected.attempt,
  );
  if (
    !selected ||
    selected.queryId !== expected.queryId ||
    selected.amountAtomic !== expected.amountAtomic ||
    selected.destinationOwnerAddress !== expected.recipientOwnerAddress ||
    selected.recipientWalletAddress !== expected.recipientWalletAddress ||
    selected.responseDestinationAddress !==
      expected.responseDestinationAddress ||
    selected.forwardTonAmountAtomic !== expected.forwardTonAmountAtomic ||
    selected.forwardPayloadHash !== expected.forwardPayloadHash ||
    expected.ownerTransaction.accountAddress !== expected.senderOwnerAddress
  )
    return null;
  return expected as Expected;
}

function normalizeCollector(
  value: unknown,
): TonJettonCollectorExpectation | null {
  if (!record(value) || !exactKeys(value, ["sourceId", "operatorId"]))
    return null;
  if (
    typeof value.sourceId !== "string" ||
    typeof value.operatorId !== "string" ||
    !IDENTIFIER.test(value.sourceId) ||
    !IDENTIFIER.test(value.operatorId)
  )
    return null;
  return { sourceId: value.sourceId, operatorId: value.operatorId };
}

function normalizeOutboxLeg(
  value: unknown,
): TonJettonOwnerOutboxLegExpectation | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "leg",
      "attempt",
      "queryId",
      "amountAtomic",
      "destinationOwnerAddress",
      "recipientWalletAddress",
      "responseDestinationAddress",
      "forwardTonAmountAtomic",
      "forwardPayloadHash",
    ]) ||
    !isLeg(value.leg) ||
    !positiveSafeInteger(value.attempt)
  )
    return null;
  const normalized = {
    leg: value.leg,
    attempt: value.attempt,
    queryId: uint64(value.queryId),
    amountAtomic: positive(value.amountAtomic),
    destinationOwnerAddress: address(value.destinationOwnerAddress),
    recipientWalletAddress: address(value.recipientWalletAddress),
    responseDestinationAddress: address(value.responseDestinationAddress),
    forwardTonAmountAtomic: atomic(value.forwardTonAmountAtomic),
    forwardPayloadHash: hash(value.forwardPayloadHash),
  };
  return containsNull(normalized)
    ? null
    : (normalized as TonJettonOwnerOutboxLegExpectation);
}

function normalizeBlock(value: unknown): BlockIdentity | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "workchain",
      "shard",
      "seqno",
      "rootHash",
      "fileHash",
      "masterchainSeqno",
    ]) ||
    !Number.isSafeInteger(value.workchain) ||
    typeof value.shard !== "string" ||
    !/^[0-9a-f]{16}$/.test(value.shard) ||
    !positiveSafeInteger(value.seqno) ||
    !positiveSafeInteger(value.masterchainSeqno)
  )
    return null;
  const rootHash = hash(value.rootHash);
  const fileHash = hash(value.fileHash);
  return rootHash && fileHash
    ? {
        workchain: value.workchain,
        shard: value.shard,
        seqno: value.seqno,
        rootHash,
        fileHash,
        masterchainSeqno: value.masterchainSeqno,
      }
    : null;
}

function blockFingerprint(tx: ParsedTransaction): string {
  return JSON.stringify(tx.block);
}

function copyEvidence(
  target: TonJettonReconciliationEvidence,
  source: SourceEvidence,
): void {
  target.transactionHashes = [...source.transactionHashes];
  target.transactionLts = [...source.transactionLts];
  target.messageHashes = [...source.messageHashes];
  target.stateHashes = [...source.stateHashes];
  target.blockFingerprints = [...source.blockFingerprints];
  target.senderBalanceBefore = source.senderBefore;
  target.senderBalanceAfter = source.senderAfter;
  target.recipientBalanceBefore = source.recipientBefore;
  target.recipientBalanceAfter = source.recipientAfter;
}

function emptyEvidence(): TonJettonReconciliationEvidence {
  return {
    sourceIds: [],
    operatorIds: [],
    settlementId: null,
    leg: null,
    attempt: null,
    transactionHashes: [],
    transactionLts: [],
    messageHashes: [],
    stateHashes: [],
    blockFingerprints: [],
    senderWalletAddress: null,
    recipientWalletAddress: null,
    senderBalanceBefore: null,
    senderBalanceAfter: null,
    recipientBalanceBefore: null,
    recipientBalanceAfter: null,
    amountAtomic: null,
    queryId: null,
    agreementFingerprint: null,
    structuralChecksPassed: false,
    finalityProven: false,
    settlementAuthorized: false,
    remainingRequirement: "VERIFIED_MASTERCHAIN_SHARD_INCLUSION",
  };
}

function singleBoc(value: unknown): Cell | null {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > MAX_BOC_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return null;
  try {
    const roots = Cell.fromBoc(Buffer.from(value, "base64"));
    return roots.length === 1 ? roots[0] : null;
  } catch {
    return null;
  }
}

function address(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeTonAddress(value);
  } catch {
    return null;
  }
}

function addressFromHash(value: bigint): string | null {
  try {
    return normalizeTonAddress(
      new Address(0, bigintBuffer(value)).toRawString(),
    );
  } catch {
    return null;
  }
}

function requiredAddress(value: Address | null): string {
  if (!value) throw new Error("internal address required");
  const normalized = normalizeTonAddress(value.toRawString());
  if (!normalized) throw new Error("invalid internal address");
  return normalized;
}

function hash(value: unknown): string | null {
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

function atomic(value: unknown): string | null {
  return typeof value === "string" && /^(0|[1-9]\d{0,39})$/.test(value)
    ? value
    : null;
}

function positive(value: unknown): string | null {
  const parsed = atomic(value);
  return parsed !== null && BigInt(parsed) > 0n ? parsed : null;
}

function uint64(value: unknown): string | null {
  const parsed = atomic(value);
  return parsed !== null && BigInt(parsed) <= MAX_UINT64 ? parsed : null;
}

function bigintHash(value: bigint): string {
  return bigintBuffer(value).toString("hex");
}

function bigintBuffer(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isLeg(value: unknown): value is TonJettonPayoutLegKind {
  return value === "buyer" || value === "seller" || value === "treasury";
}

function containsNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(containsNull);
  if (record(value)) return Object.values(value).some(containsNull);
  return false;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
