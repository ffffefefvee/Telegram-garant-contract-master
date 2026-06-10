import React from 'react';
import clsx from 'clsx';
import './ui.css';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  elevated?: boolean;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, elevated = false, className, onClick, ...rest }: CardProps) {
  return (
    <div
      className={clsx('ui-card', elevated && 'ui-card--elevated', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Surface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('ui-card', 'ui-card--elevated', className)}>{children}</div>;
}
