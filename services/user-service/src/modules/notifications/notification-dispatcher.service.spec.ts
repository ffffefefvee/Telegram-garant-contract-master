import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  NotificationTemplateRegistry,
  registerBuiltinTemplates,
} from './notification-template.registry';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';
import { User } from '../user/entities/user.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { OutboxEvent, OutboxStatus } from '../ops/entities/outbox-event.entity';

describe('NotificationDispatcher', () => {
  let dispatcher: NotificationDispatcher;
  let userRepo: { findOne: jest.Mock };
  let prefRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let bot: { sendMessage: jest.Mock };

  const makeEvent = (
    eventType: string,
    payload: Record<string, unknown>,
  ): OutboxEvent => ({
    id: 'evt-1',
    aggregateType: 'dispute',
    aggregateId: 'disp-1',
    eventType,
    payload,
    status: OutboxStatus.IN_FLIGHT,
    attempts: 0,
    lastError: null,
    availableAt: new Date(),
    deliveredAt: null,
    createdAt: new Date(),
  });

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    prefRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    bot = { sendMessage: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcher,
        NotificationTemplateRegistry,
        NotificationPreferenceService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(NotificationPreference), useValue: prefRepo },
        { provide: TelegramBotService, useValue: bot },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    dispatcher = module.get(NotificationDispatcher);
    // Manually trigger template registration (OnModuleInit doesn't fire in this setup).
    registerBuiltinTemplates(module.get(NotificationTemplateRegistry));
  });

  it('marks unknown event types as unhandled', async () => {
    const result = await dispatcher.dispatch(
      makeEvent('totally.unknown', {}),
    );
    expect(result.unhandled).toBe(true);
    expect(result.delivered).toBe(0);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('delivers dispute.opened to opponent with their Telegram chat id', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-opp',
      telegramId: 42,
      telegramLanguageCode: 'ru',
    });
    prefRepo.findOne.mockResolvedValue(null);

    const result = await dispatcher.dispatch(
      makeEvent('dispute.opened', {
        opponentUserId: 'user-opp',
        dealTitle: 'Widget',
        reason: 'не пришёл товар',
      }),
    );

    expect(result.delivered).toBe(1);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Против вас открыт спор'),
      expect.objectContaining({ parseMode: 'HTML' }),
    );
  });

  it('skips recipients who have muted the event type', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-arb',
      telegramId: 99,
      telegramLanguageCode: 'en',
    });
    prefRepo.findOne.mockResolvedValue({
      id: 'pref-1',
      userId: 'user-arb',
      mutedAll: false,
      mutedEventTypes: ['dispute.arbitrator_assigned'],
      quietHoursStart: null,
      quietHoursEnd: null,
    });

    const result = await dispatcher.dispatch(
      makeEvent('dispute.arbitrator_assigned', {
        arbitratorUserId: 'user-arb',
        dealTitle: 'Foo',
        dealAmount: 100,
        decisionDueAt: '2026-01-01T00:00:00Z',
      }),
    );

    expect(result.delivered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('skips recipients without a telegramId (never registered with bot)', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-no-tg',
      telegramId: null,
      telegramLanguageCode: 'ru',
    });
    prefRepo.findOne.mockResolvedValue(null);

    const result = await dispatcher.dispatch(
      makeEvent('dispute.opened', { opponentUserId: 'user-no-tg' }),
    );

    expect(result.delivered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('escapes HTML in payload values to prevent parse_mode injection', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-opp',
      telegramId: 42,
      telegramLanguageCode: 'ru',
    });
    prefRepo.findOne.mockResolvedValue(null);

    await dispatcher.dispatch(
      makeEvent('dispute.opened', {
        opponentUserId: 'user-opp',
        dealTitle: '<script>alert(1)</script>',
        reason: 'B & B',
      }),
    );

    const [, text] = bot.sendMessage.mock.calls[0];
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;');
    expect(text).toContain('B &amp; B');
  });

  it('renders decision_made with buyer/seller-specific share amount', async () => {
    userRepo.findOne
      .mockResolvedValueOnce({
        id: 'user-buyer',
        telegramId: 11,
        telegramLanguageCode: 'ru',
      })
      .mockResolvedValueOnce({
        id: 'user-seller',
        telegramId: 22,
        telegramLanguageCode: 'ru',
      });
    prefRepo.findOne.mockResolvedValue(null);

    await dispatcher.dispatch(
      makeEvent('dispute.decision_made', {
        buyerUserId: 'user-buyer',
        sellerUserId: 'user-seller',
        dealTitle: 'Laptop',
        buyerShare: 70,
        sellerShare: 30,
      }),
    );

    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    const buyerCall = bot.sendMessage.mock.calls.find((c) => c[0] === 11);
    const sellerCall = bot.sendMessage.mock.calls.find((c) => c[0] === 22);
    expect(buyerCall[1]).toContain('70');
    expect(sellerCall[1]).toContain('30');
  });

  it('delivers deal.created to seller', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'seller-1',
      telegramId: 77,
      telegramLanguageCode: 'en',
    });
    prefRepo.findOne.mockResolvedValue(null);

    const result = await dispatcher.dispatch(
      makeEvent('deal.created', {
        sellerUserId: 'seller-1',
        buyerUserId: 'buyer-1',
        dealId: 'd-1',
        dealTitle: 'New Project',
        dealAmount: 500,
      }),
    );

    expect(result.delivered).toBe(1);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      77,
      expect.stringContaining('new deal proposal'),
      expect.objectContaining({ parseMode: 'HTML' }),
    );
  });

  it('delivers deal.cancelled to counterparty', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'cp-1',
      telegramId: 88,
      telegramLanguageCode: 'es',
    });
    prefRepo.findOne.mockResolvedValue(null);

    const result = await dispatcher.dispatch(
      makeEvent('deal.cancelled', {
        counterpartyUserId: 'cp-1',
        dealId: 'd-1',
        dealTitle: 'Project X',
        reason: 'changed mind',
      }),
    );

    expect(result.delivered).toBe(1);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      88,
      expect.stringContaining('Trato cancelado'),
      expect.objectContaining({ parseMode: 'HTML' }),
    );
  });

  it('delivers invite.accepted to buyer', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'buyer-1',
      telegramId: 33,
      telegramLanguageCode: 'ru',
    });
    prefRepo.findOne.mockResolvedValue(null);

    const result = await dispatcher.dispatch(
      makeEvent('invite.accepted', {
        buyerUserId: 'buyer-1',
        dealId: 'd-1',
        dealTitle: 'Order #5',
        dealAmount: 200,
      }),
    );

    expect(result.delivered).toBe(1);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      33,
      expect.stringContaining('Контрагент принял приглашение'),
      expect.objectContaining({ parseMode: 'HTML' }),
    );
  });
});

describe('buildDeeplinkBuilder', () => {
  // Imported at top — but ts-jest doesn't auto-hoist; require here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildDeeplinkBuilder } = require('./notification-dispatcher.service');

  it('returns null when bot username/slug missing', () => {
    const builder = buildDeeplinkBuilder({ get: () => undefined });
    expect(builder.build('deal', 'd-1')).toBeNull();
  });

  it('builds a t.me/<bot>/<slug>?startapp=<path___id> link', () => {
    const config = {
      get: (key: string) =>
        ({
          TELEGRAM_BOT_USERNAME: 'garant_bot',
          TELEGRAM_MINIAPP_SLUG: 'app',
        })[key],
    };
    const builder = buildDeeplinkBuilder(config);
    expect(builder.build('deal', 'abc-123')).toBe(
      'https://t.me/garant_bot/app?startapp=deal___abc-123',
    );
  });

  it('strips leading @ and replaces / in path', () => {
    const config = {
      get: (key: string) =>
        ({
          TELEGRAM_BOT_USERNAME: '@garant_bot',
          TELEGRAM_MINIAPP_SLUG: 'app',
        })[key],
    };
    const builder = buildDeeplinkBuilder(config);
    expect(builder.build('arbitrator/dispute', 'd1')).toBe(
      'https://t.me/garant_bot/app?startapp=arbitrator__dispute___d1',
    );
  });
});
