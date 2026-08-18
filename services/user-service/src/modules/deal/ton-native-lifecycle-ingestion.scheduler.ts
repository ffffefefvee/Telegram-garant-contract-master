import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { TonNativeLifecycleIngestionService } from "./ton-native-lifecycle-ingestion.service";

@Injectable()
export class TonNativeLifecycleIngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(
    TonNativeLifecycleIngestionScheduler.name,
  );
  private running = false;

  constructor(
    private readonly ingestion: TonNativeLifecycleIngestionService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.ingestion.isEnabled()) return;
    try {
      this.registry.deleteCronJob("ton-native-lifecycle.ingest");
    } catch {
      // An absent job is harmless in isolated tests.
    }
    this.logger.log("Native TON lifecycle ingestion is disabled");
  }

  @Cron("5/10 * * * * *", { name: "ton-native-lifecycle.ingest" })
  async tick(): Promise<void> {
    if (this.running || !this.ingestion.isEnabled()) return;
    this.running = true;
    try {
      await this.ingestion.runOnce();
    } catch (err) {
      this.logger.error(
        `Native TON lifecycle ingestion failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
