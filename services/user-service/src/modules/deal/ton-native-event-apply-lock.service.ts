import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { TonNativeChainEvent } from "./entities/ton-native-chain-event.entity";

export type TonNativeEventLockResult<T> =
  | { status: "acquired"; value: T }
  | { status: "busy" | "already_applied" | "automation_stopped" };

/**
 * Serializes business application of one finalized chain event across all
 * scheduler replicas. PostgreSQL releases the row lock automatically if the
 * process or connection dies, so crash recovery does not depend on a lease.
 */
@Injectable()
export class TonNativeEventApplyLockService {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    eventId: string,
    handler: (event: TonNativeChainEvent, manager: EntityManager) => Promise<T>,
  ): Promise<TonNativeEventLockResult<T>> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const repository = runner.manager.getRepository(TonNativeChainEvent);
      let query = repository
        .createQueryBuilder("event")
        .where("event.id = :eventId", { eventId });
      if (this.dataSource.options.type === "postgres") {
        query = query.setLock("pessimistic_write").setOnLocked("skip_locked");
      }
      const event = await query.getOne();
      if (!event) {
        await runner.rollbackTransaction();
        return { status: "busy" };
      }
      if (event.appliedAt) {
        await runner.commitTransaction();
        return { status: "already_applied" };
      }
      if (event.automationStoppedAt) {
        await runner.commitTransaction();
        return { status: "automation_stopped" };
      }

      const value = await handler(event, runner.manager);
      await runner.commitTransaction();
      return { status: "acquired", value };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
