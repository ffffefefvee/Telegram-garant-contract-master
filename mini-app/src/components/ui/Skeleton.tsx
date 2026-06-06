import React from 'react';
import clsx from 'clsx';
import './ui.css';

export function Skeleton({ height = 16, width = '100%', className }: { height?: number; width?: number | string; className?: string }) {
  return (
    <div
      className={clsx('ui-skeleton', className)}
      style={{ height, width }}
      aria-hidden
    />
  );
}

export function DealListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} height={120} />
      ))}
    </div>
  );
}
