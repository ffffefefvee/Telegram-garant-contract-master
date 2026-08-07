import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PaymentOperationService } from "./payment-operation.service";
import {
  PaymentOperation,
  PaymentOperationStatus,
} from "./entities/payment-operation.entity";

describe("PaymentOperationService", () => {
  let service: PaymentOperationService;
  let repo: any;

  beforeEach(async () => {
    const rows: any[] = [];
    repo = {
      create: jest.fn((input) => ({ id: `op-${rows.length + 1}`, ...input })),
      save: jest.fn(async (row) => {
        rows.push({ ...row });
        return row;
      }),
      update: jest.fn(async (criteria, patch) => {
        const row = rows.find(
          (item) =>
            item.id === criteria.id && item.leaseOwner === criteria.leaseOwner,
        );
        if (row) Object.assign(row, patch);
        return { affected: row ? 1 : 0 };
      }),
      rows,
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentOperationService,
        { provide: getRepositoryToken(PaymentOperation), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn(() => 300) } },
      ],
    }).compile();
    service = moduleRef.get(PaymentOperationService);
  });

  it("claims a new operation and persists its confirmed transaction hashes", async () => {
    const claim = await service.claimFunding({
      provider: "cryptomus",
      eventKey: "order-1",
      paymentId: "p1",
      dealId: "d1",
    });
    expect(claim.claimed).toBe(true);
    expect(claim.operation.status).toBe(PaymentOperationStatus.PROCESSING);
    expect(claim.operation.attempts).toBe(1);
    expect(claim.operation.leaseExpiresAt).toBeInstanceOf(Date);
    await service.markCompleted(claim.operation.id, {
      transfer: "0xtransfer",
      notify: "0xnotify",
    });
    expect(repo.rows[0]).toMatchObject({
      status: PaymentOperationStatus.COMPLETED,
      transferTxHash: "0xtransfer",
      notifyTxHash: "0xnotify",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });

  it("records a retryable failure without dropping the recovery record", async () => {
    const claim = await service.claimFunding({
      provider: "cryptomus",
      eventKey: "order-1",
      paymentId: "p1",
      dealId: "d1",
    });
    await service.markRetryableFailure(
      claim.operation.id,
      new Error("rpc unavailable"),
    );
    expect(repo.rows[0]).toMatchObject({
      status: PaymentOperationStatus.FAILED_RETRYABLE,
      lastErrorCode: "PAYMENT_OPERATION_FAILED",
      lastError: "rpc unavailable",
      leaseOwner: null,
    });
  });

  it("parks terminal conflicts for manual review", async () => {
    const claim = await service.claimFunding({
      provider: "cryptomus",
      eventKey: "order-2",
      paymentId: "p2",
      dealId: "d2",
    });
    await service.markManualReview(
      claim.operation.id,
      new Error("deal cancelled"),
    );
    expect(repo.rows[0]).toMatchObject({
      status: PaymentOperationStatus.MANUAL_REVIEW,
      lastError: "deal cancelled",
      leaseOwner: null,
    });
  });

  it("fails closed when a worker no longer owns the lease", async () => {
    await expect(
      service.markCompleted("operation-owned-by-another-worker", {}),
    ).rejects.toThrow("lease was lost");
  });
});
