import { ConfigService } from '@nestjs/config';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Telegraf } from 'telegraf';
import type { TelegramContext } from './telegram-bot.service';

/** Telegraf HTTP client options (proxy, custom Bot API server). */
export function buildTelegramClientOptions(
  configService: ConfigService,
): NonNullable<Telegraf.Options<TelegramContext>['telegram']> {
  const options: NonNullable<Telegraf.Options<TelegramContext>['telegram']> = {};

  const apiRoot = configService.get<string>('TELEGRAM_API_ROOT');
  if (apiRoot) {
    options.apiRoot = apiRoot.replace(/\/$/, '');
  }

  const proxy =
    configService.get<string>('HTTPS_PROXY') || configService.get<string>('HTTP_PROXY');
  if (proxy) {
    options.agent = new HttpsProxyAgent(proxy) as unknown as NonNullable<
      NonNullable<Telegraf.Options<TelegramContext>['telegram']>['agent']
    >;
  }

  return options;
}
