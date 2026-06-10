import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react';
import { BottomSheet, Button } from '../ui';
import { paymentsApi } from '../../api';
import { USE_UI_MOCKS } from '../../mocks/config';
import './shared.css';

export type PaymentVerifyStatus = 'checking' | 'confirmed' | 'pending' | 'failed';

interface PaymentVerifyModalProps {
  open: boolean;
  onClose: () => void;
  dealId: string;
  onVerified?: () => void;
}

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

async function mockVerifyPayment(): Promise<PaymentVerifyStatus> {
  await new Promise((r) => setTimeout(r, 1800));
  const roll = Math.random();
  if (roll > 0.55) return 'confirmed';
  if (roll > 0.25) return 'pending';
  return 'failed';
}

export const PaymentVerifyModal: React.FC<PaymentVerifyModalProps> = ({
  open,
  onClose,
  dealId,
  onVerified,
}) => {
  const [status, setStatus] = useState<PaymentVerifyStatus>('checking');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const paymentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus('checking');
    attemptsRef.current = 0;
    paymentIdRef.current = null;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Fallback to mock when no real id or mocks enabled
    if (USE_UI_MOCKS || !dealId) {
      let cancelled = false;
      mockVerifyPayment().then((result) => {
        if (!cancelled) setStatus(result);
        if (result === 'confirmed') onVerified?.();
      });
      return () => { cancelled = true; };
    }

    const poll = async () => {
      attemptsRef.current += 1;
      try {
        // The check endpoint expects a *payment* id, not a deal id —
        // resolve the latest payment for this deal once, then poll it.
        if (!paymentIdRef.current) {
          const payments = await paymentsApi.getForDeal(dealId);
          const latest = [...payments].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];
          if (!latest) {
            // No payment row yet (e.g. webhook still in flight) — keep waiting.
            if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setStatus('failed');
            } else {
              setStatus('pending');
            }
            return;
          }
          paymentIdRef.current = latest.id;
        }
        const payment = await paymentsApi.checkStatus(paymentIdRef.current);
        let result: PaymentVerifyStatus;
        if (payment.status === 'completed') {
          result = 'confirmed';
        } else if (payment.status === 'failed' || payment.status === 'expired' || payment.status === 'cancelled') {
          result = 'failed';
        } else {
          result = 'pending';
        }

        if (result !== 'pending') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setStatus(result);
          if (result === 'confirmed') onVerified?.();
        } else if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setStatus('failed');
        } else {
          setStatus('pending');
        }
      } catch {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setStatus('failed');
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [open, dealId, onVerified]);

  const content = () => {
    switch (status) {
      case 'checking':
        return (
          <>
            <Loader2 size={40} className="payment-verify-modal__spinner spinner" style={{ border: 'none' }} />
            <p>Проверяем поступление USDT на контракт…</p>
          </>
        );
      case 'confirmed':
        return (
          <>
            <CheckCircle size={48} className="payment-verify-modal__icon--ok" />
            <p><strong>Оплата подтверждена</strong></p>
            <p style={{ color: 'var(--color-hint)', fontSize: 'var(--text-sm)' }}>
              Средства зафиксированы в эскроу. Платформа не хранит ваши деньги.
            </p>
          </>
        );
      case 'pending':
        return (
          <>
            <Clock size={48} className="payment-verify-modal__icon--warn" />
            <p><strong>Ожидаем поступление</strong></p>
            <p style={{ color: 'var(--color-hint)', fontSize: 'var(--text-sm)' }}>
              Транзакция ещё не видна on-chain. Повторите проверку через минуту.
            </p>
          </>
        );
      case 'failed':
        return (
          <>
            <XCircle size={48} className="payment-verify-modal__icon--err" />
            <p><strong>Оплата не найдена</strong></p>
            <p style={{ color: 'var(--color-hint)', fontSize: 'var(--text-sm)' }}>
              Убедитесь, что платёж через Cryptomus завершён.
            </p>
          </>
        );
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Проверка оплаты"
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {status === 'pending' && (
            <Button variant="primary" fullWidth onClick={() => setStatus('checking')}>
              Проверить снова
            </Button>
          )}
          <Button variant="secondary" fullWidth onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="payment-verify-modal__status">{content()}</div>
    </BottomSheet>
  );
};
