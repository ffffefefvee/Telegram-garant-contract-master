import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PolygonReconciliationService } from "./polygon-reconciliation.service";

@Injectable()
export class PolygonReconciliationScheduler {
  private readonly logger = new Logger(PolygonReconciliationScheduler.name);
  private running = false;

  constructor(private readonly reconciliation: PolygonReconciliationService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "polygon.independent.reconciliation" })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const report = await this.reconciliation.runOnce();
      if (report?.mismatched) {
        this.logger.error(`Polygon reconciliation mismatches=${report.mismatched}`);
      }
    } catch (error) {
      this.logger.error("Polygon reconciliation failed", error as Error);
    } finally {
      this.running = false;
    }
  }
}
