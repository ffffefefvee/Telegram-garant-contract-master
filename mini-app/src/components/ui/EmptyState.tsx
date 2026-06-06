import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import './ui.css';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {Icon && <Icon className="ui-empty__icon" size={48} strokeWidth={1.25} />}
      <h3 className="ui-empty__title">{title}</h3>
      {description && <p className="ui-empty__text">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
