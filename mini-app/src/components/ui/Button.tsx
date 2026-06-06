import React from 'react';
import clsx from 'clsx';
import './ui.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        loading && 'ui-btn--loading',
        fullWidth && 'ui-btn--full',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? '…' : children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={clsx('ui-page-header__back', className)} {...props}>
      {children}
    </button>
  );
}
