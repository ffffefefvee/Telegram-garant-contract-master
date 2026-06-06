import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageCode } from '../user/entities/language-preference.entity';

export type TranslatorFunction = (key: string) => string;

@Injectable()
export class I18nService implements OnModuleInit {
  private readonly logger = new Logger(I18nService.name);
  private currentLang: LanguageCode = LanguageCode.RU;
  private readonly supportedLanguages: LanguageCode[] = [
    LanguageCode.RU,
    LanguageCode.EN,
    LanguageCode.ES,
  ];

  private readonly translations: Record<string, Record<string, string>> = {
    ru: {},
    en: {},
    es: {},
  };

  constructor(private configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.loadLocaleFiles();
    this.logger.log('I18n service initialized');
  }

  private loadLocaleFiles(): void {
    const candidates = [
      path.join(process.cwd(), 'locales'),
      path.join(__dirname, '..', '..', '..', 'locales'),
    ];

    const localesDir = candidates.find((dir) => fs.existsSync(dir));

    if (!localesDir) {
      this.logger.warn('Locales directory not found; using built-in fallbacks only');
      this.applyBuiltinFallbacks();
      return;
    }

    for (const lang of ['ru', 'en', 'es']) {
      const filePath = path.join(localesDir, `${lang}.json`);

      if (!fs.existsSync(filePath)) {
        this.logger.warn(`Locale file missing: ${filePath}`);
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        this.translations[lang] = this.flattenTranslations(raw);
        this.logger.log(`Loaded ${Object.keys(this.translations[lang]).length} keys for "${lang}"`);
      } catch (error) {
        this.logger.error(`Failed to load locale ${lang}`, error);
      }
    }

    this.applyBuiltinFallbacks();
  }

  private flattenTranslations(
    obj: Record<string, unknown>,
    prefix = '',
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(
          result,
          this.flattenTranslations(value as Record<string, unknown>, fullKey),
        );
      } else if (typeof value === 'string') {
        result[fullKey] = value;
      }
    }

    return result;
  }

  /** Minimal keys if JSON files are missing (tests / misconfigured deploy). */
  private applyBuiltinFallbacks(): void {
    const fallback: Record<string, string> = {
      'bot.start_message': 'Добро пожаловать в Гарант Бот! Нажмите /menu',
      'bot.menu_title': 'Главное меню',
      'bot.help_message': 'Справка: /menu — меню, /new_deal — сделка, /my_deals — список.',
      'bot.unknown_command': 'Неизвестная команда. Используйте /menu',
      'menu.new_deal': 'Новая сделка',
      'menu.my_deals': 'Мои сделки',
      'menu.balance': 'Баланс',
      'menu.profile': 'Профиль',
      'menu.language': 'Язык',
      'menu.help': 'Помощь',
      'menu.support': 'Поддержка',
      'menu.settings': 'Настройки',
      'menu.back_to_menu': 'Назад в меню',
      'menu.open_mini_app': 'Открыть приложение',
      'common.select_language': 'Выберите язык',
      'common.contact': 'Поддержка',
      'common.back': 'Назад',
      'common.cancel': 'Отмена',
      'common.loading': 'Загрузка...',
      'common.success': 'Успешно',
      'common.language_changed': 'Язык изменён',
      'errors.generic': 'Произошла ошибка',
    };

    for (const lang of ['ru', 'en', 'es']) {
      this.translations[lang] = { ...fallback, ...this.translations[lang] };
    }
  }

  t(lang: string): TranslatorFunction {
    return (key: string) => this.translateKey(key, lang);
  }

  private translateKey(key: string, lang: string): string {
    const langCode = (lang || 'ru').toLowerCase().slice(0, 2);
    return (
      this.translations[langCode]?.[key] ||
      this.translations['en']?.[key] ||
      this.translations['ru']?.[key] ||
      key
    );
  }

  translate(key: string, options?: { lang?: string }): string {
    const lang = options?.lang || this.currentLang;
    return this.translateKey(key, lang);
  }

  async changeLanguage(lang: LanguageCode): Promise<void> {
    this.currentLang = lang;
  }

  setLanguage(lang: LanguageCode): void {
    this.currentLang = lang;
  }

  getLanguage(): LanguageCode {
    return this.currentLang;
  }

  getSupportedLanguages(): LanguageCode[] {
    return this.supportedLanguages;
  }

  getTranslator(lang: LanguageCode | string): TranslatorFunction {
    return (key: string) => this.translateKey(key, lang);
  }

  async reloadTranslations(): Promise<void> {
    this.loadLocaleFiles();
    this.logger.log('Translations reloaded');
  }
}
