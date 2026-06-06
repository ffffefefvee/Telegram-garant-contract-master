import React from 'react';
import { ChevronRight } from 'lucide-react';
import './ui.css';

interface ListRowProps {
  label: string;
  hint?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  danger?: boolean;
}

export function ListRow({ label, hint, onClick, trailing, danger }: ListRowProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className="ui-list-row" onClick={onClick}>
      <div style={{ flex: 1 }}>
        <div style={{ color: danger ? 'var(--color-danger)' : undefined }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-hint)', marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
      {trailing ?? (onClick ? <ChevronRight size={18} color="var(--color-hint)" /> : null)}
    </Tag>
  );
}

export function Toggle({
  checked,
  onChange,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className="ui-toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-toggle__slider" />
    </label>
  );
}
