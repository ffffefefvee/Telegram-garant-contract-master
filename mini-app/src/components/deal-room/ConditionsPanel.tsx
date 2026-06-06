import React from 'react';
import { Check } from 'lucide-react';
import { Card } from '../ui';
import type { Deal } from '../../types';
import './deal-room.css';

interface ConditionsPanelProps {
  deal: Deal;
  isBuyer?: boolean;
}

export const ConditionsPanel: React.FC<ConditionsPanelProps> = ({ deal, isBuyer = false }) => {
  const terms = deal.terms || deal.description;
  const signed = deal.status !== 'draft' && deal.status !== 'pending_acceptance';
  const pendingAcceptance = deal.status === 'pending_acceptance';

  return (
    <Card className="conditions-panel slide-up">
      {pendingAcceptance && isBuyer && (
        <div className="contract-status-card" style={{ marginBottom: 12, padding: 12 }}>
          <div className="contract-status-card__header">
            <span className="contract-status__dot contract-status__dot--warning" />
            <span className="contract-status-card__label">Условия предложены</span>
          </div>
          <p className="contract-status-card__desc">
            Продавец предложил условия сделки. Вы можете принять их или предложить правки.
          </p>
        </div>
      )}
      <p className="deal-terms-title">{deal.title || 'Условия сделки'}</p>
      <p className="deal-terms-text" style={{ whiteSpace: 'pre-wrap' }}>
        {terms}
      </p>
      {signed && (
        <p className="conditions-panel__signed">
          <Check size={14} /> Условия согласованы
        </p>
      )}
      {deal.acceptedAt && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-hint)', marginTop: 8 }}>
          Принято: {new Date(deal.acceptedAt).toLocaleString('ru-RU')}
        </p>
      )}
      {(pendingAcceptance || canDisputeHint(deal.status)) && (
        <p className="conditions-panel__hint">
          {pendingAcceptance
            ? 'Вы можете принять условия или открыть спор, если что-то не так.'
            : 'Нажимайте «Подтвердить получение», только если получили товар — деньги уйдут продавцу.'}
        </p>
      )}
    </Card>
  );
};

function canDisputeHint(status: string): boolean {
  return status === 'pending_confirmation';
}
