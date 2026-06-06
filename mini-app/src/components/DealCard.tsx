import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AmountDisplay, StatusPill } from './ui';
import { DealProgressBar } from './deal/DealProgressBar';
import { DEAL_TYPE_LABELS, getStatusLabel, getStatusVariant } from '../constants/dealStatus';
import './DealCard.css';

export interface Deal {
  id: string;
  dealNumber: string;
  type: 'physical' | 'digital' | 'service' | 'rent';
  status: string;
  amount: number;
  currency: string;
  description: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  buyer: {
    id: string;
    telegramFirstName?: string;
    telegramUsername?: string;
  };
  seller?: {
    id: string;
    telegramFirstName?: string;
    telegramUsername?: string;
  };
}

interface DealCardProps {
  deal: Deal;
  currentUserId: string;
  onClick?: () => void;
}

export const DealCard: React.FC<DealCardProps> = ({ deal, currentUserId, onClick }) => {
  const otherParty = deal.buyer.id === currentUserId ? deal.seller : deal.buyer;
  const isBuyer = deal.buyer.id === currentUserId;
  const needsAction = ['pending_acceptance', 'pending_payment', 'pending_confirmation'].includes(deal.status);

  const partyInitial =
    otherParty?.telegramFirstName?.[0] ||
    otherParty?.telegramUsername?.[0]?.toUpperCase() ||
    '?';

  return (
    <article
      className={`deal-card interactive-card ${needsAction ? 'deal-card--action' : ''}`}
      data-status={deal.status}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <div className="deal-card-header">
        <span className="deal-card-number">#{deal.dealNumber}</span>
        <StatusPill variant={getStatusVariant(deal.status)} label={getStatusLabel(deal.status)} />
      </div>

      <h3 className="deal-card-title">
        {deal.title || deal.description.slice(0, 60) + (deal.description.length > 60 ? '…' : '')}
      </h3>

      <div className="deal-card-info">
        <span className="deal-card-type">{DEAL_TYPE_LABELS[deal.type] || deal.type}</span>
        <AmountDisplay amount={deal.amount} currency={deal.currency} size="md" />
      </div>

      <DealProgressBar status={deal.status} />

      <div className="deal-card-footer">
        <div className="deal-card-party">
          <span className="deal-card-avatar" aria-hidden>{partyInitial}</span>
          <div>
            <span className="deal-card-role">{isBuyer ? 'Продавец' : 'Покупатель'}</span>
            <span className="deal-card-name">
              {otherParty?.telegramFirstName || otherParty?.telegramUsername || 'Неизвестно'}
            </span>
          </div>
        </div>
        <time className="deal-card-time">
          {formatDistanceToNow(new Date(deal.updatedAt), { addSuffix: true, locale: ru })}
        </time>
      </div>
    </article>
  );
};
