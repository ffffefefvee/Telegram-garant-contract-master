import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { TonNativeFundingIngestionService } from "./ton-native-funding-ingestion.service";

@Injectable()
export class TonNativeFundingIngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(TonNativeFundingIngestionScheduler.name);
  private running = false;

  constructor(
    private readonly ingestion: TonNativeFundingIngestionService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.ingestion.isEnabled()) return;
    try {
      this.registry.deleteCronJob("ton-native-funding.ingest");
    } catch {
      // Registration order differs in unit tests; an absent job is harmless.
    }
    this.logger.log("Native TON funding ingestion is disabled");
  }

  @Cron("*/10 * * * * *", { name: "ton-native-funding.ingest" })
  async tick(): Promise<void> {
    if (this.running || !this.ingestion.isEnabled()) return;
    this.running = true;
    try {
      await this.ingestion.runOnce();
    } catch (err) {
      this.logger.error(
        `Native TON funding ingestion failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
