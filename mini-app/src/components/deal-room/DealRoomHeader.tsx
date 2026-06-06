import React from 'react';
import { Shield, Plus } from 'lucide-react';
import { Button } from '../ui';
import type { Deal, User } from '../../types';
import './deal-room.css';

interface DealRoomHeaderProps {
  deal: Deal;
  onCreateDeal?: () => void;
}

function ParticipantAvatar({ user, label }: { user?: User; label: string }) {
  const name = user?.telegramFirstName || user?.telegramUsername || label;
  return (
    <div className="deal-room-header__participant">
      <div className="deal-room-header__avatar" aria-hidden>
        {name[0]?.toUpperCase() ?? '?'}
      </div>
      <span className="deal-room-header__name">{name}</span>
      <span className="deal-room-header__role">{label}</span>
    </div>
  );
}

export const DealRoomHeader: React.FC<DealRoomHeaderProps> = ({
  deal,
  onCreateDeal,
}) => {
  const isDraft = deal.status === 'draft';
  const showCreate = isDraft && onCreateDeal;

  return (
    <div className="deal-room-header slide-up">
      <div className="deal-room-header__participants">
        <ParticipantAvatar user={deal.seller} label="Продавец" />
        <div className="deal-room-header__connector" aria-hidden />
        <ParticipantAvatar user={deal.buyer} label="Покупатель" />
      </div>

      <div className="deal-room-header__footer">
        <span className="deal-room-header__badge">
          <Shield size={14} />
          Безопасная сделка
        </span>
        {showCreate && (
          <Button variant="primary" size="sm" onClick={onCreateDeal}>
            <Plus size={16} />
            Создать сделку
          </Button>
        )}
      </div>
    </div>
  );
};
