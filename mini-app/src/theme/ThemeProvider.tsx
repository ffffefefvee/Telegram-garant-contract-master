import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTelegramWebApp } from '../hooks/useTelegramWebApp';
import { ThemeContext } from './ThemeContext';
import {
  readThemePreference,
  resolveTheme,
  THEME_COLORS,
  ThemePreference,
  writeThemePreference,
  applyTelegramThemeParams,
  clearTelegramThemeOverrides,
} from './theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { webApp } = useTelegramWebApp();
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference());

  const telegramScheme = webApp?.colorScheme as 'light' | 'dark' | undefined;
  const resolvedTheme = resolveTheme(preference, telegramScheme);
  const isDark = resolvedTheme === 'dark';

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(next);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    clearTelegramThemeOverrides();

    if (preference === 'system') {
      applyTelegramThemeParams(webApp?.themeParams);
    }

    const colors = THEME_COLORS[resolvedTheme];

    if (webApp) {
      webApp.setHeaderColor(colors.header);
      webApp.setBackgroundColor(colors.bg);
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', colors.bg);
    }
  }, [resolvedTheme, webApp, preference]);

  useEffect(() => {
    if (preference !== 'system') return;
    const handler = () => {
      setPreferenceState((prev) => (prev === 'system' ? 'system' : prev));
    };
    webApp?.onEvent('themeChanged', handler);
    return () => webApp?.offEvent('themeChanged', handler);
  }, [preference, webApp]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference, isDark }),
    [preference, resolvedTheme, setPreference, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
