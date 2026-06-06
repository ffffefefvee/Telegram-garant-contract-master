export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'garant_theme_preference';

export const THEME_COLORS = {
  light: {
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    text: '#111827',
    header: '#F7F8FA',
    accent: '#2563EB',
  },
  dark: {
    bg: '#0a0a0a',
    surface: '#1c1c1c',
    surfaceElevated: '#262626',
    text: '#FFFFFF',
    header: '#0a0a0a',
    accent: '#2eb872',
  },
} as const;

const TG_THEME_INLINE_KEYS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-elevated',
  '--color-text',
  '--color-hint',
  '--color-link',
  '--color-accent',
  '--color-accent-text',
  '--tg-theme-button-color',
] as const;

/** Remove inline theme overrides so CSS [data-theme] tokens take effect */
export function clearTelegramThemeOverrides(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of TG_THEME_INLINE_KEYS) {
    root.style.removeProperty(key);
  }
}

/** Apply full app palette for an explicit light/dark preference */
export function applyThemeColors(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const colors = THEME_COLORS[resolved];
  root.style.setProperty('--color-bg', colors.bg);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-surface-elevated', colors.surfaceElevated);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-link', colors.accent);
  root.style.setProperty(
    '--color-accent-soft',
    resolved === 'dark' ? 'rgba(46, 184, 114, 0.14)' : 'rgba(37, 99, 235, 0.12)',
  );
  root.style.setProperty('--color-accent-text', '#FFFFFF');
}

/** Apply Telegram WebApp themeParams as CSS overrides when present */
export function applyTelegramThemeParams(params?: {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}): void {
  if (!params || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (params.bg_color) root.style.setProperty('--color-bg', params.bg_color);
  if (params.secondary_bg_color) {
    root.style.setProperty('--color-surface', params.secondary_bg_color);
    root.style.setProperty('--color-surface-elevated', params.secondary_bg_color);
  }
  if (params.text_color) root.style.setProperty('--color-text', params.text_color);
  if (params.hint_color) root.style.setProperty('--color-hint', params.hint_color);
  if (params.link_color) root.style.setProperty('--color-link', params.link_color);
  if (params.button_color) {
    root.style.setProperty('--color-accent', params.button_color);
    root.style.setProperty('--tg-theme-button-color', params.button_color);
  }
  if (params.button_text_color) {
    root.style.setProperty('--color-accent-text', params.button_text_color);
  }
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function resolveTheme(
  preference: ThemePreference,
  telegramScheme?: 'light' | 'dark',
): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  if (telegramScheme === 'dark' || telegramScheme === 'light') {
    return telegramScheme;
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}
