import { buildTelegramMiniAppUrl, normalizeHostedMiniAppUrl } from './telegram-mini-app.util';

describe('telegram-mini-app.util', () => {
  it('accepts hosted https mini-app urls and strips trailing slash/hash', () => {
    expect(normalizeHostedMiniAppUrl('https://mini.example.com/app/#fragment')).toBe(
      'https://mini.example.com/app',
    );
  });

  it('rejects telegram deeplinks as hosted web app urls', () => {
    expect(normalizeHostedMiniAppUrl('https://t.me/garant_bot/app')).toBeNull();
    expect(normalizeHostedMiniAppUrl('https://telegram.me/garant_bot/app')).toBeNull();
  });

  it('builds telegram mini-app deeplink from username and slug', () => {
    expect(buildTelegramMiniAppUrl('@garant_bot', 'app')).toBe('https://t.me/garant_bot/app');
  });
});
