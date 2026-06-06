jest.mock('./telegram-session.store', () => ({
  persistChatSession: jest.fn(),
}));

import { TelegramDealLifecycleHandler } from './telegram-deal-lifecycle.handler';
import { persistChatSession } from './telegram-session.store';

describe('TelegramDealLifecycleHandler', () => {
  const translations: Record<string, string> = {
    'wallet.invalid_address': 'invalid wallet',
    'wallet.linked': 'wallet linked',
  };

  const dealService = {};
  const paymentService = {};
  const userService = {
    attachWallet: jest.fn(),
    getUserLanguage: jest.fn().mockResolvedValue('en'),
  };
  const i18nService = {
    translate: jest.fn((key: string) => translations[key] ?? key),
    t: jest.fn(() => (key: string) => translations[key] ?? key),
  };
  const botService = {
    resolveLang: jest.fn().mockResolvedValue('en'),
  };
  const config = {
    get: jest.fn(),
  };

  let handler: TelegramDealLifecycleHandler;
  let bot: { action: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new TelegramDealLifecycleHandler(
      dealService as any,
      paymentService as any,
      userService as any,
      i18nService as any,
      botService as any,
      config as any,
    );
    bot = {
      action: jest.fn(),
      on: jest.fn(),
    };
  });

  it('registers strict UUID callback patterns for deal actions', () => {
    handler.registerHandlers(bot as any);

    const viewPattern = bot.action.mock.calls.find(([pattern]) =>
      pattern instanceof RegExp && pattern.source.includes('deal_view_'),
    )?.[0] as RegExp;

    expect(viewPattern.test('deal_view_123')).toBe(false);
    expect(viewPattern.test('deal_view_123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('keeps wallet mode on invalid address and replies with localized error', async () => {
    handler.registerHandlers(bot as any);
    const onText = bot.on.mock.calls.find(([event]) => event === 'text')?.[1];
    const ctx = {
      session: { walletLink: true },
      state: { user: { id: 'user-1' } },
      message: { text: 'not-a-wallet' },
      reply: jest.fn(),
    };
    const next = jest.fn();

    await onText(ctx, next);

    expect(ctx.reply).toHaveBeenCalledWith('invalid wallet');
    expect(userService.attachWallet).not.toHaveBeenCalled();
    expect(ctx.session.walletLink).toBe(true);
  });

  it('links wallet in wallet mode and persists the session', async () => {
    handler.registerHandlers(bot as any);
    const onText = bot.on.mock.calls.find(([event]) => event === 'text')?.[1];
    const ctx = {
      session: { walletLink: true },
      state: { user: { id: 'user-1' } },
      message: { text: '0x1111111111111111111111111111111111111111' },
      reply: jest.fn(),
      chat: { id: 99 },
    };
    const next = jest.fn();

    await onText(ctx, next);

    expect(userService.attachWallet).toHaveBeenCalledWith(
      'user-1',
      '0x1111111111111111111111111111111111111111',
    );
    expect(ctx.reply).toHaveBeenCalledWith('wallet linked');
    expect(ctx.session.walletLink).toBeUndefined();
    expect(persistChatSession).toHaveBeenCalledWith(99);
  });
});
