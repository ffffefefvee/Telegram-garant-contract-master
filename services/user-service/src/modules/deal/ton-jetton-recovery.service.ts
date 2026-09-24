import { createHash } from "crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AuditLogService } from "../ops/audit-log.service";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  TonJettonApplicationReview,
  TonJettonApplicationReviewAction,
  TonJettonChainEvent,
  TonJettonCursorCheckpointKind,
  TonJettonEventApplication,
  TonJettonEventApplicationStatus,
  TonJettonIngestionCursor,
  TonJettonIngestionCursorCheckpoint,
} from "./entities/ton-jetton-chain-event.entity";
import { TonJettonRecoveryKind, TonJettonRecoveryRequest, TonJettonRecoveryStatus } from "./entities/ton-jetton-recovery-request.entity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^-?\d+:[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const REASON = /^[A-Z0-9_]{3,64}$/;
const RECOVERY_SCOPE = "garant:admin:recovery";

export interface TonJettonRecoveryActor {
  id: string;
  role: string;
  jti: string;
  sid: string;
  scopes: string[];
}

export interface TonJettonCursorRewindTarget {
  network: TonNetwork;
  accountAddress: string;
  toLt: string | null;
  toTransactionHash: string | null;
  toMasterchainSeqno: number | null;
  reasonCode: string;
}

/** Manual Jetton recovery cannot execute without two distinct, fresh IdP sessions. */
@Injectable()
export class TonJettonRecoveryService {
  constructor(private readonly dataSource: DataSource, private readonly audit: AuditLogService) {}

  async requestCursorRewind(input: TonJettonCursorRewindTarget, actor: TonJettonRecoveryActor) {
    this.assertActor(actor);
    this.validateCursorTarget(input);
    return this.dataSource.transaction(async (manager) => {
      const cursor = await this.lockCursor(manager, input.network, input.accountAddress);
      if (!cursor?.lastFinalizedLt) throw new ConflictException("Jetton cursor cannot be rewound");
      if (input.toLt !== null && BigInt(input.toLt) >= BigInt(cursor.lastFinalizedLt)) {
        throw new ConflictException("Jetton cursor target must precede current cursor");
      }
      if (input.toLt !== null) {
        const known = await manager.getRepository(TonJettonChainEvent).findOne({ where: {
          network: input.network, accountAddress: input.accountAddress,
          transactionLt: input.toLt, transactionHash: input.toTransactionHash!,
          masterchainSeqno: input.toMasterchainSeqno!,
        } });
        if (!known) throw new ConflictException("Jetton rewind target lacks immutable event evidence");
      }
      const targetKey = `${input.network}:${input.accountAddress}`;
      return this.createRequest(manager, TonJettonRecoveryKind.CURSOR, targetKey, {
        network: input.network, accountAddress: input.accountAddress,
        toLt: input.toLt, toTransactionHash: input.toTransactionHash,
        toMasterchainSeqno: input.toMasterchainSeqno,
      }, this.cursorStateHash(cursor), input.reasonCode, actor);
    });
  }

  async requestRequeue(eventId: string, reasonCode: string, actor: TonJettonRecoveryActor) {
    this.assertActor(actor);
    if (!UUID.test(eventId) || !REASON.test(reasonCode)) throw new BadRequestException("Invalid Jetton requeue request");
    return this.dataSource.transaction(async (manager) => {
      const application = await this.lockApplication(manager, eventId);
      if (!application || application.status !== TonJettonEventApplicationStatus.MANUAL_REVIEW) {
        throw new ConflictException("Jetton event is not in manual review");
      }
      return this.createRequest(manager, TonJettonRecoveryKind.REQUEUE, eventId, { eventId },
        this.applicationStateHash(application), reasonCode, actor);
    });
  }

  async approveCursorRewind(requestId: string, actor: TonJettonRecoveryActor) {
    this.assertActor(actor);
    const snapshot = await this.findRequest(requestId, TonJettonRecoveryKind.CURSOR);
    const target = snapshot.target as unknown as TonJettonCursorRewindTarget;
    return this.dataSource.transaction(async (manager) => {
      const cursor = await this.lockCursor(manager, target.network, target.accountAddress);
      if (!cursor) throw new ConflictException("Jetton cursor disappeared");
      const request = await this.lockRequest(manager, requestId);
      this.assertApproval(request, snapshot, TonJettonRecoveryKind.CURSOR, actor);
      if (this.cursorStateHash(cursor) !== request.expectedStateHash) {
        throw new ConflictException("Jetton cursor changed after recovery was requested");
      }
      if (!cursor.lastFinalizedLt || (target.toLt !== null && BigInt(target.toLt) >= BigInt(cursor.lastFinalizedLt))) {
        throw new ConflictException("Jetton rewind target is no longer valid");
      }
      const checkpointRepo = manager.getRepository(TonJettonIngestionCursorCheckpoint);
      await checkpointRepo.save(checkpointRepo.create({
        cursorId: cursor.id, kind: TonJettonCursorCheckpointKind.RECOVERY,
        previousLt: cursor.lastFinalizedLt, previousHash: cursor.lastFinalizedTxHash,
        previousMcSeqno: cursor.lastFinalizedMcSeqno,
        nextLt: target.toLt, nextHash: target.toTransactionHash,
        nextMcSeqno: target.toMasterchainSeqno,
        reasonCode: request.reasonCode, actorId: actor.id,
      }));
      cursor.lastFinalizedLt = target.toLt;
      cursor.lastFinalizedTxHash = target.toTransactionHash;
      cursor.lastFinalizedMcSeqno = target.toMasterchainSeqno;
      cursor.lastScannedAt = new Date();
      await manager.getRepository(TonJettonIngestionCursor).save(cursor);
      this.markExecuted(request, actor);
      await manager.getRepository(TonJettonRecoveryRequest).save(request);
      await this.writeAudit(manager, request, actor, "TON_JETTON_CURSOR_REWOUND");
      return { requestId, status: "executed" as const, cursor };
    });
  }

  async approveRequeue(requestId: string, actor: TonJettonRecoveryActor) {
    this.assertActor(actor);
    const snapshot = await this.findRequest(requestId, TonJettonRecoveryKind.REQUEUE);
    const eventId = snapshot.targetKey;
    return this.dataSource.transaction(async (manager) => {
      const application = await this.lockApplication(manager, eventId);
      if (!application) throw new ConflictException("Jetton application disappeared");
      const request = await this.lockRequest(manager, requestId);
      this.assertApproval(request, snapshot, TonJettonRecoveryKind.REQUEUE, actor);
      if (application.status !== TonJettonEventApplicationStatus.MANUAL_REVIEW ||
          this.applicationStateHash(application) !== request.expectedStateHash) {
        throw new ConflictException("Jetton application changed after recovery was requested");
      }
      const reviewRepo = manager.getRepository(TonJettonApplicationReview);
      await reviewRepo.save(reviewRepo.create({
        eventId, action: TonJettonApplicationReviewAction.REQUEUE,
        previousAttempts: application.attempts, previousError: application.lastError,
        reasonCode: request.reasonCode, actorId: actor.id,
      }));
      application.status = TonJettonEventApplicationStatus.PENDING;
      application.attempts = 0;
      application.lastError = null;
      application.appliedAt = null;
      application.manualReviewAt = null;
      await manager.getRepository(TonJettonEventApplication).save(application);
      this.markExecuted(request, actor);
      await manager.getRepository(TonJettonRecoveryRequest).save(request);
      await this.writeAudit(manager, request, actor, "TON_JETTON_EVENT_REQUEUED");
      return { requestId, eventId, status: "queued" as const, replayRequiresReconciliation: true };
    });
  }

  async cancel(requestId: string, actor: TonJettonRecoveryActor) {
    this.assertActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, requestId);
      if (request.status !== TonJettonRecoveryStatus.PENDING) throw new ConflictException("Jetton recovery request is not pending");
      request.status = TonJettonRecoveryStatus.CANCELLED;
      request.cancelledAt = new Date();
      request.cancelledBy = actor.id;
      await manager.getRepository(TonJettonRecoveryRequest).save(request);
      await this.writeAudit(manager, request, actor, "TON_JETTON_RECOVERY_CANCELLED");
      return { requestId, status: "cancelled" as const };
    });
  }

  private async createRequest(manager: EntityManager, kind: TonJettonRecoveryKind,
    targetKey: string, target: Record<string, unknown>, expectedStateHash: string,
    reasonCode: string, actor: TonJettonRecoveryActor) {
    const repo = manager.getRepository(TonJettonRecoveryRequest);
    const existing = await repo.findOne({ where: { kind, targetKey, status: TonJettonRecoveryStatus.PENDING } });
    if (existing) {
      if (existing.expiresAt.getTime() > Date.now()) throw new ConflictException("Jetton recovery already awaits approval");
      existing.status = TonJettonRecoveryStatus.EXPIRED;
      await repo.save(existing);
      await this.writeAudit(manager, existing, actor, "TON_JETTON_RECOVERY_EXPIRED");
    }
    const expiresAt = new Date(Date.now() + 300_000);
    const intentHash = this.hash({ kind, targetKey, target, expectedStateHash, reasonCode,
      requestedBy: actor.id, requesterJti: actor.jti, requesterSid: actor.sid,
      expiresAt: expiresAt.toISOString() });
    const request = await repo.save(repo.create({ kind, targetKey, target, expectedStateHash,
      reasonCode, requestedBy: actor.id, requesterJti: actor.jti, requesterSid: actor.sid,
      approvedBy: null, approverJti: null, approverSid: null,
      status: TonJettonRecoveryStatus.PENDING, intentHash, expiresAt,
      approvedAt: null, executedAt: null, cancelledAt: null, cancelledBy: null }));
    await this.writeAudit(manager, request, actor, "TON_JETTON_RECOVERY_REQUESTED");
    return { requestId: request.id, status: "pending_second_approval" as const,
      expiresAt: request.expiresAt, approvalsRequired: 2 };
  }

  private async findRequest(id: string, kind: TonJettonRecoveryKind) {
    if (!UUID.test(id)) throw new BadRequestException("Invalid Jetton recovery request ID");
    const request = await this.dataSource.getRepository(TonJettonRecoveryRequest).findOne({ where: { id, kind } });
    if (!request) throw new NotFoundException("Jetton recovery request not found");
    return request;
  }

  private async lockRequest(manager: EntityManager, id: string) {
    let query = manager.getRepository(TonJettonRecoveryRequest).createQueryBuilder("request")
      .where("request.id = :id", { id });
    if (this.dataSource.options.type === "postgres") query = query.setLock("pessimistic_write");
    const request = await query.getOne();
    if (!request) throw new NotFoundException("Jetton recovery request not found");
    return request;
  }

  private async lockCursor(manager: EntityManager, network: TonNetwork, accountAddress: string) {
    let query = manager.getRepository(TonJettonIngestionCursor).createQueryBuilder("cursor")
      .where("cursor.network = :network", { network })
      .andWhere("cursor.accountAddress = :accountAddress", { accountAddress });
    if (this.dataSource.options.type === "postgres") query = query.setLock("pessimistic_write");
    return query.getOne();
  }

  private async lockApplication(manager: EntityManager, eventId: string) {
    let query = manager.getRepository(TonJettonEventApplication).createQueryBuilder("application")
      .where("application.eventId = :eventId", { eventId });
    if (this.dataSource.options.type === "postgres") query = query.setLock("pessimistic_write");
    return query.getOne();
  }

  private assertApproval(request: TonJettonRecoveryRequest, snapshot: TonJettonRecoveryRequest,
    kind: TonJettonRecoveryKind, actor: TonJettonRecoveryActor) {
    if (request.kind !== kind || request.targetKey !== snapshot.targetKey ||
        request.status !== TonJettonRecoveryStatus.PENDING) {
      throw new ConflictException("Jetton recovery request is not pending for this target");
    }
    if (request.expiresAt.getTime() <= Date.now()) throw new ConflictException("Jetton recovery request expired");
    if (request.requestedBy === actor.id || request.requesterSid === actor.sid) {
      throw new ForbiddenException("A different super admin and IdP session must approve Jetton recovery");
    }
    const expected = this.hash({ kind: request.kind, targetKey: request.targetKey,
      target: request.target, expectedStateHash: request.expectedStateHash,
      reasonCode: request.reasonCode, requestedBy: request.requestedBy,
      requesterJti: request.requesterJti, requesterSid: request.requesterSid,
      expiresAt: request.expiresAt.toISOString() });
    if (expected !== request.intentHash) throw new ConflictException("Jetton recovery intent changed");
  }

  private markExecuted(request: TonJettonRecoveryRequest, actor: TonJettonRecoveryActor) {
    const now = new Date();
    request.status = TonJettonRecoveryStatus.EXECUTED;
    request.approvedBy = actor.id;
    request.approverJti = actor.jti;
    request.approverSid = actor.sid;
    request.approvedAt = now;
    request.executedAt = now;
  }

  private assertActor(actor: TonJettonRecoveryActor) {
    if (!UUID.test(actor?.id ?? "") || actor.role !== "super_admin" ||
        !actor.jti || !actor.sid || !actor.scopes?.includes(RECOVERY_SCOPE)) {
      throw new ForbiddenException(`Jetton recovery requires a super admin with ${RECOVERY_SCOPE}`);
    }
  }

  private validateCursorTarget(input: TonJettonCursorRewindTarget) {
    const allNull = input.toLt === null && input.toTransactionHash === null && input.toMasterchainSeqno === null;
    const allPresent = input.toLt !== null && input.toTransactionHash !== null && input.toMasterchainSeqno !== null;
    if (!Object.values(TonNetwork).includes(input.network) || !ADDRESS.test(input.accountAddress) ||
        !REASON.test(input.reasonCode) || (!allNull && !allPresent) ||
        (allPresent && (!/^[1-9]\d{0,19}$/.test(input.toLt!) || BigInt(input.toLt!) > (1n << 64n) - 1n ||
          !HASH.test(input.toTransactionHash!) || !Number.isSafeInteger(input.toMasterchainSeqno) || input.toMasterchainSeqno! < 1))) {
      throw new BadRequestException("Invalid Jetton cursor recovery target");
    }
  }

  private cursorStateHash(cursor: TonJettonIngestionCursor) {
    return this.hash([cursor.id, cursor.network, cursor.accountAddress,
      cursor.lastFinalizedLt, cursor.lastFinalizedTxHash, cursor.lastFinalizedMcSeqno]);
  }

  private applicationStateHash(application: TonJettonEventApplication) {
    return this.hash([application.eventId, application.status, application.attempts,
      application.lastError, application.manualReviewAt?.toISOString() ?? null]);
  }

  private hash(value: unknown) {
    return createHash("sha256").update("TON_JETTON_RECOVERY_V1\0").update(this.canonicalJson(value)).digest("hex");
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
        `${JSON.stringify(key)}:${this.canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private async writeAudit(manager: EntityManager, request: TonJettonRecoveryRequest,
    actor: TonJettonRecoveryActor, action: string) {
    await this.audit.writeRequired({ actorId: actor.id, actorRole: actor.role,
      aggregateType: "ton_jetton_recovery_request", aggregateId: request.id, action,
      details: { kind: request.kind, targetKey: request.targetKey, target: request.target,
        status: request.status, expiresAt: request.expiresAt.toISOString(),
        requestedBy: request.requestedBy, requesterJti: request.requesterJti,
        requesterSid: request.requesterSid, approverJti: request.approverJti,
        approverSid: request.approverSid, reasonCode: request.reasonCode,
        expectedStateHash: request.expectedStateHash, intentHash: request.intentHash }, manager });
  }
}
