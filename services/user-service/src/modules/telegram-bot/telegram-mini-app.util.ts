const TELEGRAM_HOST_SUFFIXES = ['t.me', 'telegram.me'];

function isTelegramHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return TELEGRAM_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function normalizeHostedMiniAppUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || isTelegramHost(parsed.hostname)) {
      return null;
    }

    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function buildTelegramMiniAppUrl(
  botUsername: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  const cleanBot = botUsername?.trim().replace(/^@/, '');
  const cleanSlug = slug?.trim() || 'app';
  if (!cleanBot) {
    return null;
  }

  return `https://t.me/${cleanBot}/${encodeURIComponent(cleanSlug)}`;
}
