import { useEffect, useState } from 'react';
import { TelegramWebApp } from '../types';

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}

export function useTelegramWebApp() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [initData, setInitData] = useState<string>('');
  const [user, setUser] = useState<{
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  } | null>(null);

  useEffect(() => {
    // Initialize Telegram WebApp
    const tg = window.Telegram?.WebApp;

    if (tg) {
      setWebApp(tg);
      setInitData(tg.initData);

      // Store init data for API calls
      sessionStorage.setItem('telegram_init_data', tg.initData);

      // Get user data
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user);
      }

      // Ready signal
      tg.ready();

      // Expand to full height
      tg.expand();

      // Set header color
      tg.setHeaderColor(tg.themeParams.bg_color || '#ffffff');

      // Set background color
      tg.setBackgroundColor(tg.themeParams.secondary_bg_color || '#f4f4f5');

      // Theme change handler
      const handleThemeChange = () => {
        setWebApp({ ...tg });
      };

      tg.onEvent('themeChanged', handleThemeChange);

      return () => {
        tg.offEvent('themeChanged', handleThemeChange);
      };
    }
  }, []);

  const isDarkMode = webApp?.colorScheme === 'dark';
  const themeParams = webApp?.themeParams || {};

  return {
    webApp,
    initData,
    user,
    isDarkMode,
    themeParams,
    haptic: webApp?.HapticFeedback,
    mainButton: webApp?.MainButton,
    backButton: webApp?.BackButton,
  };
}
