import React from 'react';
import clsx from 'clsx';
import './ui.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return <span className={clsx('ui-badge', `ui-badge--${variant}`, className)}>{children}</span>;
}

export function StatusPill({ variant, label }: { variant: BadgeVariant; label: string }) {
  return <Badge variant={variant}>{label}</Badge>;
}
