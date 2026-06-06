import React, { useEffect } from 'react';
import { Button } from './Button';
import './ui.css';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-overlay" onClick={onClose} role="presentation">
      <div className="ui-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ui-sheet__handle" />
        {title && <h2 className="ui-sheet__title">{title}</h2>}
        {children}
        {footer}
      </div>
    </div>
  );
}

interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  loading,
}: ConfirmSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      <p style={{ color: 'var(--color-hint)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{message}</p>
    </BottomSheet>
  );
}

interface PromptSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  placeholder?: string;
  minLength?: number;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
}

export function PromptSheet({
  open,
  onClose,
  title,
  placeholder,
  minLength = 10,
  confirmLabel = 'Отправить',
  onSubmit,
}: PromptSheetProps) {
  const [value, setValue] = React.useState('');
  const valid = value.trim().length >= minLength;

  useEffect(() => {
    if (!open) setValue('');
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <textarea
        className="ui-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={4}
      />
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-hint)', marginTop: 8 }}>
        Минимум {minLength} символов
      </p>
      <Button
        variant="primary"
        fullWidth
        disabled={!valid}
        onClick={() => onSubmit(value.trim())}
        style={{ marginTop: 16 }}
      >
        {confirmLabel}
      </Button>
    </BottomSheet>
  );
}
