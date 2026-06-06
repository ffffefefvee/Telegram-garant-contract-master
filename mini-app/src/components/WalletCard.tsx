import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { usersApi } from '../api';
import { useAppStore } from '../store/appStore';
import type { User } from '../types';
import { Button, Input, Badge, ConfirmSheet, Card } from './ui';
import './WalletCard.css';

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const WalletCard: React.FC = () => {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetachSheet, setShowDetachSheet] = useState(false);

  const handleAttach = async () => {
    setError(null);
    const trimmed = input.trim();
    if (!EVM_ADDRESS_RE.test(trimmed)) {
      setError('Введите валидный EVM-адрес (0x + 40 символов)');
      return;
    }
    setSubmitting(true);
    try {
      const updated: User = await usersApi.attachWallet(trimmed);
      setUser(updated);
      setInput('');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? (err instanceof Error ? err.message : 'Не удалось привязать');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDetach = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const updated: User = await usersApi.detachWallet();
      setUser(updated);
      setShowDetachSheet(false);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? (err instanceof Error ? err.message : 'Не удалось отвязать');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <Card className="wallet-card">
        <div className="wallet-card-header">
          <div className="wallet-card-title">
            <Wallet size={18} />
            <h3>Кошелёк для выплат</h3>
          </div>
          <Badge variant={user.walletAddress ? 'success' : 'warning'}>
            {user.walletAddress ? 'Polygon' : 'Не привязан'}
          </Badge>
        </div>

        {user.walletAddress ? (
          <>
            <div className="wallet-address" title={user.walletAddress}>
              <code>{formatAddress(user.walletAddress)}</code>
            </div>
            <p className="wallet-hint">
              На этот адрес придут USDT при завершении сделок.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDetachSheet(true)}
              disabled={submitting}
            >
              Отвязать
            </Button>
          </>
        ) : (
          <>
            <p className="wallet-hint">
              Требуется для продавца и арбитра — на этот адрес будут приходить USDT-выплаты.
            </p>
            <Input
              type="text"
              placeholder="0x…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              variant="primary"
              fullWidth
              onClick={handleAttach}
              disabled={submitting || !input.trim()}
              loading={submitting}
            >
              Привязать
            </Button>
          </>
        )}

        {error && <p className="wallet-error">{error}</p>}
      </Card>

      <ConfirmSheet
        open={showDetachSheet}
        onClose={() => setShowDetachSheet(false)}
        title="Отвязать кошелёк?"
        message="На текущие сделки это не повлияет. Вы сможете привязать другой адрес позже."
        confirmLabel="Отвязать"
        danger
        loading={submitting}
        onConfirm={handleDetach}
      />
    </>
  );
};
