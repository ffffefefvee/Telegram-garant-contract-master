import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramTestInjectService } from './telegram-test-inject.service';

describe('TelegramTestInjectService', () => {
  const botService = {
    getBot: jest.fn().mockReturnValue({}),
    getBotTelegramId: jest.fn().mockReturnValue(123456),
    handleInjectUpdate: jest.fn().mockResolvedValue({ text: 'menu', messageId: 10, chatId: 99 }),
  } as unknown as TelegramBotService;

  const configValues: Record<string, string> = {
    NODE_ENV: 'development',
    TELEGRAM_TEST_INJECT_ENABLED: 'true',
    TELEGRAM_TEST_INJECT_SECRET: 'test-secret',
    TELEGRAM_CHAT_ID: '7124952069',
  };

  const config = {
    get: jest.fn((key: string, defaultValue?: string) => configValues[key] ?? defaultValue),
  } as unknown as ConfigService;

  let service: TelegramTestInjectService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TelegramTestInjectService(config, botService);
  });

  it('isEnabled when dev flags set and bot exists', () => {
    expect(service.isEnabled()).toBe(true);
  });

  it('rejects wrong secret', () => {
    expect(() => service.assertEnabled('wrong')).toThrow(ForbiddenException);
  });

  it('injects command via handleInjectUpdate', async () => {
    const result = await service.injectCommand('/start');
    expect(result.ok).toBe(true);
    expect(result.capture?.text).toBe('menu');
    expect(botService.handleInjectUpdate).toHaveBeenCalled();
  });

  it('injects callback after command stored message', async () => {
    await service.injectCommand('/start');
    const result = await service.injectCallback('deals_list');
    expect(result.ok).toBe(true);
    expect(botService.handleInjectUpdate).toHaveBeenCalledTimes(2);
  });
});
