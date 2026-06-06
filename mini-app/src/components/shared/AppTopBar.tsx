import React from 'react';
import { useAppStore } from '../../store/appStore';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import './app-top-bar.css';

interface AppTopBarProps {
  onNotificationsClick?: () => void;
}

/** ZELENKA-style header: user pill + brand mark + actions */
export const AppTopBar: React.FC<AppTopBarProps> = ({ onNotificationsClick }) => {
  const { user } = useAppStore();
  const displayName = user?.telegramFirstName || user?.telegramUsername || 'Гость';
  const handle = user?.telegramUsername ? `@${user.telegramUsername}` : displayName;
  const initial = displayName[0]?.toUpperCase() || '?';

  return (
    <header className="app-top-bar">
      <div className="app-top-bar__user-pill">
        <span className="app-top-bar__avatar" aria-hidden>
          {initial}
        </span>
        <span className="app-top-bar__handle">{handle}</span>
      </div>
      <div className="app-top-bar__actions">
        <ThemeToggle compact />
        <NotificationBell onClick={onNotificationsClick} />
        <div className="app-top-bar__logo" aria-hidden title="Гарант">
          <span className="app-top-bar__logo-z">Z</span>
        </div>
      </div>
    </header>
  );
};
