import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { InputMediaPhoto } from 'telegraf/types';
import { AntiScamConfig } from './anti-scam.config';
import { ScammerRecord } from './entities/scammer-record.entity';
import { ScamReport } from './entities/scam-report.entity';
import { ScamReportStatus, ScammerStatus } from './enums/anti-scam.enum';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';
import { Markup } from 'telegraf';

/**
 * Posts scammer data to the two public channels:
 *  - evidence channel: one message per scammer (complaint text + screenshots);
 *  - DB channel: batched aggregated list "scammer — @user, tg-link, evidence-link".
 *
 * All Telegram I/O is best-effort and never throws into business logic: a failed
 * post leaves the record in its current state so a later run can retry.
 */
@Injectable()
export class AntiScamPublisherService {
  private readonly logger = new Logger(AntiScamPublisherService.name);

  constructor(
    @InjectRepository(ScammerRecord)
    private readonly recordRepo: Repository<ScammerRecord>,
    @InjectRepository(ScamReport)
    private readonly reportRepo: Repository<ScamReport>,
    private readonly antiScamConfig: AntiScamConfig,
    @Inject(forwardRef(() => TelegramBotService))
    private readonly botService: TelegramBotService,
  ) {}

  /**
   * Publish the evidence post for a freshly-confirmed scammer into the evidence
   * channel. Idempotent: skips if already posted. Returns the evidence message
   * deep-link (or null when the channel is not configured / posting failed).
   */
  async postEvidenceForRecord(recordId: string): Promise<string | null> {
    const channelId = this.antiScamConfig.evidenceChannelId;
    if (!channelId) {
      this.logger.warn('Evidence channel not configured; skipping evidence post');
      return null;
    }

    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) {
      return null;
    }
    if (record.evidenceChannelMessageId) {
      return this.buildEvidenceLink(record.evidenceChannelMessageId);
    }

    const bot = this.botService.getBot();
    if (!bot) {
      this.logger.warn('Bot not initialized; cannot post evidence');
      return null;
    }

    const reports = await this.reportRepo.find({
      where: {
        scammerRecordId: record.id,
        status: In([ScamReportStatus.PENDING, ScamReportStatus.APPROVED]),
      },
      order: { createdAt: 'ASC' },
    });

    const caption = this.buildEvidenceCaption(record, reports);
    const screenshots = this.collectScreenshots(reports, this.antiScamConfig.maxScreenshots);

    try {
      let messageId: number | undefined;

      if (screenshots.length > 0) {
        const media: InputMediaPhoto[] = screenshots.map((fileId, index) => ({
          type: 'photo',
          media: fileId,
          ...(index === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
        }));
        const sent = await bot.telegram.sendMediaGroup(channelId, media);
        messageId = sent[0]?.message_id;
      } else {
        const sent = await bot.telegram.sendMessage(channelId, caption, {
          parse_mode: 'HTML',
        });
        messageId = sent.message_id;
      }

      if (messageId !== undefined) {
        record.evidenceChannelMessageId = messageId;
        await this.recordRepo.save(record);
        return this.buildEvidenceLink(messageId);
      }
    } catch (error) {
      this.logger.error(`Failed to post evidence for record ${record.id}`, error);
    }
    return null;
  }

  /**
   * Publish a batch of confirmed-but-unpublished scammers into the DB channel as
   * a single aggregated message, then mark them PUBLISHED.
   * Returns the number of scammers published.
   */
  async publishConfirmedBatch(records: ScammerRecord[]): Promise<number> {
    const channelId = this.antiScamConfig.dbChannelId;
    if (!channelId) {
      this.logger.warn('DB channel not configured; skipping batch publish');
      return 0;
    }
    if (records.length === 0) {
      return 0;
    }

    const bot = this.botService.getBot();
    if (!bot) {
      this.logger.warn('Bot not initialized; cannot publish batch');
      return 0;
    }

    const text = this.buildBatchMessage(records);

    try {
      const sent = await bot.telegram.sendMessage(channelId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });

      const now = new Date();
      for (const record of records) {
        record.status = ScammerStatus.PUBLISHED;
        record.publishedAt = now;
        record.dbChannelMessageId = sent.message_id;
      }
      await this.recordRepo.save(records);
      this.logger.log(`Published ${records.length} scammers to DB channel`);
      return records.length;
    } catch (error) {
      this.logger.error('Failed to publish scammer batch to DB channel', error);
      return 0;
    }
  }

  /**
   * Post a moderation card (verdict + confirm/reject buttons) into the private
   * moderation chat for a newly-reported account. No-op when the chat isn't
   * configured. Best-effort — never throws into business logic.
   */
  async postModerationCard(recordId: string): Promise<void> {
    const chatId = this.antiScamConfig.moderationChatId;
    if (!chatId) {
      return;
    }
    const bot = this.botService.getBot();
    if (!bot) {
      return;
    }
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) {
      return;
    }

    const handle = record.targetUsername ? `@${record.targetUsername}` : '—';
    const tgLink = this.buildUserLink(record.targetTelegramId);
    const text =
      `🕵️ <b>Новая жалоба на модерацию</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `👤 ${this.escapeHtml(record.targetDisplayName ?? handle)}\n` +
      `🔗 ${handle}\n` +
      `🆔 <a href="${tgLink}">Профиль</a>\n` +
      `📩 Жалоб: <b>${record.distinctReporterCount}</b>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Скамер', `antiscam_confirm_${record.id}`),
        Markup.button.callback('❌ Отклонить', `antiscam_reject_${record.id}`),
      ],
    ]);

    try {
      await bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      this.logger.error(`Failed to post moderation card for ${record.id}`, error);
    }
  }

  private collectScreenshots(reports: ScamReport[], max: number): string[] {
    const fileIds: string[] = [];
    for (const report of reports) {
      for (const fileId of report.screenshotFileIds ?? []) {
        if (fileIds.length >= max) {
          return fileIds;
        }
        fileIds.push(fileId);
      }
    }
    return fileIds;
  }

  private buildEvidenceCaption(record: ScammerRecord, reports: ScamReport[]): string {
    const handle = record.targetUsername ? `@${record.targetUsername}` : '—';
    const tgLink = this.buildUserLink(record.targetTelegramId);
    const reasons = reports
      .map((r, i) => `${i + 1}. ${this.escapeHtml(r.reason)}`)
      .join('\n');

    return (
      `🚨 <b>СКАМЕР</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `👤 ${this.escapeHtml(record.targetDisplayName ?? handle)}\n` +
      `🔗 Юзернейм: ${handle}\n` +
      `🆔 <a href="${tgLink}">Профиль в Telegram</a>\n` +
      `📩 Жалоб: <b>${record.distinctReporterCount}</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📝 <b>Причины жалоб:</b>\n${reasons || '—'}`
    );
  }

  private buildBatchMessage(records: ScammerRecord[]): string {
    const lines = records.map((record) => {
      const handle = record.targetUsername ? `@${record.targetUsername}` : '—';
      const tgLink = this.buildUserLink(record.targetTelegramId);
      const evidence = record.evidenceChannelMessageId
        ? ` — <a href="${this.buildEvidenceLink(record.evidenceChannelMessageId)}">доказательства</a>`
        : '';
      return `• Скамер — ${handle} — <a href="${tgLink}">tg</a>${evidence}`;
    });

    return (
      `🛑 <b>Новые скамеры</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      lines.join('\n')
    );
  }

  /** tg://user?id= is the most reliable numeric-id deep-link. */
  private buildUserLink(telegramId: number): string {
    return `tg://user?id=${telegramId}`;
  }

  private buildEvidenceLink(messageId: number): string {
    const username = this.antiScamConfig.evidenceChannelUsername;
    if (username) {
      return `https://t.me/${username.replace('@', '')}/${messageId}`;
    }
    // Private channel fallback: numeric -100xxxx form.
    const raw = this.antiScamConfig.evidenceChannelId ?? '';
    const normalized = raw.replace('-100', '');
    return `https://t.me/c/${normalized}/${messageId}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
