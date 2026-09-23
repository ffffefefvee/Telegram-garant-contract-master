import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Payment } from "../entities/payment.entity";
import { TonUnmatchedDeposit } from "../entities/ton-unmatched-deposit.entity";
import {
  TonUnmatchedRecoveryRequest,
  TonUnmatchedRecoveryStatus,
} from "../entities/ton-unmatched-recovery-request.entity";
import { PaymentMethod, PaymentStatus } from "../enums/payment.enum";
import { RecoveryActor, TonRecoveryService } from "./ton-recovery.service";

const requester: RecoveryActor = {
  id: "11111111-1111-4111-8111-111111111111",
  jti: "request-jti",
  sid: "request-session",
  scopes: ["garant:admin:recovery"],
};
const approver: RecoveryActor = {
  id: "22222222-2222-4222-8222-222222222222",
  jti: "approve-jti",
  sid: "approve-session",
  scopes: ["garant:admin:recovery"],
};

function deposit(overrides: Partial<TonUnmatchedDeposit> = {}): TonUnmatchedDeposit {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    asset: "USDT",
    eventId: "event-1",
    actionIndex: 0,
    txTimestamp: 1,
    senderAddress: "0:abc",
    amountUnits: "102500000",
    comment: null,
    status: "unmatched",
    paymentHintId: null,
    matchedPaymentId: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as TonUnmatchedDeposit;
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    paymentMethod: PaymentMethod.CRYPTO_TON,
    status: PaymentStatus.PENDING,
    escrowAddress: `0x${"1".repeat(40)}`,
    metadata: { memo: "TG-TEST1234" },
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Payment;
}

describe("TonRecoveryService two-person control", () => {
  let depositRow: TonUnmatchedDeposit;
  let paymentRow: Payment;
  let requestRow: TonUnmatchedRecoveryRequest | null;
  let service: TonRecoveryService;
  let payments: { checkPaymentStatus: jest.Mock };
  let audit: { writeRequired: jest.Mock };

  beforeEach(() => {
    depositRow = deposit();
    paymentRow = payment();
    requestRow = null;
    const depositRepo = {
      findOne: jest.fn(async ({ where }: any) => (where.id === depositRow.id ? depositRow : null)),
      findOneByOrFail: jest.fn(async () => depositRow),
      save: jest.fn(async (row) => row),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 1),
    };
    const paymentRepo = {
      findOne: jest.fn(async ({ where }: any) => (where.id === paymentRow.id ? paymentRow : null)),
      save: jest.fn(async (row) => row),
    };
    const requestRepo = {
      create: jest.fn((row) => row),
      findOne: jest.fn(async ({ where }: any) => {
        if (!requestRow) return null;
        if (where.id && where.id !== requestRow.id) return null;
        if (where.depositId && where.depositId !== requestRow.depositId) return null;
        if (where.status && where.status !== requestRow.status) return null;
        return requestRow;
      }),
      save: jest.fn(async (row) => {
        requestRow = Object.assign(row, {
          id: row.id ?? "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          createdAt: row.createdAt ?? new Date(),
        });
        return requestRow;
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === TonUnmatchedDeposit) return depositRepo;
        if (entity === Payment) return paymentRepo;
        if (entity === TonUnmatchedRecoveryRequest) return requestRepo;
        throw new Error("unexpected repository");
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
      getRepository: jest.fn((entity) => manager.getRepository(entity)),
    };
    payments = { checkPaymentStatus: jest.fn(async () => paymentRow) };
    audit = { writeRequired: jest.fn(async () => ({})) };
    service = new TonRecoveryService(depositRepo as any, dataSource as any, payments as any, audit as any);
  });

  it("records an immutable intent without crediting money", async () => {
    const request = await service.requestMatch(depositRow.id, paymentRow.id, requester, "late memo");

    expect(request.status).toBe(TonUnmatchedRecoveryStatus.PENDING);
    expect(request.intentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(depositRow.status).toBe("unmatched");
    expect(paymentRow.metadata.manualCreditUnits).toBeUndefined();
    expect(audit.writeRequired).toHaveBeenCalledWith(expect.objectContaining({ action: "TON_RECOVERY_MATCH_REQUESTED" }));
  });

  it("rejects requester self-approval", async () => {
    await service.requestMatch(depositRow.id, paymentRow.id, requester);
    await expect(service.approve(depositRow.id, requestRow!.id, requester)).rejects.toThrow(ForbiddenException);
    expect(depositRow.status).toBe("unmatched");
  });

  it("atomically credits after independent approval and invokes settlement", async () => {
    await service.requestMatch(depositRow.id, paymentRow.id, requester);
    const result = await service.approve(depositRow.id, requestRow!.id, approver);

    expect(result.request.status).toBe(TonUnmatchedRecoveryStatus.EXECUTED);
    expect(result.request.requestedBy).toBe(requester.id);
    expect(result.request.approvedBy).toBe(approver.id);
    expect(depositRow.status).toBe("matched");
    expect(paymentRow.metadata.manualCreditUnits).toBe("102500000");
    expect(payments.checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(payments.checkPaymentStatus).toHaveBeenCalledWith(paymentRow.id);
    expect(audit.writeRequired).toHaveBeenLastCalledWith(expect.objectContaining({ action: "TON_RECOVERY_MATCH_EXECUTED" }));
  });

  it("fails closed when payment state changed after request", async () => {
    await service.requestMatch(depositRow.id, paymentRow.id, requester);
    paymentRow.updatedAt = new Date("2026-01-01T00:00:01Z");
    await expect(service.approve(depositRow.id, requestRow!.id, approver)).rejects.toThrow(ConflictException);
    expect(depositRow.status).toBe("unmatched");
    expect(payments.checkPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("requires the dedicated recovery scope", async () => {
    await expect(service.requestIgnore(depositRow.id, { ...requester, scopes: [] }, "refund"))
      .rejects.toThrow(ForbiddenException);
  });

  it("supports audited cancellation without touching ledger state", async () => {
    await service.requestIgnore(depositRow.id, requester, "manual refund planned");
    const cancelled = await service.cancel(depositRow.id, requestRow!.id, requester, "refund abandoned");

    expect(cancelled.status).toBe(TonUnmatchedRecoveryStatus.CANCELLED);
    expect(cancelled.cancelledBy).toBe(requester.id);
    expect(depositRow.status).toBe("unmatched");
    expect(audit.writeRequired).toHaveBeenLastCalledWith(expect.objectContaining({ action: "TON_RECOVERY_REQUEST_CANCELLED" }));
  });
});
