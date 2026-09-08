import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PolygonLifecycleIngestionService } from "./polygon-lifecycle-ingestion.service";

@Injectable()
export class PolygonLifecycleIngestionScheduler {
  private readonly logger = new Logger(PolygonLifecycleIngestionScheduler.name);
  private running = false;

  constructor(private readonly ingestion: PolygonLifecycleIngestionService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "polygon.lifecycle.ingestion" })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ingestion.runOnce();
    } catch (error) {
      this.logger.error("Polygon lifecycle ingestion failed", error as Error);
    } finally {
      this.running = false;
    }
  }
}
