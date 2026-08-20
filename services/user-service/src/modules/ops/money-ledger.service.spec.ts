import { TonNativeLifecycleAction } from "../deal/ton-native-lifecycle";
import { MoneyLedgerService, nanoToDecimalTon } from "./money-ledger.service";

describe("nanoToDecimalTon", () => {
  it.each([
    ["1", "0.000000001"],
    ["1000000000", "1"],
    ["1500000001", "1.500000001"],
    ["123456789012345678", "123456789.012345678"],
  ])("formats %s nanotons exactly", (atomic, expected) => {
    expect(nanoToDecimalTon(atomic)).toBe(expected);
  });

  it.each(["", "-1", "1.2", "0"])("rejects invalid amount %s", (value) => {
    expect(() => nanoToDecimalTon(value)).toThrow();
  });
});

describe("MoneyLedgerService native TON settlement", () => {
  const base = {
    chainEventId: "event-1",
    dealId: "deal-1",
    buyerAddress: "buyer",
    sellerAddress: "seller",
    treasuryAddress: "treasury",
    sellerPayoutAtomic: "970000000",
    platformFeeAtomic: "30000000",
    refundToBuyerAtomic: "1000000000",
    refundFeeAtomic: "0",
    buyerAwardAtomic: null,
    sellerAwardAtomic: null,
    transactionHash: "tx-hash",
    transactionLt: "42",
  };

  function makeService() {
    const repo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    return { repo, service: new MoneyLedgerService(repo as any) };
  }

  it("records seller and platform release movements with distinct keys", async () => {
    const { repo, service } = makeService();
    await service.recordNativeTonSettlement({
      ...base,
      action: TonNativeLifecycleAction.RELEASE,
    });

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: "ton-native:event-1:seller",
        debitAccount: "escrow:deal-1",
        creditAccount: "external_seller_ton",
        amount: "0.97",
        entryType: "native_ton_escrow_released",
      }),
    );
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "ton-native:event-1:platform",
        creditAccount: "platform_treasury_ton",
        amount: "0.03",
      }),
    );
  });

  it("records a full buyer refund and omits a zero-fee movement", async () => {
    const { repo, service } = makeService();
    await service.recordNativeTonSettlement({
      ...base,
      action: TonNativeLifecycleAction.REFUND_BUYER,
    });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "ton-native:event-1:buyer",
        creditAccount: "external_buyer_ton",
        amount: "1",
        entryType: "native_ton_escrow_refunded",
      }),
    );
  });

  it("does not create settlement entries for non-payout actions", async () => {
    const { repo, service } = makeService();
    await service.recordNativeTonSettlement({
      ...base,
      action: TonNativeLifecycleAction.OPEN_DISPUTE,
    });

    expect(repo.save).not.toHaveBeenCalled();
  });

  it("records exact buyer, seller, and treasury resolution movements", async () => {
    const { repo, service } = makeService();
    await service.recordNativeTonSettlement({
      ...base,
      action: TonNativeLifecycleAction.RESOLVE,
      buyerAwardAtomic: "700000000",
      sellerAwardAtomic: "270000000",
    });

    expect(repo.save).toHaveBeenCalledTimes(3);
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: "ton-native:event-1:buyer-award",
        amount: "0.7",
        entryType: "native_ton_escrow_resolved",
      }),
    );
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "ton-native:event-1:seller-award",
        amount: "0.27",
      }),
    );
  });

  it("completes a partial settlement exactly once after a crash and replay", async () => {
    const { repo, service } = makeService();
    (repo.save as jest.Mock)
      .mockResolvedValueOnce({ id: "seller-entry" })
      .mockRejectedValueOnce(new Error("simulated database disconnect"))
      .mockRejectedValueOnce(new Error("unique constraint violation"))
      .mockResolvedValueOnce({ id: "platform-entry" });

    await expect(
      service.recordNativeTonSettlement({
        ...base,
        action: TonNativeLifecycleAction.RELEASE,
      }),
    ).rejects.toThrow("simulated database disconnect");
    await expect(
      service.recordNativeTonSettlement({
        ...base,
        action: TonNativeLifecycleAction.RELEASE,
      }),
    ).resolves.toBeUndefined();

    expect(repo.save).toHaveBeenCalledTimes(4);
    expect(
      repo.create.mock.calls.map(([entry]) => entry.idempotencyKey),
    ).toEqual([
      "ton-native:event-1:seller",
      "ton-native:event-1:platform",
      "ton-native:event-1:seller",
      "ton-native:event-1:platform",
    ]);
  });

  it("completes all three resolution legs without duplicating the committed buyer award", async () => {
    const { repo, service } = makeService();
    (repo.save as jest.Mock)
      .mockResolvedValueOnce({ id: "buyer-award-entry" })
      .mockRejectedValueOnce(new Error("simulated database disconnect"))
      .mockRejectedValueOnce(new Error("unique constraint violation"))
      .mockResolvedValueOnce({ id: "seller-award-entry" })
      .mockResolvedValueOnce({ id: "platform-entry" });

    const input = {
      ...base,
      action: TonNativeLifecycleAction.RESOLVE,
      buyerAwardAtomic: "700000000",
      sellerAwardAtomic: "270000000",
    };
    await expect(service.recordNativeTonSettlement(input)).rejects.toThrow(
      "simulated database disconnect",
    );
    await expect(
      service.recordNativeTonSettlement(input),
    ).resolves.toBeUndefined();

    expect(repo.save).toHaveBeenCalledTimes(5);
    expect(
      repo.create.mock.calls.map(([entry]) => entry.idempotencyKey),
    ).toEqual([
      "ton-native:event-1:buyer-award",
      "ton-native:event-1:seller-award",
      "ton-native:event-1:buyer-award",
      "ton-native:event-1:seller-award",
      "ton-native:event-1:platform",
    ]);
  });
});

describe("MoneyLedgerService native TON funding", () => {
  it("treats a replayed finalized funding event as the same logical movement", async () => {
    const repo = {
      create: jest.fn((value) => value),
      save: jest
        .fn()
        .mockResolvedValueOnce({ id: "funding-entry" })
        .mockRejectedValueOnce(new Error("unique constraint violation")),
    };
    const service = new MoneyLedgerService(repo as any);
    const input = {
      chainEventId: "fund-event-1",
      dealId: "deal-1",
      buyerAddress: "buyer",
      buyerTotalAtomic: "1500000000",
      requestValueAtomic: "1700000000",
      transactionHash: "tx-fund",
      transactionLt: "41",
      masterchainSeqno: 99,
    };

    await expect(service.recordNativeTonEscrowFunding(input)).resolves.toEqual({
      id: "funding-entry",
    });
    await expect(
      service.recordNativeTonEscrowFunding(input),
    ).resolves.toBeNull();

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: "ton-native:fund-event-1:fund",
        debitAccount: "external_buyer_ton",
        creditAccount: "escrow:deal-1",
        amount: "1.5",
      }),
    );
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "ton-native:fund-event-1:fund",
      }),
    );
  });
});
