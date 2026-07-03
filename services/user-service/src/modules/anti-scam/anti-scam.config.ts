import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Centralised configuration for the anti-scam feature. All values are
 * overridable via env so thresholds and channel wiring can be tuned without a
 * redeploy of logic.
 */
@Injectable()
export class AntiScamConfig {
  constructor(private readonly config: ConfigService) {}

  /**
   * Number of DISTINCT reporters required to auto-flag an account as scammer
   * (hybrid model, variant 2). Manual moderation can confirm earlier.
   */
  get autoConfirmReporterThreshold(): number {
    return this.getInt('ANTISCAM_AUTO_CONFIRM_THRESHOLD', 3);
  }

  /**
   * How many CONFIRMED-but-unpublished scammers must accumulate before the
   * scheduler posts a new batch into the public scam DB channel.
   */
  get publishBatchSize(): number {
    return this.getInt('ANTISCAM_PUBLISH_BATCH_SIZE', 10);
  }

  /** Minimum number of proof screenshots per complaint (proofs mandatory). */
  get minScreenshots(): number {
    return this.getInt('ANTISCAM_MIN_SCREENSHOTS', 1);
  }

  /** Maximum number of proof screenshots accepted per complaint. */
  get maxScreenshots(): number {
    return this.getInt('ANTISCAM_MAX_SCREENSHOTS', 10);
  }

  /** Public channel where the aggregated scammer DB is posted. */
  get dbChannelId(): string | null {
    return this.config.get<string>('ANTISCAM_DB_CHANNEL_ID') ?? null;
  }

  /** Public @username of the DB channel, used to build message deep-links. */
  get dbChannelUsername(): string | null {
    return this.config.get<string>('ANTISCAM_DB_CHANNEL_USERNAME') ?? null;
  }

  /** Channel where per-scammer evidence posts (complaint + screenshots) live. */
  get evidenceChannelId(): string | null {
    return this.config.get<string>('ANTISCAM_EVIDENCE_CHANNEL_ID') ?? null;
  }

  /**
   * Private chat/channel where moderation cards (confirm/reject buttons) are
   * posted for each new REPORTED account. Moderators act from here.
   */
  get moderationChatId(): string | null {
    return this.config.get<string>('ANTISCAM_MODERATION_CHAT_ID') ?? null;
  }

  /** Public @username of the evidence channel, for message deep-links. */
  get evidenceChannelUsername(): string | null {
    return this.config.get<string>('ANTISCAM_EVIDENCE_CHANNEL_USERNAME') ?? null;
  }

  private getInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
}
