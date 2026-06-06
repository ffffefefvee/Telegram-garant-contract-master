import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { disputesApi } from '../api';
import type { DisputeListItem } from '../mocks/disputes';
import { Card, EmptyState, StatusPill, AmountDisplay } from '../components/ui';
import './DisputesPage.css';

const STATUS_LABELS = {
  in_review: { label: 'Идёт рассмотрение', variant: 'warning' as const },
  resolved: { label: 'Решён', variant: 'success' as const },
};

export const DisputesPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<DisputeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    disputesApi
      .list()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="disputes-page page-scroll fade-in">
      <header className="disputes-page__header">
        <h1>Споры</h1>
        <p className="disputes-page__sub">Арбитраж платформы · прозрачное решение</p>
      </header>

      {loading && <p className="disputes-page__loading">Загрузка…</p>}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={Scale}
          title="Споров нет"
          description="При возникновении проблемы откройте спор из комнаты сделки"
        />
      )}

      <div className="disputes-list">
        {items.map((d) => {
          const st = STATUS_LABELS[d.status];
          return (
            <Card
              key={d.id}
              className="dispute-list-card interactive-card slide-up"
              onClick={() => navigate(`/disputes/${d.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/disputes/${d.id}`)}
            >
              <div className="dispute-list-card__top">
                <span>#{d.dealNumber}</span>
                <StatusPill variant={st.variant} label={st.label} />
              </div>
              <p className="dispute-list-card__party">{d.counterpartyName}</p>
              <div className="dispute-list-card__bottom">
                <AmountDisplay amount={d.amount} currency={d.currency} size="sm" />
                <time>{new Date(d.openedAt).toLocaleDateString('ru-RU')}</time>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
