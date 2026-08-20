import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Deal } from "./entities/deal.entity";
import { DealStatus } from "./enums/deal.enum";
import { TonNativeLifecycleAction } from "./ton-native-lifecycle";
import { DealService } from "./deal.service";

function makeQuery() {
  const query: any = {
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(async () => [[], 0]),
  };
  return query;
}

describe("DealService list access policy", () => {
  let query: ReturnType<typeof makeQuery>;
  let service: DealService;

  beforeEach(() => {
    query = makeQuery();
    service = new DealService(
      { createQueryBuilder: jest.fn(() => query) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it("rejects an attempt to list another user's deals", async () => {
    await expect(
      service.findMany({ userId: "victim-id" }, "caller-id"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an unrecognised sort field instead of interpolating it into SQL", async () => {
    await expect(
      service.findMany(
        { sortBy: "amount; DROP TABLE deals" as any },
        "caller-id",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uses the allowlisted sort column and bounded pagination", async () => {
    await service.findMany(
      { sortBy: "amount", sortOrder: "ASC", limit: 1000, offset: 20_000 },
      "caller-id",
    );

    expect(query.orderBy).toHaveBeenCalledWith("deal.amount", "ASC");
    expect(query.take).toHaveBeenCalledWith(100);
    expect(query.skip).toHaveBeenCalledWith(10_000);
  });
});

describe("DealService finalized native TON resolution", () => {
  it("advances a disputed deal only after applying the matching decision", async () => {
    const deal = Object.assign(new Deal(), {
      id: "deal-1",
      status: DealStatus.DISPUTED,
      buyerId: "buyer-1",
      sellerId: "seller-1",
    });
    const dealRepository = { save: jest.fn(async (value) => value) };
    const eventRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const disputeService = {
      applyFinalizedNativeTonResolution: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DealService(
      dealRepository as any,
      {} as any,
      {} as any,
      {} as any,
      eventRepository as any,
      {} as any,
      {} as any,
      {} as any,
      outbox as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      disputeService as any,
    );
    jest.spyOn(service, "findById").mockResolvedValue(deal);
    const resolution = {
      decisionId: "decision-1",
      decisionHash: "a".repeat(64),
      buyerAwardAtomic: "700000000",
      sellerAwardAtomic: "1200000000",
      transactionHash: "tx-hash",
    };

    const result = await service.applyFinalizedNativeTonLifecycle(
      deal.id,
      TonNativeLifecycleAction.RESOLVE,
      "resolver-user",
      null,
      resolution,
    );

    expect(
      disputeService.applyFinalizedNativeTonResolution,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ...resolution,
        dealId: deal.id,
        enforcedByUserId: "resolver-user",
      }),
    );
    expect(result.status).toBe(DealStatus.DISPUTE_RESOLVED);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "deal.dispute_resolved_on_ton" }),
    );
  });
});

describe("DealService finalized native TON replay", () => {
  it("does not repeat the receipt transition after a release already completed", async () => {
    const pending = Object.assign(new Deal(), {
      id: "deal-release-1",
      status: DealStatus.PENDING_CONFIRMATION,
      buyerId: "buyer-1",
      sellerId: "seller-1",
    });
    const completed = Object.assign(new Deal(), {
      ...pending,
      status: DealStatus.COMPLETED,
    });
    const service = new DealService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service, "findById")
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(completed);
    const confirmReceipt = jest
      .spyOn(service, "confirmReceipt")
      .mockResolvedValue(completed);

    await expect(
      service.applyFinalizedNativeTonLifecycle(
        pending.id,
        TonNativeLifecycleAction.RELEASE,
        pending.buyerId,
      ),
    ).resolves.toBe(completed);
    await expect(
      service.applyFinalizedNativeTonLifecycle(
        pending.id,
        TonNativeLifecycleAction.RELEASE,
        pending.buyerId,
      ),
    ).resolves.toBe(completed);

    expect(confirmReceipt).toHaveBeenCalledTimes(1);
    expect(confirmReceipt).toHaveBeenCalledWith(pending.id, pending.buyerId);
  });
});
