import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Bot } from 'lucide-react';
import { storeApi } from '../api';
import type { BotItem } from '../mocks/bots';
import { Button, Card, EmptyState, Badge, useToast } from '../components/ui';
import './BotsPage.css';

export const BotsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [bots, setBots] = useState<BotItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storeApi.getMyBots().then(setBots).finally(() => setLoading(false));
  }, []);

  return (
    <div className="bots-page page-scroll fade-in">
      <header className="bots-page__header">
        <div>
          <h1>Мои боты</h1>
          <p className="bots-page__sub">Конструктор магазинов в Telegram</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/bots/new')}>
          <Plus size={16} /> Создать
        </Button>
      </header>

      {loading && <p className="bots-page__loading">Загрузка…</p>}

      {!loading && bots.length === 0 && (
        <EmptyState
          icon={Bot}
          title="Ботов пока нет"
          description="Создайте бота для автоматизации сделок через гарант"
          actionLabel="Создать бота"
          onAction={() => navigate('/bots/new')}
        />
      )}

      <div className="bots-grid">
        {bots.map((bot) => (
          <Card key={bot.id} className="bot-card-full interactive-card slide-up">
            <div className="bot-card-full__head">
              <h3>{bot.name}</h3>
              <Badge variant={bot.status === 'active' ? 'success' : 'neutral'}>
                {bot.status === 'active' ? 'Активен' : 'Неактивен'}
              </Badge>
            </div>
            <p className="bot-card-full__desc">{bot.description}</p>
            <p className="bot-card-full__meta">{bot.transactionCount} транзакций</p>
            <div className="bot-card-full__actions">
              <Button variant="secondary" size="sm" onClick={() => navigate(`/bots/${bot.id}`)}>
                Редактировать
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/bots/${bot.id}/stats`)}>
                Статистика
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  showToast('Бот будет остановлен после подключения API');
                  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
                }}
              >
                Остановить
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
