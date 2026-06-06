import React from 'react';
import { Star } from 'lucide-react';
import { Button, Card } from '../ui';
import { ContractAddress } from '../shared';
import './deal-room.css';

interface DealCompletedCardProps {
  txHash?: string;
  onLeaveReview?: () => void;
}

export const DealCompletedCard: React.FC<DealCompletedCardProps> = ({
  txHash,
  onLeaveReview,
}) => (
  <Card className="deal-completed-card slide-up">
    <p className="deal-completed-card__title">Сделка завершена</p>
    <p className="deal-completed-card__desc">
      Средства переведены продавцу. Спасибо за безопасную сделку!
    </p>
    {txHash && (
      <div className="deal-completed-card__tx">
        <ContractAddress address={txHash} label="Хеш транзакции" />
      </div>
    )}
    {onLeaveReview && (
      <Button variant="secondary" fullWidth onClick={onLeaveReview}>
        <Star size={16} />
        Оставить отзыв
      </Button>
    )}
  </Card>
);
