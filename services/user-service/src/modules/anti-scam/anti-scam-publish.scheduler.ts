import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AntiScamConfig } from './anti-scam.config';
import { AntiScamService } from './anti-scam.service';
import { AntiScamPublisherService } from './anti-scam-publisher.service';

/**
 * Periodically publishes accumulated confirmed scammers to the public DB channel
 * once enough of them have piled up (batch size from config). Mirrors the
 * @Cron scheduler pattern used across notifications/ops.
 */
@Injectable()
export class AntiScamPublishScheduler {
  private readonly logger = new Logger(AntiScamPublishScheduler.name);
  private readonly enabled: boolean;

  constructor(
    private readonly antiScamService: AntiScamService,
    private readonly publisher: AntiScamPublisherService,
    private readonly antiScamConfig: AntiScamConfig,
    config: ConfigService,
  ) {
    this.enabled = config.get('ANTISCAM_PUBLISH_ENABLED', 'true') !== 'false';
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'anti-scam.publish_batch' })
  async publishBatch(): Promise<void> {
    if (!this.enabled) return;
    if (!this.antiScamConfig.dbChannelId) return;

    const batchSize = this.antiScamConfig.publishBatchSize;
    const pending = await this.antiScamService.findConfirmedUnpublished(batchSize);

    // Wait until a full batch accumulates to keep the channel tidy.
    if (pending.length < batchSize) {
      return;
    }

    const published = await this.publisher.publishConfirmedBatch(pending);
    if (published > 0) {
      this.logger.log(`Published a batch of ${published} scammers to the DB channel`);
    }
  }
}
