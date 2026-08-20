import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLogService } from "../ops/audit-log.service";
import {
  TonNativeEscrowWatch,
  TonNativeEscrowWatchStatus,
} from "./entities/ton-native-escrow-watch.entity";
import { TonNativeFundingIngestionService } from "./ton-native-funding-ingestion.service";
import { TonNativeLifecycleIngestionService } from "./ton-native-lifecycle-ingestion.service";
import { TonNativeRecoveryActor } from "./ton-native-recovery.service";

/** A bounded targeted scan that never rewrites or advances a cursor by fiat. */
@Injectable()
export class TonNativeBackfillService {
  constructor(
    @InjectRepository(TonNativeEscrowWatch)
    private readonly watchRepo: Repository<TonNativeEscrowWatch>,
    private readonly funding: TonNativeFundingIngestionService,
    private readonly lifecycle: TonNativeLifecycleIngestionService,
    private readonly audit: AuditLogService,
  ) {}

  async run(
    watchId: string,
    actor: TonNativeRecoveryActor,
    input: { reason: string; maxPages: number },
  ) {
    if (!actor.id || actor.role !== "super_admin") {
      throw new BadRequestException("Super-admin backfill actor is required");
    }
    const reason = input.reason?.trim();
    if (!reason || reason.length < 20 || reason.length > 1000) {
      throw new BadRequestException(
        "Backfill reason must be 20-1000 characters",
      );
    }
    if (
      !Number.isInteger(input.maxPages) ||
      input.maxPages < 1 ||
      input.maxPages > 10
    ) {
      throw new BadRequestException("Backfill maxPages must be 1-10");
    }
    const watch = await this.watchRepo.findOne({ where: { id: watchId } });
    if (!watch) throw new NotFoundException("Native TON watch not found");
    if (
      [
        TonNativeEscrowWatchStatus.MANUAL_REVIEW,
        TonNativeEscrowWatchStatus.TERMINAL,
      ].includes(watch.status)
    ) {
      throw new ConflictException(
        "Stopped or terminal watches cannot be backfilled automatically",
      );
    }

    await this.audit.writeRequired({
      actorId: actor.id,
      actorRole: actor.role,
      aggregateType: "ton_native_escrow_watch",
      aggregateId: watch.id,
      action: "TON_NATIVE_BOUNDED_BACKFILL_REQUESTED",
      details: {
        dealId: watch.dealId,
        preparationId: watch.preparationId,
        network: watch.network,
        accountAddress: watch.accountAddress,
        startingAfterLt: watch.lastFinalizedLt,
        maxPages: input.maxPages,
        reason,
        cursorRewrite: false,
      },
    });

    const report =
      watch.status === TonNativeEscrowWatchStatus.WATCHING
        ? await this.funding.backfillWatch(watch.id, input.maxPages)
        : await this.lifecycle.backfillWatch(watch.id, input.maxPages);

    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      aggregateType: "ton_native_escrow_watch",
      aggregateId: watch.id,
      action: "TON_NATIVE_BOUNDED_BACKFILL_COMPLETED",
      details: { report },
    });
    return {
      watchId: watch.id,
      cursorRewrite: false,
      report,
    };
  }
}
