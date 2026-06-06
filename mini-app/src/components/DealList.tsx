import React from 'react';
import { Deal } from '../../types';
import { DealCard } from './DealCard';
import './DealList.css';

interface DealListProps {
  deals: Deal[];
  onDealClick?: (deal: Deal) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

export const DealList: React.FC<DealListProps> = ({
  deals,
  onDealClick,
  isLoading = false,
  emptyMessage = 'Нет сделок',
}) => {
  if (isLoading) {
    return (
      <div className="deal-list-loading">
        <div className="spinner"></div>
        <p>Загрузка сделок...</p>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="deal-list-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="deal-list">
      {deals.map((deal) => (
        <DealCard
          key={deal.id}
          deal={deal}
          onClick={() => onDealClick?.(deal)}
        />
      ))}
    </div>
  );
};
