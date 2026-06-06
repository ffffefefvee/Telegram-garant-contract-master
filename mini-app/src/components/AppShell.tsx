import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { useTelegramWebApp } from '../hooks/useTelegramWebApp';

const TAB_ROUTES = ['/deals', '/bots', '/disputes', '/profile'] as const;

function isFocusMode(pathname: string): boolean {
  if (pathname === '/deal/new' || pathname === '/settings') return true;
  if (pathname.startsWith('/bots/')) return true;
  if (/^\/disputes\/[^/]+/.test(pathname)) return true;
  if (pathname.startsWith('/arbitrator') || pathname.startsWith('/admin')) return true;
  if (/^\/deals\/[^/]+$/.test(pathname) && pathname !== '/deals/new') return true;
  if (/^\/deal\/[^/]+$/.test(pathname)) return true;
  return false;
}

function isTabMode(pathname: string): boolean {
  return (TAB_ROUTES as readonly string[]).includes(pathname);
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { backButton } = useTelegramWebApp();

  const focusMode = isFocusMode(location.pathname);
  const showNav = isTabMode(location.pathname) && !focusMode;

  useEffect(() => {
    if (!backButton) return;

    if (focusMode) {
      backButton.show();
      const handler = () => {
        if (location.pathname === '/settings') {
          navigate('/profile');
        } else if (location.pathname.startsWith('/bots')) {
          navigate('/bots');
        } else if (location.pathname.startsWith('/disputes')) {
          navigate('/disputes');
        } else if (location.pathname.includes('/deal')) {
          navigate('/deals');
        } else {
          navigate(-1);
        }
      };
      backButton.onClick(handler);
      return () => {
        backButton.offClick(handler);
        backButton.hide();
      };
    }

    backButton.hide();
    return undefined;
  }, [focusMode, location.pathname, navigate, backButton]);

  return (
    <div className="app-container">
      <main className={`app-main ${showNav ? 'app-main--with-nav' : ''}`}>
        {children}
      </main>
      {showNav && <BottomNav />}
    </div>
  );
}
