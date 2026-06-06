import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import type { ThemePreference } from '../../theme/theme';
import './theme-toggle.css';

const CYCLE: ThemePreference[] = ['dark', 'light', 'system'];

function nextPreference(current: ThemePreference): ThemePreference {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}

interface ThemeToggleProps {
  /** Compact icon-only button for headers */
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = true }) => {
  const { preference, resolvedTheme, setPreference } = useTheme();

  const Icon =
    preference === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  const label =
    preference === 'system'
      ? 'Системная тема'
      : resolvedTheme === 'dark'
        ? 'Тёмная тема'
        : 'Светлая тема';

  const handleClick = () => {
    setPreference(nextPreference(preference));
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  if (compact) {
    return (
      <button
        type="button"
        className="theme-toggle theme-toggle--compact"
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        <Icon size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <button type="button" className="theme-toggle" onClick={handleClick} aria-label={label}>
      <Icon size={18} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
};
