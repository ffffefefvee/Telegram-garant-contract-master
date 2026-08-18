import { ConfigService } from "@nestjs/config";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import { Deal } from "../deal/entities/deal.entity";
import { TonNativeEscrowPreparation } from "../deal/entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "../deal/entities/ton-native-lifecycle-intent.entity";
import { DealStatus } from "../deal/enums/deal.enum";
import { parseTonNativeLifecyclePayload } from "../deal/ton-native-lifecycle";
import {
  TonNetwork,
  TonWalletBinding,
} from "../user/entities/ton-wallet-binding.entity";
import { UserType } from "../user/entities/user.entity";
import { ArbitrationDecision } from "./entities/arbitration-decision.entity";
import { Dispute } from "./entities/dispute.entity";
import {
  ArbitrationDecisionType,
  DisputeStatus,
} from "./entities/enums/arbitration.enum";
import { TonNativeResolutionRequestService } from "./ton-native-resolution-request.service";

describe("TonNativeResolutionRequestService", () => {
  const decisionId = "10000000-0000-4000-8000-000000000001";
  const disputeId = "20000000-0000-4000-8000-000000000001";
  const dealId = "30000000-0000-4000-8000-000000000001";
  const preparationId = "40000000-0000-4000-8000-000000000001";
  const resolverUserId = "50000000-0000-4000-8000-000000000001";
  const arbitratorUserId = "60000000-0000-4000-8000-000000000001";
  const resolverAddress = `0:${"11".repeat(32)}`;

  function setup(overrides: { bindingAddress?: string; now?: number } = {}) {
    const now = overrides.now ?? 2_000_000_000;
    const dispute = Object.assign(new Dispute(), {
      id: disputeId,
      dealId,
      decisionId,
      arbitratorId: arbitratorUserId,
      appealId: null,
      status: DisputeStatus.DECISION_MADE,
    });
    const decision = Object.assign(new ArbitrationDecision(), {
      id: decisionId,
      disputeId,
      dispute,
      arbitratorId: arbitratorUserId,
      decisionType: ArbitrationDecisionType.SPLIT_FUNDS,
      reasoning: "Both parties share responsibility",
      isAppealable: true,
      isEnforced: false,
      appealPeriodHours: 24,
      createdAt: new Date((now - 90_000) * 1_000),
    });
    const deal = Object.assign(new Deal(), {
      id: dealId,
      quoteId: preparationId,
      status: DealStatus.DISPUTED,
    });
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: preparationId,
      dealId,
      network: TonNetwork.TESTNET,
      escrowAddress: `0:${"22".repeat(32)}`,
      arbitratorAddress: resolverAddress,
      buyerTotalAtomic: "2000000000",
      platformFeeAtomic: "100000000",
    });
    const binding = Object.assign(new TonWalletBinding(), {
      userId: resolverUserId,
      network: TonNetwork.TESTNET,
      address: overrides.bindingAddress ?? resolverAddress,
    });
    const manager = {
      findOne: jest.fn(async (entity) => {
        if (entity === ArbitrationDecision) return decision;
        if (entity === Deal) return deal;
        if (entity === TonNativeEscrowPreparation) return preparation;
        if (entity === TonWalletBinding) return binding;
        if (entity === TonNativeLifecycleIntent) return null;
        return null;
      }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => ({ id: "intent-id", ...value })),
    };
    const dataSource = {
      options: { type: "sqlite" },
      transaction: jest.fn(async (callback) => callback(manager)),
    } as any;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    const adapter = {
      isReady: jest.fn().mockReturnValue(true),
    } as unknown as TonEscrowAdapter;
    return {
      now,
      manager,
      service: new TonNativeResolutionRequestService(
        dataSource,
        config,
        adapter,
      ),
    };
  }

  it("creates an exact authority-signed split award after the appeal window", async () => {
    const { now, service } = setup();
    const result = await service.buildRequest(
      decisionId,
      resolverUserId,
      [UserType.ADMIN],
      now,
    );

    expect(result.buyerAwardAtomic).toBe("950000000");
    expect(result.sellerAwardAtomic).toBe("950000000");
    expect(result.platformFeeAtomic).toBe("100000000");
    expect(result.transaction.from).toBe(resolverAddress);
    const parsed = parseTonNativeLifecyclePayload(
      result.transaction.messages[0].payload!,
    );
    expect(parsed).toMatchObject({
      buyerAward: 950_000_000n,
      sellerAward: 950_000_000n,
    });
  });

  it("rejects a non-administrative arbitrator at the resolver boundary", async () => {
    const { now, service } = setup();
    await expect(
      service.buildRequest(
        decisionId,
        arbitratorUserId,
        [UserType.ARBITRATOR],
        now,
      ),
    ).rejects.toThrow("authorized resolution operator");
  });

  it("rejects an operator whose wallet is not the committed authority", async () => {
    const { now, service } = setup({
      bindingAddress: `0:${"99".repeat(32)}`,
    });
    await expect(
      service.buildRequest(
        decisionId,
        resolverUserId,
        [UserType.SUPER_ADMIN],
        now,
      ),
    ).rejects.toThrow("resolver-authority wallet");
  });

  it("rejects enforcement while the appeal window is open", async () => {
    const { now, manager, service } = setup();
    const decision = (await manager.findOne(
      ArbitrationDecision,
    )) as ArbitrationDecision;
    decision.createdAt = new Date((now - 60) * 1_000);
    await expect(
      service.buildRequest(decisionId, resolverUserId, [UserType.ADMIN], now),
    ).rejects.toThrow("Appeal period has not expired");
  });
});
