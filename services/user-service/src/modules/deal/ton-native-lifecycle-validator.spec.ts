import { beginCell } from "@ton/ton";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import { TonCenterTransaction } from "./ton-center-v3.service";
import {
  buildTonNativeLifecyclePayload,
  TON_NATIVE_CONTRACT_STATUS,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";
import { validateTonNativeLifecycleTransaction } from "./ton-native-lifecycle-validator";

describe("validateTonNativeLifecycleTransaction", () => {
  const dealId = "30000000-0000-4000-8000-000000000001";
  const escrow = `0:${"11".repeat(32)}`;
  const buyer = `0:${"22".repeat(32)}`;
  const seller = `0:${"33".repeat(32)}`;
  const treasury = `0:${"44".repeat(32)}`;
  const queryId = 42n;
  const buyerTotal = 2_000_000_000n;
  const sellerPayout = 1_900_000_000n;
  const platformFee = 100_000_000n;
  const code = beginCell().storeUint(1, 1).endCell();
  const config = beginCell().storeUint(2, 2).endCell();

  const preparation = Object.assign(new TonNativeEscrowPreparation(), {
    id: "40000000-0000-4000-8000-000000000001",
    dealId,
    network: TonNetwork.TESTNET,
    escrowAddress: escrow,
    buyerAddress: buyer,
    sellerAddress: seller,
    treasuryAddress: treasury,
    buyerTotalAtomic: buyerTotal.toString(),
    sellerPayoutAtomic: sellerPayout.toString(),
    platformFeeAtomic: platformFee.toString(),
    refundToBuyerAtomic: buyerTotal.toString(),
    refundFeeAtomic: "0",
    deliveryDeadline: "1900001000",
    confirmationDeadline: "1900002000",
    codeHash: code.hash().toString("hex"),
    configHash: config.hash().toString("hex"),
  });

  function intent(action: TonNativeLifecycleAction) {
    const payload = buildTonNativeLifecyclePayload(action, queryId);
    const payloadHash = beginCell()
      .storeUint(
        action === TonNativeLifecycleAction.MARK_DELIVERED
          ? 0x64656c76
          : 0x72656c73,
        32,
      )
      .storeUint(queryId, 64)
      .endCell()
      .hash()
      .toString("hex");
    return Object.assign(new TonNativeLifecycleIntent(), {
      id: "50000000-0000-4000-8000-000000000001",
      preparationId: preparation.id,
      dealId,
      action,
      expectedFromStatus:
        action === TonNativeLifecycleAction.MARK_DELIVERED
          ? TON_NATIVE_CONTRACT_STATUS.FUNDED
          : TON_NATIVE_CONTRACT_STATUS.DELIVERED,
      expectedToStatus:
        action === TonNativeLifecycleAction.MARK_DELIVERED
          ? TON_NATIVE_CONTRACT_STATUS.DELIVERED
          : TON_NATIVE_CONTRACT_STATUS.RELEASED,
      senderAddress:
        action === TonNativeLifecycleAction.MARK_DELIVERED ? seller : buyer,
      queryId: queryId.toString(),
      actionValueAtomic: "50000000",
      payload,
      payloadHash,
    });
  }

  function transaction(
    lifecycleIntent: TonNativeLifecycleIntent,
    out_msgs: TonCenterTransaction["out_msgs"] = [],
  ): TonCenterTransaction {
    const data = beginCell()
      .storeUint(lifecycleIntent.expectedToStatus, 8)
      .storeCoins(buyerTotal)
      .storeUint(queryId, 64)
      .storeRef(config)
      .endCell();
    return {
      account: escrow,
      account_state_after: {
        account_status: "active",
        code_hash: code.hash().toString("base64"),
        data_boc: data.toBoc().toString("base64"),
      },
      description: {
        aborted: false,
        compute_ph: { skipped: false, success: true, exit_code: 0 },
        action: { success: true, valid: true, result_code: 0 },
      },
      emulated: false,
      end_status: "active",
      hash: "tx-hash",
      in_msg: {
        bounced: false,
        source: lifecycleIntent.senderAddress,
        destination: escrow,
        value: "50000000",
        hash: "message-hash",
        message_content: { body: lifecycleIntent.payload },
      },
      out_msgs,
      lt: "123",
      mc_block_seqno: 99,
      now: 1_900_000_000,
    };
  }

  function payout(destination: string, value: bigint, kind: number) {
    const dealUint = BigInt(`0x${dealId.replace(/-/g, "")}`);
    return {
      bounced: false,
      source: escrow,
      destination,
      value: value.toString(),
      message_content: {
        body: beginCell()
          .storeUint(0x7061796f, 32)
          .storeUint(queryId, 64)
          .storeUint(dealUint, 256)
          .storeUint(kind, 8)
          .endCell()
          .toBoc()
          .toString("base64"),
      },
    };
  }

  it("accepts delivery only with the exact intent and committed post-state", () => {
    const lifecycleIntent = intent(TonNativeLifecycleAction.MARK_DELIVERED);
    expect(
      validateTonNativeLifecycleTransaction(
        transaction(lifecycleIntent),
        preparation,
        lifecycleIntent,
      ),
    ).toMatchObject({ accepted: true, reasonCode: "LIFECYCLE_CONFIRMED" });
  });

  it("accepts release only with exact seller and treasury payouts", () => {
    const lifecycleIntent = intent(TonNativeLifecycleAction.RELEASE);
    const tx = transaction(lifecycleIntent, [
      payout(seller, sellerPayout, 1),
      payout(treasury, platformFee, 3),
    ]);
    expect(
      validateTonNativeLifecycleTransaction(tx, preparation, lifecycleIntent)
        .accepted,
    ).toBe(true);
  });

  it("rejects a release with a substituted payout destination", () => {
    const lifecycleIntent = intent(TonNativeLifecycleAction.RELEASE);
    const tx = transaction(lifecycleIntent, [
      payout(buyer, sellerPayout, 1),
      payout(treasury, platformFee, 3),
    ]);
    expect(
      validateTonNativeLifecycleTransaction(tx, preparation, lifecycleIntent)
        .reasonCode,
    ).toBe("PAYOUT_MISMATCH");
  });

  it("rejects a successful call whose post-state status is wrong", () => {
    const lifecycleIntent = intent(TonNativeLifecycleAction.MARK_DELIVERED);
    const tx = transaction(lifecycleIntent);
    tx.account_state_after!.data_boc = beginCell()
      .storeUint(TON_NATIVE_CONTRACT_STATUS.DISPUTED, 8)
      .storeCoins(buyerTotal)
      .storeUint(queryId, 64)
      .storeRef(config)
      .endCell()
      .toBoc()
      .toString("base64");
    expect(
      validateTonNativeLifecycleTransaction(tx, preparation, lifecycleIntent)
        .reasonCode,
    ).toBe("POST_STATE_STATUS_MISMATCH");
  });

  it("accepts resolution only with the exact immutable awards", () => {
    const buyerAward = 700_000_000n;
    const sellerAward = 1_200_000_000n;
    const payload = buildTonNativeLifecyclePayload(
      TonNativeLifecycleAction.RESOLVE,
      queryId,
      { buyerAward, sellerAward },
    );
    const lifecycleIntent = Object.assign(new TonNativeLifecycleIntent(), {
      id: "50000000-0000-4000-8000-000000000002",
      preparationId: preparation.id,
      dealId,
      action: TonNativeLifecycleAction.RESOLVE,
      expectedFromStatus: TON_NATIVE_CONTRACT_STATUS.DISPUTED,
      expectedToStatus: TON_NATIVE_CONTRACT_STATUS.RESOLVED,
      senderAddress: `0:${"55".repeat(32)}`,
      queryId: queryId.toString(),
      actionValueAtomic: "50000000",
      payload,
      payloadHash: beginCell()
        .storeUint(0x72736c76, 32)
        .storeUint(queryId, 64)
        .storeCoins(buyerAward)
        .storeCoins(sellerAward)
        .endCell()
        .hash()
        .toString("hex"),
      buyerAwardAtomic: buyerAward.toString(),
      sellerAwardAtomic: sellerAward.toString(),
    });
    const tx = transaction(lifecycleIntent, [
      payout(buyer, buyerAward, 2),
      payout(seller, sellerAward, 1),
      payout(treasury, platformFee, 3),
    ]);

    expect(
      validateTonNativeLifecycleTransaction(tx, preparation, lifecycleIntent),
    ).toMatchObject({ accepted: true, reasonCode: "LIFECYCLE_CONFIRMED" });
  });
});
