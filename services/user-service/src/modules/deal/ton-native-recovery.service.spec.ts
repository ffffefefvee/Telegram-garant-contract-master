import { ConflictException, ForbiddenException } from "@nestjs/common";
import { AuditLogService } from "../ops/audit-log.service";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  TonNativeChainEvent,
  TonNativeChainEventOutcome,
} from "./entities/ton-native-chain-event.entity";
import {
  TonNativeEscrowWatch,
  TonNativeEscrowWatchStatus,
} from "./entities/ton-native-escrow-watch.entity";
import {
  TonNativeRecoveryRequest,
  TonNativeRecoveryRequestStatus,
} from "./entities/ton-native-recovery-request.entity";
import { TonNativeRecoveryService } from "./ton-native-recovery.service";

describe("TonNativeRecoveryService", () => {
  it("returns paginated rejected evidence with exact operator filters", async () => {
    const event = Object.assign(new TonNativeChainEvent(), {
      id: "10000000-0000-4000-8000-000000000009",
      preparationId: "20000000-0000-4000-8000-000000000009",
      dealId: "30000000-0000-4000-8000-000000000009",
      eventType: "fund",
      network: TonNetwork.TESTNET,
      accountAddress: `0:${"11".repeat(32)}`,
      transactionLt: "456",
      transactionHash: "33".repeat(32),
      outcome: TonNativeChainEventOutcome.REJECTED,
      reasonCode: "FUNDING_AMOUNT_MISMATCH",
      evidence: { expectedAmount: "100", observedAmount: "99" },
      createdAt: new Date("2030-01-01T00:00:00Z"),
    });
    const eventRepo = {
      findAndCount: jest.fn().mockResolvedValue([[event], 1]),
    } as any;
    const service = new TonNativeRecoveryService(
      eventRepo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.listRejectedEvents({
        page: 2,
        limit: 10,
        dealId: event.dealId,
        network: TonNetwork.TESTNET,
        reasonCode: event.reasonCode,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: event.id,
          reasonCode: "FUNDING_AMOUNT_MISMATCH",
          evidence: { expectedAmount: "100", observedAmount: "99" },
        },
      ],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(eventRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          outcome: TonNativeChainEventOutcome.REJECTED,
          dealId: event.dealId,
          network: TonNetwork.TESTNET,
          reasonCode: "FUNDING_AMOUNT_MISMATCH",
        },
        skip: 10,
        take: 10,
      }),
    );
  });

  function fixture() {
    const event = Object.assign(new TonNativeChainEvent(), {
      id: "10000000-0000-4000-8000-000000000001",
      preparationId: "20000000-0000-4000-8000-000000000001",
      dealId: "30000000-0000-4000-8000-000000000001",
      eventType: "fund",
      network: TonNetwork.TESTNET,
      accountAddress: `0:${"11".repeat(32)}`,
      transactionLt: "123",
      transactionHash: "22".repeat(32),
      outcome: TonNativeChainEventOutcome.ACCEPTED,
      appliedAt: null,
      applyAttempts: 5,
      automationStoppedAt: new Date("2030-01-01T00:00:00Z"),
      lastApplyError: "SECONDARY_HTTP_503",
      reconciliationError: "SECONDARY_HTTP_503",
    });
    const watch = Object.assign(new TonNativeEscrowWatch(), {
      id: "40000000-0000-4000-8000-000000000001",
      preparationId: event.preparationId,
      status: TonNativeEscrowWatchStatus.MANUAL_REVIEW,
    });
    const request = Object.assign(new TonNativeRecoveryRequest(), {
      id: "60000000-0000-4000-8000-000000000001",
      eventId: event.id,
      requestedBy: "50000000-0000-4000-8000-000000000001",
      approvedBy: null,
      status: TonNativeRecoveryRequestStatus.PENDING,
      reason: "The independent provider has recovered after an outage.",
      expectedLastError: event.lastApplyError,
      approvedAt: null,
      executedAt: null,
    });
    const eventRepo = {
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(() => queryReturning(event)),
    } as any;
    const watchRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => queryReturning(watch)),
    } as any;
    const recoveryRequestRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => Object.assign(request, value)),
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(() => queryReturning(request)),
    } as any;
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === TonNativeChainEvent) return eventRepo;
        if (entity === TonNativeEscrowWatch) return watchRepo;
        return recoveryRequestRepo;
      }),
    } as any;
    const dataSource = {
      options: { type: "postgres" },
      transaction: jest.fn(async (handler) => handler(manager)),
    } as any;
    const audit = {
      writeRequired: jest.fn().mockResolvedValue({ id: "audit-id" }),
    } as unknown as AuditLogService;
    const service = new TonNativeRecoveryService(
      {} as any,
      {} as any,
      {} as any,
      dataSource,
      audit,
    );
    return {
      service,
      event,
      watch,
      request,
      eventRepo,
      watchRepo,
      recoveryRequestRepo,
      audit,
    };
  }

  it("requires a first super admin to create a durable requeue request", async () => {
    const { service, event, recoveryRequestRepo, audit } = fixture();
    await expect(
      service.requestRequeue(
        event.id,
        {
          id: "50000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        {
          reason: "The independent provider has recovered after an outage.",
          expectedLastError: "SECONDARY_HTTP_503",
        },
      ),
    ).resolves.toMatchObject({
      status: "pending_second_approval",
      approvalsRequired: 2,
      replayRequiresReconciliation: true,
    });
    expect(event.automationStoppedAt).not.toBeNull();
    expect(recoveryRequestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TonNativeRecoveryRequestStatus.PENDING,
        requestedBy: "50000000-0000-4000-8000-000000000001",
      }),
    );
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TON_NATIVE_EVENT_REQUEUE_REQUESTED",
        details: expect.objectContaining({ approvalsRequired: 2 }),
      }),
    );
  });

  it("lets a different super admin approve and requeue without bypassing reconciliation", async () => {
    const {
      service,
      event,
      watch,
      request,
      eventRepo,
      watchRepo,
      recoveryRequestRepo,
      audit,
    } = fixture();
    await expect(
      service.approveRequeue(event.id, request.id, {
        id: "70000000-0000-4000-8000-000000000001",
        role: "super_admin",
      }),
    ).resolves.toMatchObject({
      status: "queued",
      replayRequiresReconciliation: true,
    });
    expect(event.automationStoppedAt).toBeNull();
    expect(event.applyAttempts).toBe(0);
    expect(event.lastApplyError).toBeNull();
    expect(event.reconciliationError).toBe("SECONDARY_HTTP_503");
    expect(eventRepo.save).toHaveBeenCalledWith(event);
    expect(request).toMatchObject({
      status: TonNativeRecoveryRequestStatus.EXECUTED,
      approvedBy: "70000000-0000-4000-8000-000000000001",
    });
    expect(recoveryRequestRepo.save).toHaveBeenCalledWith(request);
    expect(watchRepo.update).toHaveBeenCalledWith(
      { id: watch.id },
      expect.objectContaining({
        lastError: "REQUEUE_PENDING: SECONDARY_HTTP_503",
      }),
    );
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TON_NATIVE_EVENT_REQUEUE_APPROVED",
        details: expect.objectContaining({
          reconciliationRequired: true,
          forceApply: false,
        }),
      }),
    );
  });

  it("rejects self-approval and leaves the stopped event unchanged", async () => {
    const { service, event, request, eventRepo } = fixture();
    await expect(
      service.approveRequeue(event.id, request.id, {
        id: request.requestedBy,
        role: "super_admin",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(event.automationStoppedAt).not.toBeNull();
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it("rejects a stale operator view before creating a request", async () => {
    const { service, event, recoveryRequestRepo, audit } = fixture();
    await expect(
      service.requestRequeue(
        event.id,
        {
          id: "50000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        {
          reason: "Retry after reviewing the independent provider incident.",
          expectedLastError: "different-error",
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recoveryRequestRepo.save).not.toHaveBeenCalled();
    expect(audit.writeRequired).not.toHaveBeenCalled();
  });

  it("cancels a pending request without unblocking the event", async () => {
    const { service, event, request, recoveryRequestRepo, audit } = fixture();
    await expect(
      service.cancelRequeue(
        event.id,
        request.id,
        {
          id: "70000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        "The provider incident is not resolved; cancel this recovery request.",
      ),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(event.automationStoppedAt).not.toBeNull();
    expect(request.status).toBe(TonNativeRecoveryRequestStatus.CANCELLED);
    expect(recoveryRequestRepo.save).toHaveBeenCalledWith(request);
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TON_NATIVE_EVENT_REQUEUE_CANCELLED",
      }),
    );
  });

  it("records a required audit note while leaving the event blocked", async () => {
    const { service, event, audit } = fixture();
    await expect(
      service.keepBlocked(
        event.id,
        {
          id: "50000000-0000-4000-8000-000000000001",
          role: "admin",
        },
        "Mismatch requires independent investigation before any replay.",
      ),
    ).resolves.toEqual({ eventId: event.id, status: "manual_review" });
    expect(event.automationStoppedAt).not.toBeNull();
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TON_NATIVE_MANUAL_REVIEW_KEPT_BLOCKED",
      }),
    );
  });
});

function queryReturning(value: unknown) {
  return {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(value),
  };
}
