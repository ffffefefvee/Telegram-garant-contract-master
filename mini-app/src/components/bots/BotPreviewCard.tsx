import React from 'react';
import { Bot } from 'lucide-react';
import type { BotPreview } from '../../types/ui';
import './bots.css';

interface BotPreviewCardProps {
  bot: BotPreview;
  onClick?: () => void;
}

export const BotPreviewCard: React.FC<BotPreviewCardProps> = ({ bot, onClick }) => (
  <button type="button" className="bot-preview-card interactive-card" onClick={onClick}>
    <div className="bot-preview-card__icon">
      <Bot size={18} />
    </div>
    <div className="bot-preview-card__body">
      <span className="bot-preview-card__name">{bot.name}</span>
      <span className="bot-preview-card__meta">
        {bot.transactionCount} транзакций · {bot.status === 'active' ? 'Активен' : 'Неактивен'}
      </span>
    </div>
  </button>
);
