import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context, Markup } from 'telegraf';
import { UserService } from '../user/user.service';
import { I18nService } from '../i18n/i18n.service';
import { User } from '../user/entities/user.entity';
import { DealService } from '../deal/deal.service';
import { TelegramDealHandler } from './telegram-deal.handler';
import { buildTelegramClientOptions } from './telegram-client.options';
import { persistChatSession, TelegramSessionStore } from './telegram-session.store';
import { TelegramDealLifecycleHandler } from './telegram-deal-lifecycle.handler';
import { TelegramAntiScamHandler } from './telegram-anti-scam.handler';
import { buildTelegramMiniAppUrl, normalizeHostedMiniAppUrl } from './telegram-mini-app.util';
import { formatTelegramUserDisplayName, withInlineKeyboard } from './telegram-reply.util';
import type { Update } from 'telegraf/types';
import type { TelegramTestCapture } from './telegram-test-inject.types';

export interface TelegramContext extends Context {
  session?: {
    state?: string;
    data?: any;
    dealCreation?: any;
    walletLink?: boolean;
  };
  state: {
    user?: User;
  };
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf<TelegramContext>;
  private readonly isProduction: boolean;
  private botLaunched = false;
  private launchRetryTimer?: ReturnType<typeof setTimeout>;
  private testCaptureActive = false;
  private lastTestCapture: TelegramTestCapture | null = null;
  private miniAppUrlWarningLogged = false;
  private miniAppFallbackWarningLogged = false;

  constructor(
    private configService: ConfigService,
    private userService: UserService,
    private i18nService: I18nService,
    private dealService: DealService,
    private dealHandler: TelegramDealHandler,
    private lifecycleHandler: TelegramDealLifecycleHandler,
    private antiScamHandler: TelegramAntiScamHandler,
    private sessionStore: TelegramSessionStore,
    private moduleRef: ModuleRef,
  ) {
    this.isProduction = this.configService.get('NODE_ENV') === 'production';
    const token = this.configService.get('TELEGRAM_BOT_TOKEN');

    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not provided. Bot will not start.');
      return;
    }

    const telegramOptions = buildTelegramClientOptions(this.configService);
    if (telegramOptions.agent) {
      this.logger.log('Telegram client: using HTTP(S) proxy from environment');
    }
    if (telegramOptions.apiRoot) {
      this.logger.log(`Telegram client: custom API root ${telegramOptions.apiRoot}`);
    }

    this.bot = new Telegraf<TelegramContext>(token, { telegram: telegramOptions });
    this.setupBot();
  }

  async onModuleInit(): Promise<void> {
    if (!this.bot) {
      return;
    }

    const { TelegramCallbackHandler } = await import('./telegram-callback.handler');
    const callbackHandler = this.moduleRef.get(TelegramCallbackHandler, { strict: false });
    callbackHandler.registerHandlers(this.bot);

    void this.connectAndLaunch();
  }

  /** Повторяет подключение к api.telegram.org (VPN/прокси могут появиться позже). */
  private async connectAndLaunch(): Promise<void> {
    if (!this.bot || this.botLaunched) {
      return;
    }

    try {
      const botInfo = await this.bot.telegram.getMe();
      this.logger.log(`Bot initialized: @${botInfo.username}`);

      await this.bot.telegram.setMyCommands([
        { command: 'start', description: 'Запуск бота' },
        { command: 'menu', description: 'Главное меню' },
        { command: 'help', description: 'Справка' },
        { command: 'new_deal', description: 'Новая сделка' },
        { command: 'my_deals', description: 'Мои сделки' },
        { command: 'check', description: 'Проверить пользователя на скам' },
        { command: 'profile', description: 'Профиль' },
        { command: 'language', description: 'Язык' },
        { command: 'settings', description: 'Настройки' },
      ]);

      await this.setupMiniAppMenuButton();

      this.botLaunched = true;
      void this.bot
        .launch({
          dropPendingUpdates: !this.isProduction,
        })
        .then(() => this.logger.log('Bot polling stopped'))
        .catch((launchError) => {
          this.botLaunched = false;
          this.logger.error('Bot polling failed', launchError);
          this.scheduleLaunchRetry();
        });
      this.logger.log('Bot started successfully (long polling)');
    } catch (error: any) {
      const reason = error?.message || String(error);
      this.logger.error(
        `Не удалось подключиться к Telegram API (${reason}). ` +
          'Проверьте интернет/VPN или задайте HTTPS_PROXY в .env. Повтор через 30 с.',
      );
      this.scheduleLaunchRetry();
    }
  }

  private scheduleLaunchRetry(): void {
    if (this.launchRetryTimer || this.botLaunched) {
      return;
    }

    this.launchRetryTimer = setTimeout(() => {
      this.launchRetryTimer = undefined;
      void this.connectAndLaunch();
    }, 30_000);
  }

  async resolveLang(user?: User): Promise<string> {
    if (!user) {
      return 'ru';
    }

    try {
      return await this.userService.getUserLanguage(user.id);
    } catch {
      return user.telegramLanguageCode?.slice(0, 2) || 'ru';
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.launchRetryTimer) {
      clearTimeout(this.launchRetryTimer);
      this.launchRetryTimer = undefined;
    }

    if (this.bot) {
      await this.bot.stop('Bot service destroyed');
      this.logger.log('Bot stopped');
    }
  }

  private setupBot(): void {
    this.setupMiddleware();
    this.setupTestCaptureMiddleware();
    this.setupCommands();
    this.setupReplyKeyboardHears();
    this.setupErrorHandler();

    if (this.bot) {
      // Anti-scam must register first: its text handler intercepts the
      // id/@username check query and complaint reason before the deal
      // handler's numeric/description hears-handlers can swallow them.
      this.antiScamHandler.registerHandlers(this.bot as never);
      this.dealHandler.registerHandlers(this.bot);
      this.lifecycleHandler.registerHandlers(this.bot);
      this.setupFreeTextGuard();
    }
  }

  /**
   * Hears-handlers for Reply keyboard button taps.
   * Reply keyboard sends the button label as a plain text message, so we need
   * to match against every locale's translated text.
   */
  private setupReplyKeyboardHears(): void {
    const langs = ['ru', 'en', 'es'];

    const collect = (key: string) =>
      langs.map((l) => this.i18nService.getTranslator(l)(key)).filter(Boolean);

    // Helper to match regardless of locale
    const matches = (text: string, key: string) =>
      collect(key).some((label) => label === text);

    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message?.text?.trim();
      if (!text || text.startsWith('/')) return next();

      const botSession = (ctx as TelegramContext).session;
      const session = botSession?.dealCreation;
      if (session?.step === 'description' || session?.step === 'amount' || botSession?.walletLink) {
        return next();
      }

      const lang = await this.resolveLang(ctx.state.user);
      const t = this.i18nService.t(lang);

      if (matches(text, 'menu.new_deal')) {
        return this.dealHandler.startDealCreation(ctx as any, lang);
      }
      if (matches(text, 'menu.my_deals')) {
        const { TelegramCallbackHandler } = await import('./telegram-callback.handler');
        const cb = this.moduleRef.get(TelegramCallbackHandler, { strict: false });
        return cb.openDealsList(ctx as any, lang);
      }
      if (matches(text, 'menu.balance')) {
        const { TelegramCallbackHandler } = await import('./telegram-callback.handler');
        const cb = this.moduleRef.get(TelegramCallbackHandler, { strict: false });
        return cb.showBalance(ctx as any, lang);
      }
      if (matches(text, 'menu.profile')) {
        return this.handleProfileCommand(ctx as any, lang);
      }
      if (matches(text, 'menu.check_user')) {
        return this.antiScamHandler.startCheck(ctx as any, lang);
      }
      if (matches(text, 'menu.settings')) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(t('menu.language'), 'settings_language')],
          [Markup.button.callback(t('menu.back_to_menu'), 'menu_back')],
        ]);
        return ctx.reply(t('bot.settings_intro'), withInlineKeyboard(keyboard, { parse_mode: 'HTML' }));
      }
      if (matches(text, 'menu.help')) {
        return ctx.reply(t('bot.help_message'), { parse_mode: 'HTML' });
      }
      if (matches(text, 'menu.support')) {
        const handle = t('common.support_handle') || '@support';
        return ctx.reply(
          `${t('menu.support')}: ${handle}`,
          withInlineKeyboard(
            Markup.inlineKeyboard([
              [Markup.button.url(t('menu.support'), `https://t.me/${handle.replace('@', '')}`)],
            ]),
          ),
        );
      }

      return next();
    });
  }

  /** PRODUCT_PLAN §8.3 — произвольный текст → кнопки. */
  private setupFreeTextGuard(): void {
    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text?.trim();
      if (!text || text.startsWith('/')) {
        return next();
      }

      const botSession = (ctx as TelegramContext).session;
      const session = botSession?.dealCreation;
      if (session?.step === 'description' || session?.step === 'amount' || botSession?.walletLink) {
        return next();
      }

      const lang = await this.resolveLang(ctx.state.user);
      await ctx.reply(
        this.i18nService.t(lang)('bot.use_buttons'),
        { reply_markup: this.getMainMenuReplyKeyboard(lang).reply_markup },
      );
    });
  }

  private setupTestCaptureMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      if (!this.testCaptureActive) {
        return next();
      }

      const recordCapture = (text: unknown, extra?: Record<string, unknown>, messageId?: number) => {
        const markup = extra?.reply_markup ?? (extra as { reply_markup?: unknown })?.reply_markup;
        this.lastTestCapture = {
          text: typeof text === 'string' ? text : String(text ?? ''),
          chatId: ctx.chat?.id,
          messageId: messageId ?? this.lastTestCapture?.messageId,
          replyMarkup: markup,
        };
      };

      const origReply = ctx.reply.bind(ctx);
      ctx.reply = async (text: any, ...args: any[]) => {
        const extra = args[0] as Record<string, unknown> | undefined;
        const mid = ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id;
        recordCapture(text, extra, mid);
        try {
          return await origReply(text, ...args);
        } catch (error) {
          this.logger.warn('Inject capture: ctx.reply failed (Telegram API)', error);
          return undefined as never;
        }
      };

      if (typeof ctx.editMessageText === 'function') {
        const origEdit = ctx.editMessageText.bind(ctx);
        ctx.editMessageText = async (text: any, ...args: any[]) => {
          const extra = args.find(
            (a) => a && typeof a === 'object' && ('reply_markup' in a || 'parse_mode' in a),
          ) as Record<string, unknown> | undefined;
          const mid = ctx.callbackQuery?.message?.message_id;
          recordCapture(text, extra, mid);
          try {
            return await origEdit(text, ...args);
          } catch (error) {
            this.logger.warn('Inject capture: editMessageText failed (Telegram API)', error);
            return undefined as never;
          }
        };
      }

      await next();
    });
  }

  private setupMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.is_bot) {
        return;
      }

      const chatId = ctx.chat?.id;
      if (chatId !== undefined) {
        ctx.session = (await this.sessionStore.get(chatId)) as TelegramContext['session'];
      }

      ctx.state = ctx.state ?? {};

      try {
        await next();
        if (chatId !== undefined) {
          await persistChatSession(chatId);
        }
      } catch (error) {
        this.logger.error('Middleware error', error);
      }
    });

    this.bot.use(async (ctx, next) => {
      if (!ctx.from) {
        return;
      }

      try {
        const user = await this.userService.updateTelegramUser(
          ctx.from.id,
          ctx.from.username,
          ctx.from.first_name,
          ctx.from.last_name,
          ctx.from.language_code,
        );

        ctx.state.user = user;
      } catch (error) {
        this.logger.error('Failed to update user', error);
      }

      await next();
    });
  }

  private setupCommands(): void {
    this.bot.start(async (ctx) => {
      try {
        const user = ctx.state.user;
        const lang = await this.resolveLang(user);
        const t = this.i18nService.t(lang);
        const startPayload = this.getStartPayload(ctx.message?.text);

        if (user && startPayload?.startsWith('invite_')) {
          const handledInvite = await this.handleInviteStartPayload(ctx, startPayload, lang);
          if (handledInvite) {
            await this.sendMainMenu(ctx);
            return;
          }
        }

        // Send welcome text with persistent Reply keyboard
        await ctx.reply(t('bot.start_message'), {
          parse_mode: 'HTML',
          reply_markup: this.getMainMenuReplyKeyboard(lang).reply_markup,
        });

        // Send "Open App" as a separate inline button so it always works
        const openAppKeyboard = this.getOpenAppInlineButton(lang);
        if (openAppKeyboard) {
          await ctx.reply(t('menu.open_mini_app'), openAppKeyboard);
        }
      } catch (error) {
        this.logger.error('Start command error', error);
        await ctx.reply('Добро пожаловать! Используйте /menu для главного меню.');
      }
    });

    this.bot.command('menu', async (ctx) => {
      await this.sendMainMenu(ctx);
    });

    this.bot.command('support', async (ctx) => {
      try {
        const lang = await this.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);
        const handle = t('common.support_handle') || '@support';
        await ctx.reply(
          `${t('menu.support')}: ${handle}`,
          withInlineKeyboard(
            Markup.inlineKeyboard([
              [Markup.button.url(t('menu.support'), `https://t.me/${handle.replace('@', '')}`)],
              [Markup.button.callback(t('menu.back_to_menu'), 'menu_back')],
            ]),
          ),
        );
      } catch (error) {
        this.logger.error('Support command error', error);
      }
    });

    this.bot.command('help', async (ctx) => {
      try {
        const lang = await this.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);

        await ctx.reply(t('bot.help_message'), { parse_mode: 'HTML' });
      } catch (error) {
        this.logger.error('Help command error', error);
      }
    });

    this.bot.command('language', async (ctx) => {
      try {
        const lang = await this.resolveLang(ctx.state.user);

        await ctx.reply(
          this.i18nService.translate('common.select_language', { lang }),
          withInlineKeyboard(this.getLanguageKeyboard()),
        );
      } catch (error) {
        this.logger.error('Language command error', error);
      }
    });

    this.bot.command('settings', async (ctx) => {
      try {
        const lang = await this.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(t('menu.language'), 'settings_language')],
          [Markup.button.callback(t('menu.back_to_menu'), 'menu_back')],
        ]);

        await ctx.reply(t('bot.settings_intro'), withInlineKeyboard(keyboard, { parse_mode: 'HTML' }));
      } catch (error) {
        this.logger.error('Settings command error', error);
      }
    });

    this.bot.command('profile', async (ctx) => {
      const lang = await this.resolveLang(ctx.state.user);
      await this.handleProfileCommand(ctx, lang);
    });

    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text?.trim();
      if (text?.startsWith('/')) {
        const command = text.split(/\s+/)[0].slice(1).split('@')[0];
        const known = new Set([
          'start',
          'menu',
          'help',
          'support',
          'language',
          'settings',
          'profile',
          'new_deal',
          'my_deals',
          'check',
        ]);

        if (!known.has(command)) {
          const lang = await this.resolveLang(ctx.state.user);
          await ctx.reply(this.i18nService.t(lang)('bot.unknown_command'));
          return;
        }
      }

      return next();
    });
  }

  private setupErrorHandler(): void {
    this.bot.catch(async (error: any, ctx) => {
      this.logger.error(`Telegram error: ${error?.message || error}`, error);

      if (ctx && 'reply' in ctx) {
        const lang = await this.resolveLang((ctx as TelegramContext).state?.user);
        await ctx.reply(this.i18nService.translate('errors.generic', { lang }));
      }
    });
  }

  async sendMainMenu(ctx: TelegramContext): Promise<void> {
    const lang = await this.resolveLang(ctx.state.user);
    const t = this.i18nService.t(lang);
    const text = `${t('bot.menu_title')}\n\n${t('bot.menu_description')}`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: this.getMainMenuReplyKeyboard(lang).reply_markup,
    });

    const openAppKeyboard = this.getOpenAppInlineButton(lang);
    if (openAppKeyboard) {
      await ctx.reply(t('menu.open_mini_app'), openAppKeyboard);
    }
  }

  /**
   * Persistent Reply keyboard — action buttons only (no "Open App" — see getOpenAppInlineButton).
   * Text buttons route through setupReplyKeyboardHears().
   */
  getMainMenuReplyKeyboard(lang: string) {
    const t = this.i18nService.getTranslator(lang);

    const rows = [
      [Markup.button.text(t('menu.new_deal')), Markup.button.text(t('menu.my_deals'))],
      [Markup.button.text(t('menu.balance')), Markup.button.text(t('menu.profile'))],
      [Markup.button.text(t('menu.check_user'))],
      [Markup.button.text(t('menu.settings')), Markup.button.text(t('menu.help'))],
      [Markup.button.text(t('menu.support'))],
    ];

    return Markup.keyboard(rows).resize().persistent();
  }

  /**
   * Inline keyboard with a single "Open Mini App" button.
   * Uses webApp type when MINI_APP_URL is a valid HTTPS URL (preferred).
   * Falls back to URL button pointing to t.me/{bot}/{slug} — always works in Telegram.
   */
  getOpenAppInlineButton(lang: string) {
    const t = this.i18nService.getTranslator(lang);
    const label = t('menu.open_mini_app');
    const webUrl = this.getMiniAppWebUrl();
    if (webUrl) {
      return Markup.inlineKeyboard([[Markup.button.webApp(label, webUrl)]]);
    }
    const tgUrl = this.getMiniAppTelegramUrl();
    if (tgUrl) {
      this.warnMiniAppFallback();
      return Markup.inlineKeyboard([[Markup.button.url(label, tgUrl)]]);
    }
    return null;
  }

  /** Rich HTML profile card used by /profile command and profile Reply button. */
  async handleProfileCommand(ctx: TelegramContext, lang: string): Promise<void> {
    try {
      const user = ctx.state.user;
      if (!user) return;

      const stats = await this.userService.getUserStats(user.id);
      const t = this.i18nService.t(lang);
      const locale = this.getFormattingLocale(lang);
      const since = new Date(user.createdAt).toLocaleDateString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const balance = Number(user.balance ?? 0).toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const reputation = Number(user.reputationScore ?? 0).toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });

      const message =
        `👤 ${formatTelegramUserDisplayName(user)}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `💰 ${t('profile.balance')} <b>${balance} ₽</b>\n` +
        `⭐ ${t('profile.reputation')} <b>${reputation}/100</b>\n` +
        `📋 ${t('profile.deals_count')} <b>${stats.totalDeals}</b>   ` +
        `✅ ${t('profile.completed_deals')} <b>${user.completedDeals ?? 0}</b>\n` +
        `📅 ${t('profile.member_since')} <b>${since}</b>`;

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Profile command error', error);
    }
  }

  private getFormattingLocale(lang: string): string {
    if (lang === 'en') {
      return 'en-US';
    }
    if (lang === 'es') {
      return 'es-ES';
    }
    return 'ru-RU';
  }

  /**
   * Inline keyboard — kept for backward-compat (callback handler menu_back, etc.).
   * @deprecated Prefer Reply keyboard via getMainMenuReplyKeyboard for /start, /menu.
   */
  getMainMenuKeyboard(lang: string) {
    const t = this.i18nService.getTranslator(lang);
    const miniAppWebUrl = this.getMiniAppWebUrl();
    const miniAppTelegramUrl = this.getMiniAppTelegramUrl();

    const rows = [
      ...(miniAppWebUrl
        ? [[Markup.button.webApp(t('menu.open_mini_app'), miniAppWebUrl)]]
        : miniAppTelegramUrl
          ? (this.warnMiniAppFallback(),
            [[Markup.button.url(t('menu.open_mini_app'), miniAppTelegramUrl)]])
          : []),
      [
        Markup.button.callback(t('menu.new_deal'), 'deal_create'),
        Markup.button.callback(t('menu.my_deals'), 'deals_list'),
      ],
      [
        Markup.button.callback(t('menu.balance'), 'balance'),
        Markup.button.callback(t('menu.profile'), 'profile'),
      ],
      [
        Markup.button.callback(t('menu.language'), 'settings_language'),
        Markup.button.callback(t('menu.help'), 'help'),
      ],
      [Markup.button.callback(t('menu.support'), 'support')],
    ] as unknown as Parameters<typeof Markup.inlineKeyboard>[0];

    return Markup.inlineKeyboard(rows);
  }

  /** HTTPS URL of Mini App (BotFather / MINI_APP_URL). */
  getMiniAppWebUrl(): string | null {
    const rawUrl = this.configService.get<string>('MINI_APP_URL');
    const normalized = normalizeHostedMiniAppUrl(rawUrl);
    if (rawUrl?.trim() && !normalized && !this.miniAppUrlWarningLogged) {
      this.miniAppUrlWarningLogged = true;
      this.logger.warn(
        'Ignoring MINI_APP_URL because it must be a hosted HTTPS mini-app URL, not a Telegram deeplink such as t.me/... .',
      );
    }
    return normalized;
  }

  /** Opens Mini App inside Telegram when configured in @BotFather. */
  getMiniAppTelegramUrl(): string | null {
    return buildTelegramMiniAppUrl(
      this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
      this.configService.get<string>('TELEGRAM_MINIAPP_SLUG'),
    );
  }

  private async setupMiniAppMenuButton(): Promise<void> {
    const webUrl = this.getMiniAppWebUrl();
    if (!webUrl || !this.bot) {
      return;
    }

    try {
      const lang = await this.resolveLang();
      const t = this.i18nService.t(lang);
      await this.bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: t('menu.open_mini_app'),
          web_app: { url: webUrl },
        },
      });
    } catch (error) {
      this.logger.warn('setChatMenuButton failed (set MINI_APP_URL to HTTPS URL from BotFather)', error);
    }
  }

  private warnMiniAppFallback(): void {
    if (this.miniAppFallbackWarningLogged) {
      return;
    }

    this.miniAppFallbackWarningLogged = true;
    this.logger.warn(
      'Open App is falling back to a Telegram deeplink because MINI_APP_URL is not configured as a hosted HTTPS mini-app URL. Telegram Web may show an interstitial until MINI_APP_URL is fixed.',
    );
  }

  private getStartPayload(text: string | undefined): string | null {
    const trimmed = text?.trim();
    if (!trimmed?.startsWith('/start')) {
      return null;
    }

    const [, ...rest] = trimmed.split(/\s+/);
    return rest.join(' ').trim() || null;
  }

  private async handleInviteStartPayload(
    ctx: TelegramContext,
    payload: string,
    lang: string,
  ): Promise<boolean> {
    const token = payload.slice('invite_'.length).trim();
    if (!token) {
      return false;
    }

    const t = this.i18nService.t(lang);

    try {
      await this.dealService.acceptInvite(token, ctx.state.user!.id);
      await ctx.reply(t('deal.invites.accepted'));
      return true;
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'Deal already accepted'
          ? t('deal.errors.already_accepted')
          : error instanceof Error &&
              (error.message === 'Invite is not valid' || error.message === 'Invite not found')
            ? t('deal.errors.invite_invalid')
            : this.i18nService.translate('errors.generic', { lang });
      await ctx.reply(message);
      return true;
    }
  }

  private getLanguageKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
        Markup.button.callback('🇬🇧 English', 'lang_en'),
        Markup.button.callback('🇪🇸 Español', 'lang_es'),
      ],
    ]);
  }

  getBot(): Telegraf<TelegramContext> | null {
    return this.bot;
  }

  getBotTelegramId(): number {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
    const part = token.split(':')[0];
    return Number(part) || 0;
  }

  async handleInjectUpdate(update: Update): Promise<TelegramTestCapture | null> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    this.lastTestCapture = null;
    this.testCaptureActive = true;

    const telegram = this.bot.telegram;
    const origSendMessage = telegram.sendMessage.bind(telegram);
    const origEditMessageText = telegram.editMessageText.bind(telegram);

    const recordFromApi = (
      text: unknown,
      chatId: number | string,
      extra?: { reply_markup?: unknown },
      messageId?: number,
    ) => {
      this.lastTestCapture = {
        text: typeof text === 'string' ? text : String(text ?? ''),
        chatId: typeof chatId === 'number' ? chatId : Number(chatId),
        messageId: messageId ?? this.lastTestCapture?.messageId,
        replyMarkup: extra?.reply_markup,
      };
    };

    (telegram as { sendMessage: typeof origSendMessage }).sendMessage = async (
      chatId: number | string,
      text: string,
      extra?: object,
    ) => {
      recordFromApi(text, chatId, extra as { reply_markup?: unknown });
      try {
        const msg = await origSendMessage(chatId, text, extra);
        if (msg && typeof msg === 'object' && 'message_id' in msg) {
          recordFromApi(text, chatId, extra as { reply_markup?: unknown }, (msg as { message_id: number }).message_id);
        }
        return msg;
      } catch (error) {
        this.logger.warn('Inject capture: sendMessage failed (Telegram API)', error);
        return undefined as never;
      }
    };

    (telegram as { editMessageText: typeof origEditMessageText }).editMessageText = async (
      chatId: number | string,
      messageId: number | undefined,
      inlineMessageId: string | undefined,
      text: string,
      extra?: object,
    ) => {
      recordFromApi(text, chatId, extra as { reply_markup?: unknown }, messageId);
      try {
        return await origEditMessageText(chatId, messageId, inlineMessageId, text, extra);
      } catch (error) {
        this.logger.warn('Inject capture: editMessageText failed (Telegram API)', error);
        return undefined as never;
      }
    };

    try {
      await this.bot.handleUpdate(update as Parameters<Telegraf['handleUpdate']>[0]);
      return this.lastTestCapture;
    } finally {
      (telegram as { sendMessage: typeof origSendMessage }).sendMessage = origSendMessage;
      (telegram as { editMessageText: typeof origEditMessageText }).editMessageText = origEditMessageText;
      this.testCaptureActive = false;
    }
  }

  async sendMessage(
    chatId: number,
    message: string,
    options?: {
      parseMode?: 'HTML' | 'Markdown';
      replyMarkup?: any;
    },
  ): Promise<void> {
    if (!this.bot) {
      return;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: options?.parseMode as any,
        reply_markup: options?.replyMarkup,
      });
    } catch (error) {
      this.logger.error(`Failed to send message to ${chatId}`, error);
    }
  }

  async editMessage(
    chatId: number,
    messageId: number,
    message: string,
    options?: {
      parseMode?: 'HTML' | 'Markdown';
      replyMarkup?: any;
    },
  ): Promise<void> {
    if (!this.bot) {
      return;
    }

    try {
      await this.bot.telegram.editMessageText(chatId, messageId, undefined, message, {
        parse_mode: options?.parseMode as any,
        reply_markup: options?.replyMarkup,
      });
    } catch (error) {
      this.logger.error(`Failed to edit message ${messageId}`, error);
    }
  }

  async sendNotification(
    userId: string,
    notificationKey: string,
    _data?: Record<string, any>,
  ): Promise<void> {
    const user = await this.userService.findById(userId);

    if (!user?.telegramId) {
      return;
    }

    const lang = await this.userService.getUserLanguage(userId);
    const message = this.i18nService.translate(`notifications.${notificationKey}`, { lang });

    await this.sendMessage(user.telegramId, message);
  }
}
