import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "crypto";
import { DataSource, EntityManager, Repository } from "typeorm";
import { AuditLogService } from "../../ops/audit-log.service";
import { Payment } from "../entities/payment.entity";
import { TonUnmatchedDeposit, UnmatchedDepositStatus } from "../entities/ton-unmatched-deposit.entity";
import {
  TonUnmatchedRecoveryAction,
  TonUnmatchedRecoveryRequest,
  TonUnmatchedRecoveryStatus,
} from "../entities/ton-unmatched-recovery-request.entity";
import { PaymentMethod, PaymentStatus } from "../enums/payment.enum";
import { PaymentService } from "../payment.service";

export interface RecoveryActor {
  id: string;
  jti: string;
  sid: string;
  scopes: string[];
}

type ApprovalTransactionResult =
  | { expired: true; request: TonUnmatchedRecoveryRequest }
  | {
      expired: false;
      request: TonUnmatchedRecoveryRequest;
      deposit: TonUnmatchedDeposit;
      paymentId: string | null;
    };

@Injectable()
export class TonRecoveryService {
  private readonly logger = new Logger(TonRecoveryService.name);
  private static readonly RECOVERY_SCOPE = "garant:admin:recovery";

  constructor(
    @InjectRepository(TonUnmatchedDeposit)
    private readonly unmatchedRepo: Repository<TonUnmatchedDeposit>,
    private readonly dataSource: DataSource,
    private readonly payments: PaymentService,
    private readonly audit: AuditLogService,
  ) {}

  async list(status?: UnmatchedDepositStatus, limit = 50): Promise<TonUnmatchedDeposit[]> {
    return this.unmatchedRepo.find({
      where: status ? { status } : {},
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
    });
  }

  async requestMatch(
    depositId: string,
    paymentId: string,
    actor: RecoveryActor,
    note?: string,
    expiresInSeconds = 300,
  ): Promise<TonUnmatchedRecoveryRequest> {
    this.assertActor(actor);
    this.assertExpiry(expiresInSeconds);
    return this.dataSource.transaction(async (manager) => {
      const deposit = await this.lockDeposit(manager, depositId);
      const payment = await this.lockPayment(manager, paymentId);
      this.assertMatchEligible(deposit, payment);
      await this.expirePriorRequest(manager, depositId, actor);
      const reason = note?.trim() || null;
      const paymentHash = this.paymentStateHash(payment);
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      const request = manager.getRepository(TonUnmatchedRecoveryRequest).create({
        depositId,
        action: TonUnmatchedRecoveryAction.MATCH,
        paymentId,
        reason,
        intentHash: this.intentHash(depositId, paymentId, reason, deposit.updatedAt, paymentHash, expiresAt, actor.jti),
        expectedDepositUpdatedAt: deposit.updatedAt,
        expectedPaymentStateHash: paymentHash,
        requestedBy: actor.id,
        requesterJti: actor.jti,
        requesterSid: actor.sid,
        approvedBy: null,
        approverJti: null,
        approverSid: null,
        status: TonUnmatchedRecoveryStatus.PENDING,
        expiresAt,
        executedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      });
      const saved = await manager.getRepository(TonUnmatchedRecoveryRequest).save(request);
      await this.audit.writeRequired({
        manager,
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        aggregateType: "ton_unmatched_recovery",
        aggregateId: saved.id,
        action: "TON_RECOVERY_MATCH_REQUESTED",
        details: this.auditDetails(saved, actor, { paymentId }),
      });
      return saved;
    });
  }

  async requestIgnore(
    depositId: string,
    actor: RecoveryActor,
    reason: string,
    expiresInSeconds = 300,
  ): Promise<TonUnmatchedRecoveryRequest> {
    this.assertActor(actor);
    this.assertExpiry(expiresInSeconds);
    const normalized = reason?.trim();
    if (!normalized) throw new BadRequestException("A reason is required to ignore a deposit");
    return this.dataSource.transaction(async (manager) => {
      const deposit = await this.lockDeposit(manager, depositId);
      this.assertUnmatched(deposit);
      await this.expirePriorRequest(manager, depositId, actor);
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      const request = manager.getRepository(TonUnmatchedRecoveryRequest).create({
        depositId,
        action: TonUnmatchedRecoveryAction.IGNORE,
        paymentId: null,
        reason: normalized,
        intentHash: this.intentHash(depositId, null, normalized, deposit.updatedAt, null, expiresAt, actor.jti),
        expectedDepositUpdatedAt: deposit.updatedAt,
        expectedPaymentStateHash: null,
        requestedBy: actor.id,
        requesterJti: actor.jti,
        requesterSid: actor.sid,
        approvedBy: null,
        approverJti: null,
        approverSid: null,
        status: TonUnmatchedRecoveryStatus.PENDING,
        expiresAt,
        executedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      });
      const saved = await manager.getRepository(TonUnmatchedRecoveryRequest).save(request);
      await this.audit.writeRequired({
        manager,
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        aggregateType: "ton_unmatched_recovery",
        aggregateId: saved.id,
        action: "TON_RECOVERY_IGNORE_REQUESTED",
        details: this.auditDetails(saved, actor, { reason: normalized }),
      });
      return saved;
    });
  }

  async approve(
    depositId: string,
    requestId: string,
    actor: RecoveryActor,
  ): Promise<{ request: TonUnmatchedRecoveryRequest; deposit: TonUnmatchedDeposit; payment?: Payment }> {
    this.assertActor(actor);
    const candidate = await this.dataSource.getRepository(TonUnmatchedRecoveryRequest).findOne({
      where: { id: requestId, depositId },
    });
    if (!candidate) throw new NotFoundException("Recovery request not found for deposit");
    if (
      candidate.status === TonUnmatchedRecoveryStatus.PENDING &&
      candidate.expiresAt.getTime() > Date.now() &&
      candidate.action === TonUnmatchedRecoveryAction.MATCH &&
      candidate.paymentId
    ) {
      // Always give the ordinary idempotent reconciliation path a chance first.
      // Any resulting payment mutation invalidates the captured state below.
      await this.payments.checkPaymentStatus(candidate.paymentId);
    }
    const result = await this.dataSource.transaction<ApprovalTransactionResult>(async (manager) => {
      const requests = manager.getRepository(TonUnmatchedRecoveryRequest);
      const request = await requests.findOne({ where: { id: requestId }, lock: { mode: "pessimistic_write" } });
      if (!request || request.depositId !== depositId) throw new NotFoundException("Recovery request not found for deposit");
      if (request.status === TonUnmatchedRecoveryStatus.EXECUTED) {
        const deposit = await manager.getRepository(TonUnmatchedDeposit).findOneByOrFail({ id: depositId });
        return { expired: false, request, deposit, paymentId: request.paymentId };
      }
      if (request.status !== TonUnmatchedRecoveryStatus.PENDING) throw new ConflictException(`Recovery request is ${request.status}`);
      if (request.expiresAt.getTime() <= Date.now()) {
        request.status = TonUnmatchedRecoveryStatus.EXPIRED;
        await requests.save(request);
        await this.audit.writeRequired({
          manager,
          actorId: actor.id,
          actorRole: "SUPER_ADMIN",
          aggregateType: "ton_unmatched_recovery",
          aggregateId: request.id,
          action: "TON_RECOVERY_REQUEST_EXPIRED",
          details: this.auditDetails(request, actor, {}),
        });
        return { expired: true, request };
      }
      if (request.requestedBy === actor.id || request.requesterSid === actor.sid) {
        throw new ForbiddenException("Recovery approval requires a different administrator and IdP session");
      }
      const deposit = await this.lockDeposit(manager, depositId);
      this.assertUnmatched(deposit);
      if (deposit.updatedAt.getTime() !== request.expectedDepositUpdatedAt.getTime()) {
        throw new ConflictException("Deposit changed after recovery was requested");
      }
      if (request.action === TonUnmatchedRecoveryAction.MATCH) {
        const payment = await this.lockPayment(manager, request.paymentId!);
        this.assertMatchEligible(deposit, payment);
        if (this.paymentStateHash(payment) !== request.expectedPaymentStateHash) {
          throw new ConflictException("Payment changed after recovery was requested");
        }
        this.applyMatch(deposit, payment, actor.id, request.reason);
        await manager.getRepository(Payment).save(payment);
      } else {
        deposit.status = "ignored";
        deposit.resolvedBy = actor.id;
        deposit.resolvedAt = new Date();
        deposit.resolutionNote = request.reason;
      }
      await manager.getRepository(TonUnmatchedDeposit).save(deposit);
      request.approvedBy = actor.id;
      request.approverJti = actor.jti;
      request.approverSid = actor.sid;
      request.status = TonUnmatchedRecoveryStatus.EXECUTED;
      request.executedAt = new Date();
      await requests.save(request);
      await this.audit.writeRequired({
        manager,
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        aggregateType: "ton_unmatched_recovery",
        aggregateId: request.id,
        action: request.action === TonUnmatchedRecoveryAction.MATCH ? "TON_RECOVERY_MATCH_EXECUTED" : "TON_RECOVERY_IGNORE_EXECUTED",
        details: this.auditDetails(request, actor, { requesterId: request.requestedBy }),
      });
      return { expired: false, request, deposit, paymentId: request.paymentId };
    });
    if (result.expired) throw new ConflictException("Recovery request has expired");
    const payment = result.paymentId ? await this.payments.checkPaymentStatus(result.paymentId) : undefined;
    this.logger.log(`TON recovery ${result.request.id} executed by ${actor.id}`);
    return { request: result.request, deposit: result.deposit, ...(payment ? { payment } : {}) };
  }

  async cancel(
    depositId: string,
    requestId: string,
    actor: RecoveryActor,
    reason: string,
  ): Promise<TonUnmatchedRecoveryRequest> {
    this.assertActor(actor);
    const normalized = reason?.trim();
    if (!normalized) throw new BadRequestException("A cancellation reason is required");
    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TonUnmatchedRecoveryRequest);
      const request = await repo.findOne({ where: { id: requestId }, lock: { mode: "pessimistic_write" } });
      if (!request || request.depositId !== depositId) throw new NotFoundException("Recovery request not found for deposit");
      if (request.status !== TonUnmatchedRecoveryStatus.PENDING) throw new ConflictException(`Recovery request is ${request.status}`);
      const expired = request.expiresAt.getTime() <= Date.now();
      request.status = expired ? TonUnmatchedRecoveryStatus.EXPIRED : TonUnmatchedRecoveryStatus.CANCELLED;
      if (!expired) {
        request.cancelledAt = new Date();
        request.cancelledBy = actor.id;
        request.cancellationReason = normalized;
      }
      await repo.save(request);
      await this.audit.writeRequired({
        manager,
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        aggregateType: "ton_unmatched_recovery",
        aggregateId: request.id,
        action: expired ? "TON_RECOVERY_REQUEST_EXPIRED" : "TON_RECOVERY_REQUEST_CANCELLED",
        details: this.auditDetails(request, actor, { reason: normalized }),
      });
      return { request, expired };
    });
    if (outcome.expired) throw new ConflictException("Recovery request has expired");
    return outcome.request;
  }

  async countUnmatched(): Promise<number> {
    return this.unmatchedRepo.count({ where: { status: "unmatched" } });
  }

  private async lockDeposit(manager: EntityManager, id: string): Promise<TonUnmatchedDeposit> {
    const row = await manager.getRepository(TonUnmatchedDeposit).findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) throw new NotFoundException(`Unmatched deposit not found: ${id}`);
    return row;
  }

  private async lockPayment(manager: EntityManager, id: string): Promise<Payment> {
    const row = await manager.getRepository(Payment).findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) throw new NotFoundException(`Payment not found: ${id}`);
    return row;
  }

  private async expirePriorRequest(
    manager: EntityManager,
    depositId: string,
    actor: RecoveryActor,
  ): Promise<void> {
    const repo = manager.getRepository(TonUnmatchedRecoveryRequest);
    const pending = await repo.findOne({
      where: { depositId, status: TonUnmatchedRecoveryStatus.PENDING },
      lock: { mode: "pessimistic_write" },
    });
    if (!pending) return;
    if (pending.expiresAt.getTime() > Date.now()) {
      throw new ConflictException("Deposit already has a pending recovery request");
    }
    pending.status = TonUnmatchedRecoveryStatus.EXPIRED;
    await repo.save(pending);
    await this.audit.writeRequired({
      manager,
      actorId: actor.id,
      actorRole: "SUPER_ADMIN",
      aggregateType: "ton_unmatched_recovery",
      aggregateId: pending.id,
      action: "TON_RECOVERY_REQUEST_EXPIRED",
      details: this.auditDetails(pending, actor, { replacedByNewRequest: true }),
    });
  }

  private assertActor(actor: RecoveryActor): void {
    if (!actor?.id || !actor.jti || !actor.sid || !actor.scopes?.includes(TonRecoveryService.RECOVERY_SCOPE)) {
      throw new ForbiddenException(`Recovery requires ${TonRecoveryService.RECOVERY_SCOPE}`);
    }
  }

  private assertExpiry(seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 900) throw new BadRequestException("Recovery approval window must be 60-900 seconds");
  }

  private assertUnmatched(deposit: TonUnmatchedDeposit): void {
    if (deposit.status !== "unmatched") throw new ConflictException(`Deposit already resolved (status=${deposit.status})`);
  }

  private assertMatchEligible(deposit: TonUnmatchedDeposit, payment: Payment): void {
    this.assertUnmatched(deposit);
    const expected = deposit.asset === "TON" ? PaymentMethod.CRYPTO_TONCOIN : PaymentMethod.CRYPTO_TON;
    if (payment.paymentMethod !== expected) throw new BadRequestException(`A ${deposit.asset} deposit can only be matched to a ${expected} payment`);
    if (![PaymentStatus.PENDING, PaymentStatus.PROCESSING].includes(payment.status)) throw new BadRequestException(`Payment cannot accept funds (status=${payment.status})`);
    if (!payment.escrowAddress || !payment.metadata?.memo) throw new BadRequestException("Payment has no escrow/memo — not a settled-via-TON payment");
  }

  private applyMatch(deposit: TonUnmatchedDeposit, payment: Payment, approverId: string, note: string | null): void {
    const previous = this.safeUnits((payment.metadata?.manualCreditUnits as string) ?? "0");
    const matches = Array.isArray(payment.metadata?.manualMatches) ? payment.metadata.manualMatches : [];
    payment.metadata = { ...payment.metadata, manualCreditUnits: (previous + this.safeUnits(deposit.amountUnits)).toString(), manualMatches: [...matches, { unmatchedDepositId: deposit.id, eventId: deposit.eventId, amountUnits: deposit.amountUnits, approvedBy: approverId, approvedAt: new Date().toISOString() }] };
    deposit.status = "matched";
    deposit.matchedPaymentId = payment.id;
    deposit.resolvedBy = approverId;
    deposit.resolvedAt = new Date();
    deposit.resolutionNote = note;
  }

  private paymentStateHash(payment: Payment): string {
    return this.sha256(JSON.stringify({ id: payment.id, status: payment.status, paymentMethod: payment.paymentMethod, escrowAddress: payment.escrowAddress, memo: payment.metadata?.memo ?? null, manualCreditUnits: payment.metadata?.manualCreditUnits ?? "0", updatedAt: payment.updatedAt.toISOString() }));
  }

  private intentHash(depositId: string, paymentId: string | null, reason: string | null, depositUpdatedAt: Date, paymentHash: string | null, expiresAt: Date, requesterJti: string): string {
    return this.sha256(JSON.stringify({ depositId, paymentId, reason, depositUpdatedAt: depositUpdatedAt.toISOString(), paymentHash, expiresAt: expiresAt.toISOString(), requesterJti }));
  }

  private auditDetails(request: TonUnmatchedRecoveryRequest, actor: RecoveryActor, extra: Record<string, unknown>): Record<string, unknown> {
    return { depositId: request.depositId, intentHash: request.intentHash, expiresAt: request.expiresAt.toISOString(), jti: actor.jti, sid: actor.sid, ...extra };
  }

  private sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
  private safeUnits(value: string): bigint {
    try { const units = BigInt(value); return units >= 0n ? units : 0n; } catch { return 0n; }
  }
}
