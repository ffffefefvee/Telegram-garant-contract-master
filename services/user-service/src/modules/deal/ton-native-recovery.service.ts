import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "crypto";
import { DataSource, EntityManager, IsNull, Not, Repository } from "typeorm";
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

export interface TonNativeRecoveryActor {
  id: string;
  role: string;
  jti: string;
  sid: string;
  scopes: string[];
}

/**
 * Operator boundary for fail-closed native-TON events. There is deliberately
 * no "force apply" operation: a requeued event must pass the normal secondary
 * reconciliation and idempotent business-application path again.
 */
@Injectable()
export class TonNativeRecoveryService {
  private static readonly RECOVERY_SCOPE = "garant:admin:recovery";
  constructor(
    @InjectRepository(TonNativeChainEvent)
    private readonly eventRepo: Repository<TonNativeChainEvent>,
    @InjectRepository(TonNativeEscrowWatch)
    private readonly watchRepo: Repository<TonNativeEscrowWatch>,
    @InjectRepository(TonNativeRecoveryRequest)
    private readonly recoveryRequestRepo: Repository<TonNativeRecoveryRequest>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
  ) {}

  async listManualReviews(input: {
    page: number;
    limit: number;
    dealId?: string;
    network?: TonNetwork;
  }) {
    const where = {
      outcome: TonNativeChainEventOutcome.ACCEPTED,
      appliedAt: IsNull(),
      automationStoppedAt: Not(IsNull()),
      ...(input.dealId ? { dealId: input.dealId } : {}),
      ...(input.network ? { network: input.network } : {}),
    };
    const [events, total] = await this.eventRepo.findAndCount({
      where,
      order: { automationStoppedAt: "ASC", createdAt: "ASC" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    const pairs = await Promise.all(
      events.map(async (event) => ({
        watch: await this.watchRepo.findOne({
          where: { preparationId: event.preparationId },
        }),
        pendingRequest: await this.recoveryRequestRepo.findOne({
          where: {
            eventId: event.id,
            status: TonNativeRecoveryRequestStatus.PENDING,
          },
          order: { createdAt: "DESC" },
        }),
      })),
    );
    return {
      items: events.map((event, index) => ({
        event: this.publicEvent(event),
        watch: pairs[index].watch
          ? this.publicWatch(pairs[index].watch!)
          : null,
        pendingRequeueRequest: pairs[index].pendingRequest,
      })),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  async getManualReview(eventId: string) {
    const event = await this.findStoppedEvent(this.eventRepo, eventId);
    const watch = await this.watchRepo.findOne({
      where: { preparationId: event.preparationId },
      relations: ["preparation"],
    });
    if (!watch) throw new NotFoundException("TON escrow watch not found");
    const pendingRequest = await this.recoveryRequestRepo.findOne({
      where: {
        eventId,
        status: TonNativeRecoveryRequestStatus.PENDING,
      },
      order: { createdAt: "DESC" },
    });
    return {
      event: this.publicEvent(event),
      watch: this.publicWatch(watch),
      preparation: watch.preparation,
      pendingRequeueRequest: pendingRequest,
      recoveryPolicy: {
        canForceApply: false,
        replayRequiresReconciliation: true,
        approvalsRequired: 2,
        expectedLastError: event.lastApplyError,
      },
    };
  }

  async listRejectedEvents(input: {
    page: number;
    limit: number;
    dealId?: string;
    network?: TonNetwork;
    reasonCode?: string;
  }) {
    const [events, total] = await this.eventRepo.findAndCount({
      where: {
        outcome: TonNativeChainEventOutcome.REJECTED,
        ...(input.dealId ? { dealId: input.dealId } : {}),
        ...(input.network ? { network: input.network } : {}),
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      },
      order: { createdAt: "DESC" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    return {
      items: events.map((event) => this.publicEvent(event)),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  async getRejectedEvent(eventId: string) {
    const event = await this.eventRepo.findOne({
      where: {
        id: eventId,
        outcome: TonNativeChainEventOutcome.REJECTED,
      },
    });
    if (!event)
      throw new NotFoundException("Rejected native TON event not found");
    const watch = await this.watchRepo.findOne({
      where: { preparationId: event.preparationId },
    });
    return {
      event: this.publicEvent(event),
      watch: watch ? this.publicWatch(watch) : null,
    };
  }

  async listWatches(input: {
    page: number;
    limit: number;
    dealId?: string;
    network?: TonNetwork;
    status?: TonNativeEscrowWatchStatus;
  }) {
    const [watches, total] = await this.watchRepo.findAndCount({
      where: {
        ...(input.dealId ? { dealId: input.dealId } : {}),
        ...(input.network ? { network: input.network } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      order: { updatedAt: "ASC" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    return {
      items: watches.map((watch) => this.publicWatch(watch)),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  async keepBlocked(
    eventId: string,
    actor: TonNativeRecoveryActor,
    reason: string,
  ) {
    this.assertActor(actor);
    const normalizedReason = normalizeReason(reason);
    return this.dataSource.transaction(async (manager) => {
      const event = await this.lockStoppedEvent(manager, eventId);
      await this.audit.writeRequired({
        actorId: actor.id,
        actorRole: actor.role,
        aggregateType: "ton_native_chain_event",
        aggregateId: event.id,
        action: "TON_NATIVE_MANUAL_REVIEW_KEPT_BLOCKED",
        details: {
          dealId: event.dealId,
          preparationId: event.preparationId,
          reason: normalizedReason,
          lastApplyError: event.lastApplyError,
        },
        manager,
      });
      return { eventId: event.id, status: "manual_review" as const };
    });
  }

  async requestRequeue(
    eventId: string,
    actor: TonNativeRecoveryActor,
    input: { reason: string; expectedLastError: string },
  ) {
    this.assertActor(actor);
    this.assertSuperAdmin(actor);
    this.assertRecoveryActor(actor);
    const reason = normalizeReason(input.reason);
    return this.dataSource.transaction(async (manager) => {
      const event = await this.lockStoppedEvent(manager, eventId);
      if (
        !event.lastApplyError ||
        event.lastApplyError !== input.expectedLastError
      ) {
        throw new ConflictException(
          "TON event changed after inspection; refresh before requeueing",
        );
      }
      const requestRepo = manager.getRepository(TonNativeRecoveryRequest);
      const existing = await requestRepo.findOne({
        where: {
          eventId,
          status: TonNativeRecoveryRequestStatus.PENDING,
        },
      });
      if (existing) {
        if (existing.expiresAt.getTime() > Date.now()) {
          throw new ConflictException(
            "A native TON requeue request is already awaiting approval",
          );
        }
        existing.status = TonNativeRecoveryRequestStatus.EXPIRED;
        await requestRepo.save(existing);
        await this.audit.writeRequired({
          actorId: actor.id,
          actorRole: actor.role,
          aggregateType: "ton_native_chain_event",
          aggregateId: event.id,
          action: "TON_NATIVE_EVENT_REQUEUE_EXPIRED",
          details: {
            recoveryRequestId: existing.id,
            replacedByNewRequest: true,
            jti: actor.jti,
            sid: actor.sid,
          },
          manager,
        });
      }
      const expiresAt = new Date(Date.now() + 300_000);
      const request = await requestRepo.save(
        requestRepo.create({
          eventId,
          requestedBy: actor.id,
          requesterJti: actor.jti,
          requesterSid: actor.sid,
          approvedBy: null,
          approverJti: null,
          approverSid: null,
          status: TonNativeRecoveryRequestStatus.PENDING,
          reason,
          expectedLastError: input.expectedLastError,
          intentHash: this.intentHash(eventId, input.expectedLastError, reason, expiresAt, actor.jti),
          expiresAt,
          approvedAt: null,
          executedAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancellationReason: null,
        }),
      );
      await this.audit.writeRequired({
        actorId: actor.id,
        actorRole: actor.role,
        aggregateType: "ton_native_chain_event",
        aggregateId: event.id,
        action: "TON_NATIVE_EVENT_REQUEUE_REQUESTED",
        details: {
          recoveryRequestId: request.id,
          dealId: event.dealId,
          preparationId: event.preparationId,
          reason,
          expectedLastError: input.expectedLastError,
          approvalsRequired: 2,
          reconciliationRequired: true,
          forceApply: false,
          requesterJti: actor.jti,
          requesterSid: actor.sid,
          expiresAt: request.expiresAt.toISOString(),
        },
        manager,
      });
      return {
        eventId: event.id,
        recoveryRequestId: request.id,
        status: "pending_second_approval" as const,
        approvalsRequired: 2,
        replayRequiresReconciliation: true,
      };
    });
  }

  async approveRequeue(
    eventId: string,
    requestId: string,
    actor: TonNativeRecoveryActor,
  ) {
    this.assertActor(actor);
    this.assertSuperAdmin(actor);
    this.assertRecoveryActor(actor);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const event = await this.lockStoppedEvent(manager, eventId);
      const request = await this.lockRecoveryRequest(manager, requestId);
      if (
        request.eventId !== event.id ||
        request.status !== TonNativeRecoveryRequestStatus.PENDING
      ) {
        throw new ConflictException("Requeue request is not pending for event");
      }
      if (request.expiresAt.getTime() <= Date.now()) {
        request.status = TonNativeRecoveryRequestStatus.EXPIRED;
        await manager.getRepository(TonNativeRecoveryRequest).save(request);
        await this.audit.writeRequired({
          actorId: actor.id,
          actorRole: actor.role,
          aggregateType: "ton_native_chain_event",
          aggregateId: event.id,
          action: "TON_NATIVE_EVENT_REQUEUE_EXPIRED",
          details: { recoveryRequestId: request.id, jti: actor.jti, sid: actor.sid },
          manager,
        });
        return { expired: true as const };
      }
      if (request.requestedBy === actor.id) {
        throw new ForbiddenException(
          "A different super admin must approve native TON recovery",
        );
      }
      if (request.requesterSid === actor.sid) {
        throw new ForbiddenException(
          "A different privileged IdP session must approve native TON recovery",
        );
      }
      if (
        !event.lastApplyError ||
        event.lastApplyError !== request.expectedLastError
      ) {
        throw new ConflictException(
          "TON event changed after recovery was requested; inspect it again",
        );
      }
      const watch = await this.lockWatch(manager, event.preparationId);
      if (watch.status !== TonNativeEscrowWatchStatus.MANUAL_REVIEW) {
        throw new ConflictException("TON escrow watch is not in manual review");
      }

      const previousError = event.lastApplyError;
      const now = new Date();
      event.automationStoppedAt = null;
      event.applyAttempts = 0;
      event.lastApplyError = null;
      request.status = TonNativeRecoveryRequestStatus.EXECUTED;
      request.approvedBy = actor.id;
      request.approverJti = actor.jti;
      request.approverSid = actor.sid;
      request.approvedAt = now;
      request.executedAt = now;
      await manager.getRepository(TonNativeChainEvent).save(event);
      await manager.getRepository(TonNativeRecoveryRequest).save(request);
      await manager.getRepository(TonNativeEscrowWatch).update(
        { id: watch.id },
        {
          consecutiveFailures: 0,
          lastError: `REQUEUE_PENDING: ${previousError}`,
        },
      );
      await this.audit.writeRequired({
        actorId: actor.id,
        actorRole: actor.role,
        aggregateType: "ton_native_chain_event",
        aggregateId: event.id,
        action: "TON_NATIVE_EVENT_REQUEUE_APPROVED",
        details: {
          recoveryRequestId: request.id,
          requestedBy: request.requestedBy,
          approvedBy: actor.id,
          dealId: event.dealId,
          preparationId: event.preparationId,
          reason: request.reason,
          previousError,
          reconciliationRequired: true,
          forceApply: false,
          approverJti: actor.jti,
          approverSid: actor.sid,
        },
        manager,
      });
      return {
        expired: false as const,
        eventId: event.id,
        recoveryRequestId: request.id,
        status: "queued" as const,
        replayRequiresReconciliation: true,
      };
    });
    if (outcome.expired) throw new ConflictException("Requeue request has expired");
    return outcome;
  }

  async cancelRequeue(
    eventId: string,
    requestId: string,
    actor: TonNativeRecoveryActor,
    reason: string,
  ) {
    this.assertActor(actor);
    this.assertSuperAdmin(actor);
    this.assertRecoveryActor(actor);
    const normalizedReason = normalizeReason(reason);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const event = await this.lockStoppedEvent(manager, eventId);
      const request = await this.lockRecoveryRequest(manager, requestId);
      if (
        request.eventId !== event.id ||
        request.status !== TonNativeRecoveryRequestStatus.PENDING
      ) {
        throw new ConflictException("Requeue request is not pending for event");
      }
      if (request.expiresAt.getTime() <= Date.now()) {
        request.status = TonNativeRecoveryRequestStatus.EXPIRED;
        await manager.getRepository(TonNativeRecoveryRequest).save(request);
        await this.audit.writeRequired({
          actorId: actor.id,
          actorRole: actor.role,
          aggregateType: "ton_native_chain_event",
          aggregateId: event.id,
          action: "TON_NATIVE_EVENT_REQUEUE_EXPIRED",
          details: { recoveryRequestId: request.id, jti: actor.jti, sid: actor.sid },
          manager,
        });
        return { expired: true as const };
      }
      request.status = TonNativeRecoveryRequestStatus.CANCELLED;
      request.cancelledAt = new Date();
      request.cancelledBy = actor.id;
      request.cancellationReason = normalizedReason;
      await manager.getRepository(TonNativeRecoveryRequest).save(request);
      await this.audit.writeRequired({
        actorId: actor.id,
        actorRole: actor.role,
        aggregateType: "ton_native_chain_event",
        aggregateId: event.id,
        action: "TON_NATIVE_EVENT_REQUEUE_CANCELLED",
        details: {
          recoveryRequestId: request.id,
          requestedBy: request.requestedBy,
          cancelledBy: actor.id,
          reason: normalizedReason,
        },
        manager,
      });
      return {
        expired: false as const,
        eventId: event.id,
        recoveryRequestId: request.id,
        status: "cancelled" as const,
      };
    });
    if (outcome.expired) throw new ConflictException("Requeue request has expired");
    return outcome;
  }

  private async findStoppedEvent(
    repository: Repository<TonNativeChainEvent>,
    eventId: string,
  ): Promise<TonNativeChainEvent> {
    const event = await repository.findOne({ where: { id: eventId } });
    if (
      !event ||
      event.outcome !== TonNativeChainEventOutcome.ACCEPTED ||
      event.appliedAt ||
      !event.automationStoppedAt
    ) {
      throw new NotFoundException("Stopped native TON event not found");
    }
    return event;
  }

  private async lockStoppedEvent(
    manager: EntityManager,
    eventId: string,
  ): Promise<TonNativeChainEvent> {
    let query = manager
      .getRepository(TonNativeChainEvent)
      .createQueryBuilder("event")
      .where("event.id = :eventId", { eventId });
    if (this.dataSource.options.type === "postgres") {
      query = query.setLock("pessimistic_write");
    }
    const event = await query.getOne();
    if (
      !event ||
      event.outcome !== TonNativeChainEventOutcome.ACCEPTED ||
      event.appliedAt ||
      !event.automationStoppedAt
    ) {
      throw new ConflictException(
        "Native TON event is not eligible for manual recovery",
      );
    }
    return event;
  }

  private async lockWatch(
    manager: EntityManager,
    preparationId: string,
  ): Promise<TonNativeEscrowWatch> {
    let query = manager
      .getRepository(TonNativeEscrowWatch)
      .createQueryBuilder("watch")
      .where("watch.preparationId = :preparationId", { preparationId });
    if (this.dataSource.options.type === "postgres") {
      query = query.setLock("pessimistic_write");
    }
    const watch = await query.getOne();
    if (!watch) throw new NotFoundException("TON escrow watch not found");
    return watch;
  }

  private async lockRecoveryRequest(
    manager: EntityManager,
    requestId: string,
  ): Promise<TonNativeRecoveryRequest> {
    let query = manager
      .getRepository(TonNativeRecoveryRequest)
      .createQueryBuilder("request")
      .where("request.id = :requestId", { requestId });
    if (this.dataSource.options.type === "postgres") {
      query = query.setLock("pessimistic_write");
    }
    const request = await query.getOne();
    if (!request) throw new NotFoundException("TON recovery request not found");
    return request;
  }

  private assertActor(actor: TonNativeRecoveryActor): void {
    if (!actor.id || !actor.role) {
      throw new BadRequestException("Authenticated recovery actor is required");
    }
  }

  private assertSuperAdmin(actor: TonNativeRecoveryActor): void {
    if (actor.role !== "super_admin") {
      throw new ForbiddenException("Native TON requeue requires a super admin");
    }
  }

  private assertRecoveryActor(actor: TonNativeRecoveryActor): void {
    if (
      !actor.jti ||
      !actor.sid ||
      !actor.scopes?.includes(TonNativeRecoveryService.RECOVERY_SCOPE)
    ) {
      throw new ForbiddenException(
        `Native TON recovery requires ${TonNativeRecoveryService.RECOVERY_SCOPE}`,
      );
    }
  }

  private intentHash(
    eventId: string,
    expectedLastError: string,
    reason: string,
    expiresAt: Date,
    requesterJti: string,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          eventId,
          expectedLastError,
          reason,
          expiresAt: expiresAt.toISOString(),
          requesterJti,
        }),
      )
      .digest("hex");
  }

  private publicEvent(event: TonNativeChainEvent) {
    return {
      id: event.id,
      dealId: event.dealId,
      preparationId: event.preparationId,
      eventType: event.eventType,
      network: event.network,
      accountAddress: event.accountAddress,
      transactionLt: event.transactionLt,
      transactionHash: event.transactionHash,
      outcome: event.outcome,
      masterchainSeqno: event.masterchainSeqno,
      transactionTime: event.transactionTime,
      applyAttempts: event.applyAttempts,
      lastApplyError: event.lastApplyError,
      reconciliationError: event.reconciliationError,
      reconciliationSource: event.reconciliationSource,
      reconciliationEvidence: event.reconciliationEvidence,
      reasonCode: event.reasonCode,
      evidence: event.evidence,
      automationStoppedAt: event.automationStoppedAt,
      createdAt: event.createdAt,
    };
  }

  private publicWatch(watch: TonNativeEscrowWatch) {
    return {
      id: watch.id,
      dealId: watch.dealId,
      preparationId: watch.preparationId,
      network: watch.network,
      accountAddress: watch.accountAddress,
      status: watch.status,
      lastFinalizedLt: watch.lastFinalizedLt,
      lastFinalizedTxHash: watch.lastFinalizedTxHash,
      lastFinalizedMcSeqno: watch.lastFinalizedMcSeqno,
      lastScannedAt: watch.lastScannedAt,
      consecutiveFailures: watch.consecutiveFailures,
      lastError: watch.lastError,
      updatedAt: watch.updatedAt,
    };
  }
}

function normalizeReason(value: string): string {
  const reason = value?.trim();
  if (!reason || reason.length < 20 || reason.length > 1000) {
    throw new BadRequestException("Recovery reason must be 20-1000 characters");
  }
  return reason;
}
