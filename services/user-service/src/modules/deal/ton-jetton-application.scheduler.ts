import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { TonJettonTransactionalApplicationService } from "./ton-jetton-transactional-application.service";

const DEFAULT_BATCH = 16;
const MAX_BATCH = 64;

/** Default-off bounded driver for SKIP LOCKED application workers. */
@Injectable()
export class TonJettonApplicationScheduler implements OnModuleInit {
  private readonly logger = new Logger(TonJettonApplicationScheduler.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly application: TonJettonTransactionalApplicationService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log("Jetton durable application worker is disabled");
    }
  }

  @Interval(10_000)
  async tick(): Promise<number> {
    if (!this.enabled || this.running) return 0;
    this.running = true;
    try {
      let applied = 0;
      for (let index = 0; index < this.batchSize; index += 1) {
        const result = await this.application.applyNext();
        if (result.status === "idle") break;
        if (result.status === "applied") applied += 1;
        if (
          result.status === "retry_pending" ||
          result.status === "manual_review"
        ) {
          break;
        }
      }
      return applied;
    } catch (error) {
      this.logger.error(
        `Jetton application worker failed: ${safeMessage(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private get enabled(): boolean {
    const value = this.config.get<string | boolean>(
      "TON_JETTON_APPLICATION_WORKER_ENABLED",
      false,
    );
    return value === true || value === "true";
  }

  private get batchSize(): number {
    const value = Number(
      this.config.get<string | number>(
        "TON_JETTON_APPLICATION_WORKER_BATCH",
        DEFAULT_BATCH,
      ),
    );
    return Number.isInteger(value) && value >= 1 && value <= MAX_BATCH
      ? value
      : DEFAULT_BATCH;
  }
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
