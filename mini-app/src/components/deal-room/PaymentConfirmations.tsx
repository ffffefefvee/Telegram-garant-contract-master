import React from 'react';
import { Clock } from 'lucide-react';
import './deal-room.css';

interface PaymentConfirmationsProps {
  current: number;
  total: number;
}

export const PaymentConfirmations: React.FC<PaymentConfirmationsProps> = ({
  current,
  total,
}) => {
  const pct = Math.min(100, Math.round((current / total) * 100));

  return (
    <div className="payment-confirmations slide-up">
      <div className="payment-confirmations__header">
        <span className="payment-confirmations__title">
          Подтверждений: {current}/{total}
        </span>
      </div>
      <div className="payment-confirmations__bar" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={total}>
        <div
          className="payment-confirmations__bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="payment-confirmations__hint">
        <Clock size={14} />
        Сеть проверяет платёж. Обычно это занимает 2–5 минут
      </p>
    </div>
  );
};
