import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';
import type { Message } from 'telegraf/types';
import { AntiScamService, ScamTarget } from '../anti-scam/anti-scam.service';
import { AntiScamPublisherService } from '../anti-scam/anti-scam-publisher.service';
import { UserService } from '../user/user.service';
import { I18nService } from '../i18n/i18n.service';
import { User } from '../user/entities/user.entity';
import { withInlineKeyboard } from './telegram-reply.util';
import { persistChatSession } from './telegram-session.store';

/** Signed 32-bit request id for the "select user" keyboard button. */
const REQUEST_USERS_ID = 7001;

interface AntiScamSession {
  step: 'awaitingQuery' | 'awaitingReason' | 'awaitingScreens';
  targetTelegramId?: number;
  targetUsername?: string | null;
  targetDisplayName?: string | null;
  reason?: string;
  screenshotFileIds?: string[];
}

type BotCtx = Context & {
  session?: Record<string, unknown> & { antiScam?: AntiScamSession };
  state: { user?: User };
};

/**
 * Bot UX for the anti-scam feature: check any account (via "select user" button
 * or by pasted id/@username), see the scammer verdict, and file a complaint with
 * mandatory screenshots — all in the same flow.
 */
@Injectable()
export class TelegramAntiScamHandler {
  private readonly logger = new Logger(TelegramAntiScamHandler.name);

  constructor(
    private readonly antiScamService: AntiScamService,
    private readonly publisher: AntiScamPublisherService,
    private readonly userService: UserService,
    private readonly i18nService: I18nService,
  ) {}

  registerHandlers(bot: Telegraf<BotCtx>): void {
    // Entry: "check user" — offer the native user picker + free-text option.
    bot.command('check', async (ctx) => {
      const lang = await this.lang(ctx.state.user);
      await this.startCheck(ctx, lang);
    });

    // Native "select user" result (service message).
    bot.on('message', async (ctx, next) => {
      const msg = ctx.message as Message.UsersSharedMessage | undefined;
      if (!msg || !('users_shared' in msg) || !msg.users_shared) {
        return next();
      }
      if (msg.users_shared.request_id !== REQUEST_USERS_ID) {
        return next();
      }
      const [telegramId] = msg.users_shared.user_ids;
      if (telegramId == null) {
        return next();
      }
      await this.handleTargetSelected(ctx, Number(telegramId));
    });

    // Report button under a verdict card.
    bot.action(/^antiscam_report_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await this.startComplaint(ctx, Number(ctx.match[1]));
    });

    bot.action('antiscam_submit', async (ctx) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await this.submitComplaint(ctx);
    });

    bot.action('antiscam_cancel', async (ctx) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await this.cancel(ctx);
    });

    // Moderation buttons (posted into the moderation chat). Gated by role.
    bot.action(/^antiscam_confirm_([0-9a-fA-F-]{36})$/, async (ctx) => {
      await this.moderate(ctx, ctx.match[1], 'confirm');
    });
    bot.action(/^antiscam_reject_([0-9a-fA-F-]{36})$/, async (ctx) => {
      await this.moderate(ctx, ctx.match[1], 'reject');
    });

    // Screenshots for an in-progress complaint.
    bot.on('photo', async (ctx, next) => {
      const session = ctx.session?.antiScam;
      if (session?.step !== 'awaitingScreens') {
        return next();
      }
      await this.collectScreenshot(ctx);
    });

    // Free-text: either the id/@username query, or the complaint reason.
    bot.on('text', async (ctx, next) => {
      const session = ctx.session?.antiScam;
      const text = ctx.message?.text?.trim();
      if (!session || !text || text.startsWith('/')) {
        return next();
      }

      if (session.step === 'awaitingQuery') {
        return this.handleQueryText(ctx, text);
      }
      if (session.step === 'awaitingReason') {
        return this.handleReasonText(ctx, text);
      }
      return next();
    });
  }

  /** Public entry used by the Reply-keyboard menu button. */
  async startCheck(ctx: BotCtx, lang: string): Promise<void> {
    const t = this.i18nService.t(lang);
    this.setSession(ctx, { step: 'awaitingQuery' });

    const keyboard = Markup.keyboard([
      [Markup.button.userRequest(t('antiscam.select_user_button'), REQUEST_USERS_ID)],
    ])
      .oneTime()
      .resize();

    await ctx.reply(t('antiscam.check_prompt'), {
      reply_markup: keyboard.reply_markup,
    });
  }

  private async handleQueryText(ctx: BotCtx, text: string): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const target = await this.resolveQuery(text);
    if (!target) {
      await ctx.reply(this.i18nService.t(lang)('antiscam.not_resolved'));
      return;
    }
    await this.renderVerdict(ctx, target, lang);
  }

  private async handleTargetSelected(ctx: BotCtx, telegramId: number): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const known = await this.userService.findByTelegramId(telegramId).catch(() => null);
    const target: ScamTarget = {
      telegramId,
      username: known?.telegramUsername ?? null,
      displayName: this.displayNameOf(known),
    };
    await this.renderVerdict(ctx, target, lang);
  }

  private async renderVerdict(ctx: BotCtx, target: ScamTarget, lang: string): Promise<void> {
    const t = this.i18nService.t(lang);
    const verdict = await this.antiScamService.checkAccount(target);

    const handle = target.username ? `@${target.username}` : `ID ${target.telegramId ?? '—'}`;
    let text: string;
    const buttons: (
      | ReturnType<typeof Markup.button.callback>
      | ReturnType<typeof Markup.button.url>
    )[][] = [];

    if (verdict.kind === 'scammer') {
      text = `🚨 <b>${t('antiscam.verdict_scammer')}</b>\n${handle}`;
      if (verdict.dbChannelLink) {
        buttons.push([Markup.button.url(t('antiscam.open_db'), verdict.dbChannelLink)]);
      }
    } else if (verdict.kind === 'reported') {
      text = `⚠️ <b>${t('antiscam.verdict_reported')}</b>\n${handle}`;
    } else {
      text = `✅ <b>${t('antiscam.verdict_clean')}</b>\n${handle}`;
    }

    if (target.telegramId != null) {
      buttons.push([
        Markup.button.callback(t('antiscam.report_button'), `antiscam_report_${target.telegramId}`),
      ]);
      // Cache identity hints so the complaint flow can reuse them.
      this.setSession(ctx, {
        step: 'awaitingQuery',
        targetTelegramId: Number(target.telegramId),
        targetUsername: target.username ?? null,
        targetDisplayName: target.displayName ?? null,
      });
    }

    await ctx.reply(text, withInlineKeyboard(Markup.inlineKeyboard(buttons), { parse_mode: 'HTML' }));
  }

  private async startComplaint(ctx: BotCtx, telegramId: number): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const prev = ctx.session?.antiScam;
    this.setSession(ctx, {
      step: 'awaitingReason',
      targetTelegramId: telegramId,
      targetUsername: prev?.targetTelegramId === telegramId ? prev?.targetUsername : null,
      targetDisplayName: prev?.targetTelegramId === telegramId ? prev?.targetDisplayName : null,
      screenshotFileIds: [],
    });
    await ctx.reply(this.i18nService.t(lang)('antiscam.ask_reason'));
  }

  private async handleReasonText(ctx: BotCtx, text: string): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const session = ctx.session!.antiScam!;
    session.reason = text;
    session.step = 'awaitingScreens';
    session.screenshotFileIds = session.screenshotFileIds ?? [];
    this.setSession(ctx, session);
    await ctx.reply(this.i18nService.t(lang)('antiscam.ask_screenshots'));
  }

  private async collectScreenshot(ctx: BotCtx): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const t = this.i18nService.t(lang);
    const session = ctx.session!.antiScam!;
    session.screenshotFileIds = session.screenshotFileIds ?? [];

    const photo = (ctx.message as Message.PhotoMessage).photo;
    const best = photo?.[photo.length - 1];
    if (best?.file_id) {
      session.screenshotFileIds.push(best.file_id);
      this.setSession(ctx, session);
    }

    const count = session.screenshotFileIds.length;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(t('antiscam.submit_button'), 'antiscam_submit')],
      [Markup.button.callback(t('common.cancel'), 'antiscam_cancel')],
    ]);
    await ctx.reply(
      t('antiscam.screenshot_saved').replace('{count}', String(count)),
      withInlineKeyboard(keyboard),
    );
  }

  private async submitComplaint(ctx: BotCtx): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const t = this.i18nService.t(lang);
    const session = ctx.session?.antiScam;
    const user = ctx.state.user;

    if (!session?.targetTelegramId || !session.reason || !user) {
      await ctx.reply(t('antiscam.submit_incomplete'));
      return;
    }

    try {
      const { autoConfirmed, isNewRecord, record } = await this.antiScamService.fileReport({
        reporterUserId: user.id,
        reporterTelegramId: user.telegramId ?? null,
        target: {
          telegramId: session.targetTelegramId,
          username: session.targetUsername ?? null,
          displayName: session.targetDisplayName ?? null,
        },
        reason: session.reason,
        screenshotFileIds: session.screenshotFileIds ?? [],
      });

      // Send a moderation card the first time an account is reported (manual
      // path, variant 1). Auto-confirmed records already went public.
      if (isNewRecord && !autoConfirmed) {
        await this.publisher.postModerationCard(record.id);
      }

      await this.clearSession(ctx);
      await ctx.reply(
        autoConfirmed ? t('antiscam.submit_confirmed') : t('antiscam.submit_ok'),
      );
    } catch (error) {
      const message = (error as Error).message || t('errors.generic');
      this.logger.warn(`Complaint rejected: ${message}`);
      await ctx.reply(`⚠️ ${message}`);
    }
  }

  private async cancel(ctx: BotCtx): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    await this.clearSession(ctx);
    await ctx.reply(this.i18nService.t(lang)('antiscam.cancelled'));
  }

  private async moderate(
    ctx: BotCtx,
    recordId: string,
    action: 'confirm' | 'reject',
  ): Promise<void> {
    const lang = await this.lang(ctx.state.user);
    const t = this.i18nService.t(lang);
    const user = ctx.state.user;

    if (!user || !(await this.antiScamService.isModerator(user.id))) {
      await ctx.answerCbQuery(t('antiscam.mod_forbidden')).catch(() => undefined);
      return;
    }

    try {
      if (action === 'confirm') {
        await this.antiScamService.confirmScammer(recordId, user.id);
      } else {
        await this.antiScamService.rejectScammer(recordId, user.id);
      }
      const resultText = action === 'confirm' ? t('antiscam.mod_confirmed') : t('antiscam.mod_rejected');
      await ctx.answerCbQuery(resultText).catch(() => undefined);
      // Strip the buttons so the card can't be actioned twice.
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {
        // ignore — message may be too old to edit
      }
      await ctx.reply(resultText);
    } catch (error) {
      this.logger.warn(`Moderation failed: ${(error as Error).message}`);
      await ctx.answerCbQuery(t('errors.generic')).catch(() => undefined);
    }
  }

  /**
   * Resolve a pasted query to a target. Accepts numeric Telegram id or
   * @username (resolved via getChat when the account is reachable).
   */
  private async resolveQuery(query: string): Promise<ScamTarget | null> {
    const numeric = query.replace(/[^\d]/g, '');
    if (/^\d{5,}$/.test(numeric) && numeric === query.replace(/^\s+|\s+$/g, '')) {
      const known = await this.userService.findByTelegramId(Number(numeric)).catch(() => null);
      return {
        telegramId: Number(numeric),
        username: known?.telegramUsername ?? null,
        displayName: this.displayNameOf(known),
      };
    }

    const username = query.replace(/^@/, '').trim();
    if (/^[A-Za-z0-9_]{4,32}$/.test(username)) {
      // First, try our own DB (no network, always works).
      const known = await this.userService
        .searchByQuery(username, 1)
        .then((r) => r.users[0])
        .catch(() => null);
      if (known?.telegramId != null) {
        return {
          telegramId: Number(known.telegramId),
          username: known.telegramUsername ?? username,
          displayName: known.telegramFirstName ?? null,
        };
      }
      // Username without a known numeric id: still allow a check-by-username.
      return { telegramId: null, username, displayName: null };
    }

    return null;
  }

  private displayNameOf(user: User | null): string | null {
    if (!user) return null;
    const parts = [user.telegramFirstName, user.telegramLastName].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  }

  private setSession(ctx: BotCtx, session: AntiScamSession): void {
    if (!ctx.session) ctx.session = {};
    ctx.session.antiScam = session;
  }

  private async clearSession(ctx: BotCtx): Promise<void> {
    if (ctx.session?.antiScam) {
      delete ctx.session.antiScam;
    }
    if (ctx.chat?.id) {
      await persistChatSession(ctx.chat.id);
    }
  }

  private async lang(user?: User): Promise<string> {
    if (!user) return 'ru';
    try {
      return await this.userService.getUserLanguage(user.id);
    } catch {
      return user.telegramLanguageCode?.slice(0, 2) || 'ru';
    }
  }
}
