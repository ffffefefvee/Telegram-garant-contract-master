import React from 'react';
import { Lock, CheckCircle, AlertTriangle } from 'lucide-react';
import './deal-room.css';

export type ContractStatusVariant =
  | 'awaiting_payment'
  | 'funds_locked'
  | 'completed'
  | 'dispute';

const STATUS_CONFIG: Record<
  ContractStatusVariant,
  { label: string; description: string; dotClass: string; icon: React.ReactNode }
> = {
  awaiting_payment: {
    label: 'Ожидает оплаты',
    description:
      'Покупатель ещё не отправил средства. Как только он это сделает, они будут заморожены в контракте и отобразятся здесь.',
    dotClass: 'contract-status__dot--warning',
    icon: null,
  },
  funds_locked: {
    label: 'Средства заблокированы',
    description:
      'Деньги заморожены в смарт-контракте. Продавец получит их только после вашего подтверждения получения.',
    dotClass: 'contract-status__dot--success',
    icon: <Lock size={14} />,
  },
  completed: {
    label: 'Сделка завершена',
    description: 'Средства переведены продавцу. Спасибо за безопасную сделку!',
    dotClass: 'contract-status__dot--success',
    icon: <CheckCircle size={14} />,
  },
  dispute: {
    label: 'Спор открыт',
    description:
      'Арбитр изучит материалы и вынесет решение. Обычно это занимает до 24 часов.',
    dotClass: 'contract-status__dot--warning',
    icon: <AlertTriangle size={14} />,
  },
};

export function contractStatusFromDealStatus(status: string): ContractStatusVariant | null {
  switch (status) {
    case 'pending_payment':
      return 'awaiting_payment';
    case 'in_progress':
    case 'pending_confirmation':
      return 'funds_locked';
    case 'completed':
    case 'dispute_resolved':
      return 'completed';
    case 'disputed':
    case 'frozen':
      return 'dispute';
    default:
      return null;
  }
}

interface ContractStatusCardProps {
  variant: ContractStatusVariant;
}

export const ContractStatusCard: React.FC<ContractStatusCardProps> = ({ variant }) => {
  const config = STATUS_CONFIG[variant];

  return (
    <div className="contract-status-card slide-up">
      <div className="contract-status-card__header">
        <span className={`contract-status__dot ${config.dotClass}`} />
        <span className="contract-status-card__label">{config.label}</span>
        {config.icon && (
          <span className="contract-status-card__icon">{config.icon}</span>
        )}
      </div>
      <p className="contract-status-card__desc">{config.description}</p>
    </div>
  );
};
