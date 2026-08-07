import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository, UpdateResult } from "typeorm";
import { randomUUID } from "crypto";
import {
  PaymentOperation,
  PaymentOperationStatus,
} from "./entities/payment-operation.entity";

const PG_UNIQUE_VIOLATION = "23505";
const FUND_ESCROW_OPERATION = "fund_escrow";
const MAX_CLAIM_RETRIES = 3;

/** The worker no longer owns the operation lease and must stop mutating it. */
export class PaymentOperationLeaseLostError extends Error {
  constructor(operationId: string) {
    super(`Payment operation lease was lost for ${operationId}`);
    this.name = "PaymentOperationLeaseLostError";
  }
}

export interface FundingOperationRef {
  provider: string;
  eventKey: string;
  paymentId: string;
  dealId: string;
}

export type FundingClaim =
  | { claimed: true; operation: PaymentOperation }
  | { claimed: false; operation: PaymentOperation };

/**
 * Database-backed lease for every relay-funded payment.
 *
 * A lease is deliberately acquired before deployment/forwarding, then the
 * network calls occur outside a database transaction. The relay itself first
 * inspects on-chain state, so a lease recovery never blindly repeats a
 * transfer after a crash between broadcast and persistence.
 */
@Injectable()
export class PaymentOperationService {
  private readonly logger = new Logger(PaymentOperationService.name);
  private readonly leaseOwner = randomUUID();
  private readonly leaseMs: number;

  constructor(
    @InjectRepository(PaymentOperation)
    private readonly repo: Repository<PaymentOperation>,
    config: ConfigService,
  ) {
    const configured = Number(
      config.get("PAYMENT_OPERATION_LEASE_SECONDS", 300),
    );
    this.leaseMs =
      Number.isFinite(configured) && configured >= 30
        ? configured * 1000
        : 300_000;
  }

  async claimFunding(
    ref: FundingOperationRef,
    retryCount = 0,
  ): Promise<FundingClaim> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    try {
      const inserted = await this.repo.save(
        this.repo.create({
          ...ref,
          operationType: FUND_ESCROW_OPERATION,
          status: PaymentOperationStatus.PROCESSING,
          attempts: 1,
          leaseOwner: this.leaseOwner,
          leaseExpiresAt,
        }),
      );
      return { claimed: true, operation: inserted };
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
    }

    const existing = await this.repo.findOne({
      where: {
        provider: ref.provider,
        eventKey: ref.eventKey,
        operationType: FUND_ESCROW_OPERATION,
      },
    });
    if (!existing) {
      // A concurrent transaction may have rolled back after its unique
      // conflict. Bound the retry so a database anomaly cannot create an
      // unbounded request loop.
      if (retryCount >= MAX_CLAIM_RETRIES) {
        throw new Error(
          "Payment operation could not be read after unique conflict",
        );
      }
      return this.claimFunding(ref, retryCount + 1);
    }
    if (
      existing.status === PaymentOperationStatus.COMPLETED ||
      existing.status === PaymentOperationStatus.MANUAL_REVIEW
    ) {
      return { claimed: false, operation: existing };
    }

    // Recover only retryable work or an expired holder. The compare-and-swap
    // condition prevents two replicas from taking the same stale operation.
    const update = await this.repo
      .createQueryBuilder()
      .update(PaymentOperation)
      .set({
        status: PaymentOperationStatus.PROCESSING,
        attempts: () => '"attempts" + 1',
        leaseOwner: this.leaseOwner,
        leaseExpiresAt,
        lastError: null,
        lastErrorCode: null,
      })
      .where("id = :id", { id: existing.id })
      .andWhere(
        '(status = :retryable OR (status = :processing AND "leaseExpiresAt" <= :now))',
        {
          retryable: PaymentOperationStatus.FAILED_RETRYABLE,
          processing: PaymentOperationStatus.PROCESSING,
          now,
        },
      )
      .execute();
    if (update.affected !== 1) {
      const current = await this.repo.findOneOrFail({
        where: { id: existing.id },
      });
      return { claimed: false, operation: current };
    }
    const claimed = await this.repo.findOneOrFail({
      where: { id: existing.id },
    });
    this.logger.warn(
      `Recovered payment operation ${claimed.id} attempt=${claimed.attempts}`,
    );
    return { claimed: true, operation: claimed };
  }

  async markCompleted(
    id: string,
    txHashes: { transfer?: string | null; notify?: string | null },
  ): Promise<void> {
    const result = await this.repo.update(
      { id, leaseOwner: this.leaseOwner },
      {
        status: PaymentOperationStatus.COMPLETED,
        transferTxHash: txHashes.transfer ?? null,
        notifyTxHash: txHashes.notify ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        lastErrorCode: null,
      },
    );
    this.assertLeaseUpdate(id, result);
  }

  async markRetryableFailure(id: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const result = await this.repo.update(
      { id, leaseOwner: this.leaseOwner },
      {
        status: PaymentOperationStatus.FAILED_RETRYABLE,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: this.errorCode(err),
        lastError: message.slice(0, 1000),
      },
    );
    this.assertLeaseUpdate(id, result);
  }

  /**
   * Permanently parks a payment that needs an operator decision. This is used
   * for terminal deal state conflicts, which must never re-enter automated
   * settlement through reconciliation.
   */
  async markManualReview(id: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const result = await this.repo.update(
      { id, leaseOwner: this.leaseOwner },
      {
        status: PaymentOperationStatus.MANUAL_REVIEW,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: this.errorCode(err),
        lastError: message.slice(0, 1000),
      },
    );
    this.assertLeaseUpdate(id, result);
  }

  /** Extend an active lease before a potentially long external call. */
  async renewLease(id: string): Promise<void> {
    const result = await this.repo.update(
      {
        id,
        leaseOwner: this.leaseOwner,
        status: PaymentOperationStatus.PROCESSING,
      },
      { leaseExpiresAt: new Date(Date.now() + this.leaseMs) },
    );
    this.assertLeaseUpdate(id, result);
  }

  /**
   * Keeps the lease live while an external network action is in flight. The
   * final ownership check prevents a stale worker from recording success.
   */
  async withLease<T>(id: string, action: () => Promise<T>): Promise<T> {
    const renewalEveryMs = Math.max(10_000, Math.floor(this.leaseMs / 3));
    let leaseError: Error | null = null;
    const renew = async () => {
      try {
        await this.renewLease(id);
      } catch (err) {
        leaseError =
          err instanceof Error ? err : new PaymentOperationLeaseLostError(id);
        this.logger.error(`Payment operation lease renewal failed for ${id}`);
      }
    };

    await renew();
    if (leaseError) throw leaseError;
    const timer = setInterval(() => void renew(), renewalEveryMs);
    try {
      const result = await action();
      if (leaseError) throw leaseError;
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private assertLeaseUpdate(id: string, result: UpdateResult): void {
    if (result.affected !== 1) {
      throw new PaymentOperationLeaseLostError(id);
    }
  }

  private errorCode(err: unknown): string {
    if (err && typeof err === "object" && "code" in err) {
      return String((err as { code: unknown }).code).slice(0, 64);
    }
    return "PAYMENT_OPERATION_FAILED";
  }

  private isUniqueViolation(err: unknown): boolean {
    if (err instanceof QueryFailedError) {
      return (
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION || /unique/i.test(err.message)
      );
    }
    return /unique/i.test(err instanceof Error ? err.message : "");
  }
}
