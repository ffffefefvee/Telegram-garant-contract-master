import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Markup } from 'telegraf';
import { TelegramBotService } from './telegram-bot.service';
import { UserService } from '../user/user.service';
import { I18nService } from '../i18n/i18n.service';
import { DealService } from '../deal/deal.service';
import { LanguageCode } from '../user/entities/language-preference.entity';
import { User } from '../user/entities/user.entity';
import { withInlineKeyboard } from './telegram-reply.util';
import { TelegramDealLifecycleHandler } from './telegram-deal-lifecycle.handler';

@Injectable()
export class TelegramCallbackHandler {
  private readonly logger = new Logger(TelegramCallbackHandler.name);

  constructor(
    @Inject(forwardRef(() => TelegramBotService))
    private botService: TelegramBotService,
    private userService: UserService,
    private i18nService: I18nService,
    private dealService: DealService,
    private config: ConfigService,
    private lifecycleHandler: TelegramDealLifecycleHandler,
  ) {}

  registerHandlers(bot: any): void {
    this.setupCallbackHandlers(bot);
    this.logger.log('Callback handlers registered');
  }

  private setupCallbackHandlers(bot: any): void {
    bot.action('menu_back', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);
        const keyboard = this.botService.getMainMenuKeyboard(lang);
        const text = `${t('bot.menu_title')}\n\n${t('bot.menu_description')}`;

        try {
          await ctx.editMessageText(text, withInlineKeyboard(keyboard, { parse_mode: 'HTML' }));
        } catch {
          await ctx.reply(text, withInlineKeyboard(keyboard, { parse_mode: 'HTML' }));
        }

        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('menu_back error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('settings_language', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
            Markup.button.callback('🇬🇧 English', 'lang_en'),
            Markup.button.callback('🇪🇸 Español', 'lang_es'),
          ],
          [Markup.button.callback(this.i18nService.t(lang)('menu.back_to_menu'), 'menu_back')],
        ]);

        await ctx.editMessageText(
          this.i18nService.translate('common.select_language', { lang }),
          withInlineKeyboard(keyboard),
        );
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('settings_language error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('lang_ru', async (ctx: any) => {
      await this.handleLanguageChange(ctx, LanguageCode.RU);
    });

    bot.action('lang_en', async (ctx: any) => {
      await this.handleLanguageChange(ctx, LanguageCode.EN);
    });

    bot.action('lang_es', async (ctx: any) => {
      await this.handleLanguageChange(ctx, LanguageCode.ES);
    });

    bot.action('help', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);

        await ctx.reply(t('bot.help_message'), { parse_mode: 'HTML' });
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('help error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('support', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);

        const handle =
          this.config.get('TELEGRAM_SUPPORT_USERNAME') ||
          t('common.support_handle') ||
          '@support';
        await ctx.reply(`${t('common.support')}: ${handle}`);
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('support error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('balance', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        await this.showBalance(ctx, lang);
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('balance error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('profile', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        await this.botService.handleProfileCommand(ctx, lang);
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('profile error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('deal_create', async (ctx: any) => {
      try {
        const lang = await this.botService.resolveLang(ctx.state.user);
        const t = this.i18nService.t(lang);

        if (!ctx.session) {
          ctx.session = {};
        }
        ctx.session.dealCreation = { step: 'type' };

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(t('deal.types.physical'), 'deals_type_physical')],
          [Markup.button.callback(t('deal.types.digital'), 'deals_type_digital')],
          [Markup.button.callback(t('deal.types.service'), 'deals_type_service')],
          [Markup.button.callback(t('deal.types.rent'), 'deals_type_rent')],
          [Markup.button.callback(t('common.back'), 'menu_back')],
        ]);

        await ctx.reply(
          `${t('deal.create_title')}\n\n${t('deal.select_type')}`,
          withInlineKeyboard(keyboard),
        );
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('deal_create error', error);
        await ctx.answerCbQuery().catch(() => undefined);
      }
    });

    bot.action('deals_list', async (ctx: any) => {
      try {
        await this.lifecycleHandler.openDealsMenu(ctx, 'all');
      } catch (error) {
        this.logger.error('deals_list error', error);
        await ctx.answerCbQuery(this.i18nService.translate('errors.generic', { lang: 'ru' })).catch(
          () => undefined,
        );
      }
    });
  }

  /** Public — called from Reply keyboard hears-handler in TelegramBotService. */
  async openDealsList(ctx: any, lang: string): Promise<void> {
    await this.lifecycleHandler.openDealsMenu(ctx, 'all');
  }

  /** Public — called from Reply keyboard hears-handler in TelegramBotService. */
  async showBalance(ctx: any, lang: string): Promise<void> {
    const user: User = ctx.state.user;
    const t = this.i18nService.t(lang);
    const balance = Number(user.balance ?? 0).toLocaleString(
      lang === 'ru' ? 'ru-RU' : lang === 'es' ? 'es-ES' : 'en-US',
    );
    const message = t('bot.balance_card').replace('{{balance}}', balance);
    await ctx.reply(message, { parse_mode: 'HTML' });
  }

  private async handleLanguageChange(ctx: any, languageCode: LanguageCode): Promise<void> {
    try {
      const user: User = ctx.state.user;

      await this.userService.setUserLanguage(user.id, languageCode);

      const langNames: Record<LanguageCode, string> = {
        [LanguageCode.RU]: 'Русский',
        [LanguageCode.EN]: 'English',
        [LanguageCode.ES]: 'Español',
      };

      const t = this.i18nService.t(languageCode);
      const keyboard = this.botService.getMainMenuKeyboard(languageCode);

      try {
        await ctx.editMessageText(
          `${t('common.language_changed')}: ${langNames[languageCode]}`,
          withInlineKeyboard(keyboard),
        );
      } catch {
        await ctx.reply(
          `${t('common.language_changed')}: ${langNames[languageCode]}`,
          withInlineKeyboard(keyboard),
        );
      }

      await ctx.answerCbQuery();
    } catch (error) {
      this.logger.error('handleLanguageChange error', error);
      await ctx.answerCbQuery(this.i18nService.translate('errors.generic', { lang: 'ru' })).catch(
        () => undefined,
      );
    }
  }
}
