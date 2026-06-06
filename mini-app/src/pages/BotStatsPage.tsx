import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { storeApi } from '../api';
import type { BotItem } from '../mocks/bots';
import { PageHeader, Card } from '../components/ui';
import './BotStatsPage.css';

export const BotStatsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [bot, setBot] = useState<BotItem | null>(null);

  useEffect(() => {
    if (!id) return;
    storeApi.getBot(id).then(setBot);
  }, [id]);

  if (!bot) {
    return (
      <div className="bot-stats page-scroll">
        <PageHeader title="Статистика" onBack={() => navigate('/bots')} />
        <p style={{ padding: 16 }}>Загрузка…</p>
      </div>
    );
  }

  const maxVal = Math.max(...bot.weeklyStats.map((s) => s.value), 1);

  return (
    <div className="bot-stats page-scroll">
      <PageHeader title={bot.name} onBack={() => navigate(`/bots/${bot.id}`)} />

      <div className="bot-stats__body slide-up">
        <Card>
          <div className="bot-stats__row">
            <span>Объём сделок</span>
            <strong>{bot.totalVolumeRub.toLocaleString('ru-RU')} ₽</strong>
          </div>
          <div className="bot-stats__row">
            <span>Успешных</span>
            <strong className="text-success">{bot.successfulDeals}</strong>
          </div>
          <div className="bot-stats__row">
            <span>Спорных</span>
            <strong className="text-danger">{bot.disputedDeals}</strong>
          </div>
        </Card>

        <h2>Активность за неделю</h2>
        <div className="bot-stats-chart">
          {bot.weeklyStats.map((s) => (
            <div key={s.label} className="bot-stats-chart__col">
              <div
                className="bot-stats-chart__bar"
                style={{ height: `${(s.value / maxVal) * 100}%` }}
                title={`${s.value}`}
              />
              <span className="bot-stats-chart__label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
