import { Address, beginCell } from "@ton/ton";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import {
  TON_NATIVE_FUND_OPCODE,
  TonCenterTransaction,
  validateTonNativeFundingTransaction,
} from "./ton-center-v3.service";

describe("validateTonNativeFundingTransaction", () => {
  const buyer = Address.parseRaw(`0:${"11".repeat(32)}`).toRawString();
  const escrow = Address.parseRaw(`0:${"22".repeat(32)}`).toRawString();
  const buyerTotal = 1_500_000_000n;
  const requestAmount = 1_700_000_000n;
  const queryId = 42n;
  const code = beginCell().storeUint(0x1234, 16).endCell();
  const config = beginCell().storeUint(0xabcd, 16).endCell();
  const payload = beginCell()
    .storeUint(TON_NATIVE_FUND_OPCODE, 32)
    .storeUint(queryId, 64)
    .endCell();
  const data = beginCell()
    .storeUint(1, 8)
    .storeCoins(buyerTotal)
    .storeUint(queryId, 64)
    .storeRef(config)
    .endCell();

  const preparation = Object.assign(new TonNativeEscrowPreparation(), {
    id: "10000000-0000-4000-8000-000000000001",
    dealId: "20000000-0000-4000-8000-000000000001",
    network: TonNetwork.TESTNET,
    escrowAddress: escrow,
    buyerAddress: buyer,
    buyerTotalAtomic: buyerTotal.toString(),
    requestAmountAtomic: requestAmount.toString(),
    queryId: queryId.toString(),
    fundingDeadline: "2000000000",
    payload: payload.toBoc().toString("base64"),
    codeHash: code.hash().toString("hex"),
    configHash: config.hash().toString("hex"),
  });

  const validTransaction = (): TonCenterTransaction => ({
    account: escrow,
    account_state_after: {
      account_status: "active",
      code_hash: code.hash().toString("base64"),
      data_boc: data.toBoc().toString("base64"),
    },
    description: {
      aborted: false,
      installed: true,
      compute_ph: { skipped: false, success: true, exit_code: 0 },
      action: { success: true, valid: true, result_code: 0 },
    },
    emulated: false,
    end_status: "active",
    hash: "transaction-hash",
    in_msg: {
      bounced: false,
      destination: escrow,
      hash: "message-hash",
      source: buyer,
      value: requestAmount.toString(),
      opcode: TON_NATIVE_FUND_OPCODE,
      message_content: { body: payload.toBoc().toString("base64") },
    },
    lt: "123456789",
    mc_block_seqno: 123,
    now: 1_900_000_000,
  });

  it("accepts an exact finalized Fund transaction and post-state", () => {
    const result = validateTonNativeFundingTransaction(
      validTransaction(),
      preparation,
    );
    expect(result.accepted).toBe(true);
    expect(result.reasonCode).toBe("FUND_CONFIRMED");
    expect(result.postCodeHash).toBe(preparation.codeHash);
    expect(result.postConfigHash).toBe(preparation.configHash);
  });

  it("rejects a transaction without masterchain inclusion", () => {
    const transaction = validTransaction();
    transaction.mc_block_seqno = 0;
    expect(
      validateTonNativeFundingTransaction(transaction, preparation).reasonCode,
    ).toBe("NOT_MASTERCHAIN_FINALIZED");
  });

  it("rejects an aborted transaction", () => {
    const transaction = validTransaction();
    transaction.description!.aborted = true;
    expect(
      validateTonNativeFundingTransaction(transaction, preparation).reasonCode,
    ).toBe("TRANSACTION_ABORTED_OR_UNKNOWN");
  });

  it("rejects a sender other than the committed buyer", () => {
    const transaction = validTransaction();
    transaction.in_msg!.source = Address.parseRaw(
      `0:${"33".repeat(32)}`,
    ).toRawString();
    expect(
      validateTonNativeFundingTransaction(transaction, preparation).reasonCode,
    ).toBe("BUYER_ADDRESS_MISMATCH");
  });

  it("rejects a different message body", () => {
    const transaction = validTransaction();
    transaction.in_msg!.message_content!.body = beginCell()
      .storeUint(TON_NATIVE_FUND_OPCODE, 32)
      .storeUint(43n, 64)
      .endCell()
      .toBoc()
      .toString("base64");
    expect(
      validateTonNativeFundingTransaction(transaction, preparation).reasonCode,
    ).toBe("PAYLOAD_MISMATCH");
  });

  it("rejects post-state with a different immutable config", () => {
    const wrongConfig = beginCell().storeUint(0xffff, 16).endCell();
    const transaction = validTransaction();
    transaction.account_state_after!.data_boc = beginCell()
      .storeUint(1, 8)
      .storeCoins(buyerTotal)
      .storeUint(queryId, 64)
      .storeRef(wrongConfig)
      .endCell()
      .toBoc()
      .toString("base64");
    expect(
      validateTonNativeFundingTransaction(transaction, preparation).reasonCode,
    ).toBe("CONFIG_HASH_MISMATCH");
  });
});
