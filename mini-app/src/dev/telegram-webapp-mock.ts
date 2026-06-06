import type { TelegramWebApp } from '../types';

/** Browser / Playwright testing without the Telegram client. */
export function isTelegramMockEnabled(): boolean {
  return import.meta.env.VITE_TG_MOCK === 'true';
}

export function getMockTelegramUserId(): number {
  const raw = import.meta.env.VITE_MOCK_TG_USER_ID || '7124952069';
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 7124952069;
}

function getMockColorScheme(): 'light' | 'dark' {
  const raw = import.meta.env.VITE_MOCK_TG_COLOR_SCHEME;
  if (raw === 'light') return 'light';
  return 'dark';
}

/**
 * Installs `window.Telegram.WebApp` before React mounts.
 * Auth uses `POST /api/auth/dev-login` when mock is on (see useAuthBootstrap).
 */
export function installTelegramWebAppMock(): void {
  if (!isTelegramMockEnabled()) {
    return;
  }

  const userId = getMockTelegramUserId();
  const colorScheme = getMockColorScheme();
  const isDark = colorScheme === 'dark';

  const themeParams = isDark
    ? {
        bg_color: '#0a0a0a',
        text_color: '#ffffff',
        hint_color: '#9ca3af',
        link_color: '#2eb872',
        button_color: '#2eb872',
        button_text_color: '#ffffff',
        secondary_bg_color: '#1c1c1c',
      }
    : {
        bg_color: '#F7F8FA',
        text_color: '#111827',
        hint_color: '#6B7280',
        link_color: '#2563EB',
        button_color: '#2563EB',
        button_text_color: '#FFFFFF',
        secondary_bg_color: '#FFFFFF',
      };

  const noop = () => undefined;
  const handlers = new Map<string, Set<() => void>>();

  const webApp: TelegramWebApp = {
    initData: '',
    initDataUnsafe: {
      user: {
        id: userId,
        first_name: 'Test',
        last_name: 'User',
        username: 'test_user',
        language_code: 'ru',
      },
      auth_date: Math.floor(Date.now() / 1000),
    },
    themeParams,
    colorScheme,
    ready: noop,
    expand: noop,
    setHeaderColor: noop,
    setBackgroundColor: noop,
    onEvent: (eventType: string, handler: () => void) => {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, new Set());
      }
      handlers.get(eventType)!.add(handler);
    },
    offEvent: (eventType: string, handler: () => void) => {
      handlers.get(eventType)?.delete(handler);
    },
  };

  window.Telegram = { WebApp: webApp };
}
