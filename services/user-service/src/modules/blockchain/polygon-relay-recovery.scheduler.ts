import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PolygonRelayNonceService } from "./polygon-relay-nonce.service";

@Injectable()
export class PolygonRelayRecoveryScheduler {
  private readonly logger = new Logger(PolygonRelayRecoveryScheduler.name);
  private running = false;

  constructor(private readonly relayNonce: PolygonRelayNonceService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "polygon.relay.recovery" })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const recovered = await this.relayNonce.recoverStuck();
      if (recovered > 0) this.logger.warn(`Recovered ${recovered} Polygon relay transaction(s)`);
    } catch (error) {
      this.logger.error("Polygon relay recovery failed", error as Error);
    } finally {
      this.running = false;
    }
  }
}
