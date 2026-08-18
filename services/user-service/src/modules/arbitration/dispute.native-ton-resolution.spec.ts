import { ConflictException } from "@nestjs/common";
import { DisputeService } from "./dispute.service";
import { ArbitrationDecision } from "./entities/arbitration-decision.entity";
import { Dispute } from "./entities/dispute.entity";
import { DisputeStatus } from "./entities/enums/arbitration.enum";

describe("DisputeService finalized native TON resolution", () => {
  const input = {
    decisionId: "decision-1",
    decisionHash: "a".repeat(64),
    dealId: "deal-1",
    buyerAwardAtomic: "700000000",
    sellerAwardAtomic: "1200000000",
    transactionHash: "tx-hash",
    enforcedByUserId: "resolver-user",
  };

  function setup() {
    const dispute = Object.assign(new Dispute(), {
      id: "dispute-1",
      dealId: input.dealId,
      appealId: null,
      status: DisputeStatus.DECISION_MADE,
      enforcedAt: null,
    });
    const decision = Object.assign(new ArbitrationDecision(), {
      id: input.decisionId,
      dispute,
      isEnforced: false,
      metadata: {},
      enforcedAt: null,
    });
    const disputeRepo = { save: jest.fn(async (value) => value) };
    const decisionRepo = {
      findOne: jest.fn().mockResolvedValue(decision),
      save: jest.fn(async (value) => value),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new DisputeService(
      disputeRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      outbox as any,
      decisionRepo as any,
    );
    return { decision, dispute, disputeRepo, decisionRepo, outbox, service };
  }

  it("marks the exact decision and dispute enforced only after finality", async () => {
    const { decision, dispute, service, outbox } = setup();
    await service.applyFinalizedNativeTonResolution(input);

    expect(decision.isEnforced).toBe(true);
    expect(decision.enforcedById).toBe(input.enforcedByUserId);
    expect(decision.metadata.nativeTon).toEqual(
      expect.objectContaining({
        decisionHash: input.decisionHash,
        transactionHash: input.transactionHash,
      }),
    );
    expect(dispute.status).toBe(DisputeStatus.ENFORCED);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "dispute.native_ton_resolution_finalized",
      }),
    );
  });

  it("treats replay of the same finalized event as idempotent", async () => {
    const { service, decisionRepo } = setup();
    await service.applyFinalizedNativeTonResolution(input);
    await service.applyFinalizedNativeTonResolution(input);

    expect(decisionRepo.save).toHaveBeenCalledTimes(1);
  });

  it("rejects an appealed decision even if a caller supplies awards", async () => {
    const { service, dispute } = setup();
    (dispute as Dispute).appealId = "appeal-1";

    await expect(
      service.applyFinalizedNativeTonResolution(input),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
