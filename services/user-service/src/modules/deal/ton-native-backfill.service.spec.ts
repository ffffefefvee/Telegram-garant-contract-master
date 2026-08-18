import { ConflictException } from "@nestjs/common";
import { AuditLogService } from "../ops/audit-log.service";
import {
  TonNativeEscrowWatch,
  TonNativeEscrowWatchStatus,
} from "./entities/ton-native-escrow-watch.entity";
import { TonNativeBackfillService } from "./ton-native-backfill.service";
import { TonNativeFundingIngestionService } from "./ton-native-funding-ingestion.service";
import { TonNativeLifecycleIngestionService } from "./ton-native-lifecycle-ingestion.service";

describe("TonNativeBackfillService", () => {
  function fixture(status = TonNativeEscrowWatchStatus.WATCHING) {
    const watch = Object.assign(new TonNativeEscrowWatch(), {
      id: "10000000-0000-4000-8000-000000000001",
      preparationId: "20000000-0000-4000-8000-000000000001",
      dealId: "30000000-0000-4000-8000-000000000001",
      status,
      network: "-3",
      accountAddress: `0:${"11".repeat(32)}`,
      lastFinalizedLt: "100",
    });
    const watchRepo = {
      findOne: jest.fn().mockResolvedValue(watch),
    } as any;
    const funding = {
      backfillWatch: jest.fn().mockResolvedValue({
        transactionsObserved: 3,
        pageLimitReached: false,
      }),
    } as unknown as TonNativeFundingIngestionService;
    const lifecycle = {
      backfillWatch: jest.fn().mockResolvedValue({
        observed: 4,
        pageLimitReached: true,
      }),
    } as unknown as TonNativeLifecycleIngestionService;
    const audit = {
      writeRequired: jest.fn().mockResolvedValue({ id: "audit-1" }),
      write: jest.fn().mockResolvedValue({ id: "audit-2" }),
    } as unknown as AuditLogService;
    const service = new TonNativeBackfillService(
      watchRepo,
      funding,
      lifecycle,
      audit,
    );
    return { service, watch, funding, lifecycle, audit };
  }

  it("runs a bounded funding scan without rewriting the cursor", async () => {
    const { service, watch, funding, lifecycle, audit } = fixture();
    await expect(
      service.run(
        watch.id,
        {
          id: "40000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        {
          maxPages: 3,
          reason:
            "Continue the bounded finalized backlog after provider recovery.",
        },
      ),
    ).resolves.toMatchObject({ cursorRewrite: false });
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TON_NATIVE_BOUNDED_BACKFILL_REQUESTED",
        details: expect.objectContaining({
          maxPages: 3,
          cursorRewrite: false,
        }),
      }),
    );
    expect(funding.backfillWatch).toHaveBeenCalledWith(watch.id, 3);
    expect(lifecycle.backfillWatch).not.toHaveBeenCalled();
  });

  it("routes funded watches through lifecycle ingestion", async () => {
    const { service, watch, lifecycle } = fixture(
      TonNativeEscrowWatchStatus.FUNDED,
    );
    await service.run(
      watch.id,
      {
        id: "40000000-0000-4000-8000-000000000001",
        role: "super_admin",
      },
      {
        maxPages: 2,
        reason:
          "Continue lifecycle ingestion from the durable finalized cursor.",
      },
    );
    expect(lifecycle.backfillWatch).toHaveBeenCalledWith(watch.id, 2);
  });

  it("does not scan stopped watches", async () => {
    const { service, watch, funding, audit } = fixture(
      TonNativeEscrowWatchStatus.MANUAL_REVIEW,
    );
    await expect(
      service.run(
        watch.id,
        {
          id: "40000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        {
          maxPages: 1,
          reason: "Attempt to scan a watch which must remain fail-closed.",
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.writeRequired).not.toHaveBeenCalled();
    expect(funding.backfillWatch).not.toHaveBeenCalled();
  });

  it("does not scan when the required request audit cannot be written", async () => {
    const { service, watch, funding, audit } = fixture();
    (audit.writeRequired as jest.Mock).mockRejectedValue(
      new Error("audit unavailable"),
    );
    await expect(
      service.run(
        watch.id,
        {
          id: "40000000-0000-4000-8000-000000000001",
          role: "super_admin",
        },
        {
          maxPages: 1,
          reason: "Backfill must not begin without a durable audit request.",
        },
      ),
    ).rejects.toThrow("audit unavailable");
    expect(funding.backfillWatch).not.toHaveBeenCalled();
  });
});
