import clsx from 'clsx';
import './ui.css';

interface AmountDisplayProps {
  amount: number;
  currency: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AmountDisplay({ amount, currency, size = 'md', className }: AmountDisplayProps) {
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'USDT' ? 2 : 0,
    maximumFractionDigits: currency === 'USDT' ? 2 : 2,
  });

  return (
    <span className={clsx('ui-amount', `ui-amount--${size}`, className)}>
      {formatted}
      <span className="ui-amount__currency">{currency}</span>
    </span>
  );
}

interface FeeBreakdownProps {
  amount: number;
  currency: string;
  feePercent?: number;
  commissionModel?: string;
}

export function FeeBreakdown({ amount, currency, feePercent = 5, commissionModel }: FeeBreakdownProps) {
  const fee = (amount * feePercent) / 100;
  const net = amount - fee;

  return (
    <div className="fee-breakdown">
      <div className="fee-breakdown__row">
        <span>Сумма сделки</span>
        <AmountDisplay amount={amount} currency={currency} size="sm" />
      </div>
      <div className="fee-breakdown__row">
        <span>Комиссия ({feePercent}%)</span>
        <AmountDisplay amount={fee} currency={currency} size="sm" />
      </div>
      {commissionModel && (
        <div className="fee-breakdown__hint">Модель: {commissionModel}</div>
      )}
      <div className="fee-breakdown__row fee-breakdown__row--total">
        <span>Продавец получит</span>
        <AmountDisplay amount={net} currency={currency} size="sm" />
      </div>
    </div>
  );
}
