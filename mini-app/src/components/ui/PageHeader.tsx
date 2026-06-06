import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { IconButton } from './Button';
import './ui.css';

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  action?: React.ReactNode;
}

export function PageHeader({ title, onBack, action }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      {onBack ? (
        <IconButton onClick={onBack} aria-label="Назад">
          <ChevronLeft size={22} />
        </IconButton>
      ) : (
        <span style={{ width: 36 }} />
      )}
      <h1 className="ui-page-header__title">{title}</h1>
      {action || <span style={{ width: 36 }} />}
    </header>
  );
}
