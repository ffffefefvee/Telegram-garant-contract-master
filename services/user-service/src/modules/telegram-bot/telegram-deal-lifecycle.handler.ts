import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Context, Telegraf, Markup } from 'telegraf';
import { DealService } from '../deal/deal.service';
import { PaymentService } from '../payment/payment.service';
import { UserService } from '../user/user.service';
import { I18nService } from '../i18n/i18n.service';
import { ConfigService } from '@nestjs/config';
import { DealStatus } from '../deal/enums/deal.enum';
import { User } from '../user/entities/user.entity';
import { TelegramBotService } from './telegram-bot.service';
import { persistChatSession } from './telegram-session.store';
import { withInlineKeyboard } from './telegram-reply.util';

type BotCtx = Context & {
  session?: Record<string, unknown> & { walletLink?: boolean };
  state: { user?: User };
};

const DEAL_ID_PATTERN = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

@Injectable()
export class TelegramDealLifecycleHandler {
  private readonly logger = new Logger(TelegramDealLifecycleHandler.name);

  constructor(
    private readonly dealService: DealService,
    private readonly paymentService: PaymentService,
    private readonly userService: UserService,
    private readonly i18nService: I18nService,
    @Inject(forwardRef(() => TelegramBotService))
    private readonly botService: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  registerHandlers(bot: Telegraf<BotCtx>): void {
    bot.action(/deals_filter_(active|completed|all)/, async (ctx) => {
      await this.answerCallback(ctx);
      await this.showDealsList(ctx, ctx.match[1] as 'active' | 'completed' | 'all');
    });
    bot.action(new RegExp(`^deal_view_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.showDeal(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_invite_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.createInvite(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_pay_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.startPayment(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_accept_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.acceptDeal(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_ship_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.shipDeal(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_confirm_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.confirmDeal(ctx, ctx.match[1]);
    });
    bot.action(new RegExp(`^deal_wallet_${DEAL_ID_PATTERN}$`), async (ctx) => {
      await this.answerCallback(ctx);
      await this.promptWallet(ctx, ctx.match[1]);
    });
    bot.action('wallet_link', async (ctx) => {
      await this.answerCallback(ctx);
      await this.startWalletLink(ctx);
    });

    bot.on('text', async (ctx, next) => {
      const session = ctx.session;
      if (!session?.walletLink || !ctx.state.user) {
        return next();
      }

      const input = ctx.message?.text?.trim();
      if (!input || input.startsWith('/')) {
        return next();
      }

      const lang = await this.botService.resolveLang(ctx.state.user);
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        await ctx.reply(this.i18nService.translate('wallet.invalid_address', { lang }));
        return;
      }

      try {
        await this.userService.attachWallet(ctx.state.user.id, input);
        delete session.walletLink;
        if (ctx.chat?.id) {
          await persistChatSession(ctx.chat.id);
        }
        await ctx.reply(this.i18nService.translate('wallet.linked', { lang }));
      } catch (err) {
        await ctx.reply((err as Error).message);
      }
    });
  }

  private async lang(user?: User): Promise<string> {
    if (!user) return 'ru';
    try {
      return await this.userService.getUserLanguage(user.id);
    } catch {
      return user.telegramLanguageCode?.slice(0, 2) || 'ru';
    }
  }

  /** Entry point for /my_deals, menu button, and deals_list callback. */
  async openDealsMenu(
    ctx: BotCtx,
    filter: 'active' | 'completed' | 'all' = 'all',
  ): Promise<void> {
    await this.showDealsList(ctx, filter);
  }

  private dealsFilterKeyboard(t: (key: string) => string) {
    return [
      [
        Markup.button.callback(t('deal.filter.active'), 'deals_filter_active'),
        Markup.button.callback(t('deal.filter.completed'), 'deals_filter_completed'),
        Markup.button.callback(t('deal.filter.all'), 'deals_filter_all'),
      ],
    ];
  }

  private async showDealsList(
    ctx: BotCtx,
    filter: 'active' | 'completed' | 'all',
  ): Promise<void> {
    const user = ctx.state.user;
    if (!user) return;
    const lang = await this.lang(user);
    const t = this.i18nService.t(lang);

    try {
      const statusMap: Record<string, DealStatus[] | undefined> = {
        active: [
          DealStatus.DRAFT,
          DealStatus.PENDING_ACCEPTANCE,
          DealStatus.PENDING_PAYMENT,
          DealStatus.IN_PROGRESS,
          DealStatus.PENDING_CONFIRMATION,
          DealStatus.DISPUTED,
        ],
        completed: [DealStatus.COMPLETED],
        all: undefined,
      };

      const { deals, total } = await this.dealService.findMany(
        {
          userId: user.id,
          status: statusMap[filter],
          limit: 10,
          sortBy: 'createdAt',
          sortOrder: 'DESC',
        },
        user.id,
      );

      const filterKb = this.dealsFilterKeyboard(t);
      if (total === 0) {
        await ctx.reply(
          t('deal.list_empty'),
          withInlineKeyboard(
            Markup.inlineKeyboard([
              ...filterKb,
              [Markup.button.callback(t('menu.back_to_menu'), 'menu_back')],
            ]),
          ),
        );
      } else {
        const rows = deals.map((d) => [
          Markup.button.callback(
            `${d.dealNumber} — ${d.amount} ${d.currency}`,
            `deal_view_${d.id}`,
          ),
        ]);
        rows.push(...filterKb);
        rows.push([Markup.button.callback(t('menu.back_to_menu'), 'menu_back')]);
        await ctx.reply(
          `${t('menu.my_deals')} (${total})`,
          withInlineKeyboard(Markup.inlineKeyboard(rows)),
        );
      }
    } catch (error) {
      this.logger.error('showDealsList', error);
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async showDeal(ctx: BotCtx, dealId: string): Promise<void> {
    const user = ctx.state.user;
    if (!user) return;
    const lang = await this.lang(user);
    const t = this.i18nService.t(lang);

    try {
      const deal = await this.dealService.findById(dealId);
      const chainId = this.config.get('BLOCKCHAIN_CHAIN_ID', '80002');
      const explorer = chainId === '137' ? 'polygonscan.com' : 'amoy.polygonscan.com';
      const escrowLine = deal.escrowAddress
        ? `\n<a href="https://${explorer}/address/${deal.escrowAddress}">${t('deal.on_chain_proof')}</a>`
        : '';

      const text =
        `<b>${deal.dealNumber}</b>\n` +
        `${t(`deal.status.${deal.status}`)}\n` +
        `${deal.amount} ${deal.currency}${escrowLine}`;

      const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

      if (deal.buyerId === user.id && deal.status === DealStatus.PENDING_PAYMENT) {
        buttons.push([Markup.button.callback(t('deal.actions.pay'), `deal_pay_${deal.id}`)]);
      }
      if (deal.sellerId === user.id && deal.status === DealStatus.PENDING_ACCEPTANCE) {
        buttons.push([Markup.button.callback(t('deal.actions.accept'), `deal_accept_${deal.id}`)]);
      }
      if (deal.sellerId === user.id && deal.status === DealStatus.IN_PROGRESS) {
        buttons.push([Markup.button.callback(t('deal.actions.ship'), `deal_ship_${deal.id}`)]);
      }
      if (deal.buyerId === user.id && deal.status === DealStatus.PENDING_CONFIRMATION) {
        buttons.push([
          Markup.button.callback(t('deal.actions.confirm'), `deal_confirm_${deal.id}`),
        ]);
      }
      if (deal.buyerId === user.id && !deal.sellerId) {
        buttons.push([
          Markup.button.callback(t('deal.actions.invite'), `deal_invite_${deal.id}`),
        ]);
      }
      if (!user.walletAddress) {
        buttons.push([
          Markup.button.callback(t('wallet.link'), `deal_wallet_${deal.id}`),
        ]);
      }
      buttons.push([Markup.button.callback(t('menu.back_to_menu'), 'menu_back')]);

      await this.renderDealCard(ctx, text, buttons);
    } catch (error) {
      this.logger.error('showDeal', error);
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async createInvite(ctx: BotCtx, dealId: string): Promise<void> {
    const user = ctx.state.user;
    if (!user) return;
    const lang = await this.lang(user);
    const t = this.i18nService.t(lang);

    try {
      const invite = await this.dealService.createInvite(dealId, user.id);
      const botUser = this.config.get('TELEGRAM_BOT_USERNAME', '').replace(/^@/, '');
      const link = botUser
        ? `https://t.me/${botUser}?start=invite_${invite.inviteToken}`
        : invite.inviteUrl;
      await ctx.reply(`${t('deal.invite_link')}\n${link}`);
    } catch (error) {
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async startPayment(ctx: BotCtx, dealId: string): Promise<void> {
    const user = ctx.state.user;
    if (!user) return;
    const lang = await this.lang(user);

    try {
      const deal = await this.dealService.findById(dealId);
      if (deal.buyerId !== user.id) {
        throw new ForbiddenException('Only buyer can pay for the deal');
      }
      if (deal.status !== DealStatus.PENDING_PAYMENT) {
        throw new ConflictException('Deal is not pending payment');
      }
      const { paymentUrl } = await this.paymentService.createPayment(
        dealId,
        Number(deal.buyerPays ?? deal.amount),
        user.id,
        { description: deal.title ?? deal.dealNumber },
      );
      if (!paymentUrl) {
        throw new ConflictException('Payment URL is unavailable');
      }
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(paymentUrl)}`;
      await ctx.reply(this.i18nService.translate('payment.open_link', { lang }), {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url(this.i18nService.translate('payment.pay_now', { lang }), paymentUrl)],
        ]).reply_markup,
      });
      try {
        await ctx.replyWithPhoto({ url: qrUrl });
      } catch {
        // QR optional if Telegram rejects external URL
      }
    } catch (error) {
      await this.replyLifecycleError(ctx, error, lang, 'payment');
    }
  }

  private async acceptDeal(ctx: BotCtx, dealId: string): Promise<void> {
    const lang = await this.lang(ctx.state.user);

    try {
      await this.dealService.accept(dealId, ctx.state.user!.id);
      await this.showDeal(ctx, dealId);
    } catch (error) {
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async shipDeal(ctx: BotCtx, dealId: string): Promise<void> {
    const lang = await this.lang(ctx.state.user);

    try {
      await this.dealService.markShipped(dealId, ctx.state.user!.id);
      await this.showDeal(ctx, dealId);
    } catch (error) {
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async confirmDeal(ctx: BotCtx, dealId: string): Promise<void> {
    const lang = await this.lang(ctx.state.user);

    try {
      await this.dealService.confirmReceipt(dealId, ctx.state.user!.id);
      await this.showDeal(ctx, dealId);
    } catch (error) {
      await this.replyLifecycleError(ctx, error, lang);
    }
  }

  private async promptWallet(ctx: BotCtx, _dealId: string): Promise<void> {
    ctx.session = ctx.session ?? {};
    (ctx.session as { walletLink: boolean }).walletLink = true;
    if (ctx.chat?.id) {
      await persistChatSession(ctx.chat.id);
    }
    const lang = await this.lang(ctx.state.user);
    await ctx.reply(this.i18nService.translate('wallet.enter_address', { lang }));
  }

  private async startWalletLink(ctx: BotCtx): Promise<void> {
    await this.promptWallet(ctx, '');
  }

  private async answerCallback(ctx: BotCtx): Promise<void> {
    await ctx.answerCbQuery?.().catch(() => undefined);
  }

  private async renderDealCard(
    ctx: BotCtx,
    text: string,
    buttons: ReturnType<typeof Markup.button.callback>[][],
  ): Promise<void> {
    const keyboard = Markup.inlineKeyboard(buttons);
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
    } catch {
      await ctx.reply(text, withInlineKeyboard(keyboard, { parse_mode: 'HTML' }));
    }
  }

  private async replyLifecycleError(
    ctx: BotCtx,
    error: unknown,
    lang: string,
    scope: 'deal' | 'payment' = 'deal',
  ): Promise<void> {
    const t = this.i18nService.t(lang);

    if (error instanceof NotFoundException) {
      await ctx.reply(scope === 'payment' ? t('payment.errors.not_found') : t('deal.errors.not_found'));
      return;
    }

    if (error instanceof ForbiddenException) {
      await ctx.reply(t('errors.forbidden'));
      return;
    }

    if (error instanceof ConflictException || error instanceof BadRequestException) {
      await ctx.reply(`❌ ${(error as Error).message}`);
      return;
    }

    await ctx.reply(t('errors.generic'));
  }
}
