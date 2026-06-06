import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Plus, Inbox, Briefcase, Bot as BotIcon, List } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { dealsApi, storeApi } from '../api';
import { DealCard, Deal } from '../components/DealCard';
import { BotPreviewCard } from '../components/bots/BotPreviewCard';
import { AppTopBar } from '../components/shared';
import { MOCK_BOT_PREVIEWS } from '../mocks/dashboard';
import {
  Button,
  SegmentedControl,
  DealListSkeleton,
  EmptyState,
  AmountDisplay,
  Card,
} from '../components/ui';
import './DealsPage.css';

type Filter = 'active' | 'completed' | 'disputed';

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'disputed', label: 'Споры' },
];

const EMPTY_COPY: Record<Filter, { title: string; description: string }> = {
  active: {
    title: 'Нет активных сделок',
    description: 'Создайте новую сделку или примите приглашение от контрагента',
  },
  completed: {
    title: 'Завершённых сделок пока нет',
    description: 'Здесь появятся успешно закрытые сделки',
  },
  disputed: {
    title: 'Споров нет',
    description: 'Это хорошо — все сделки проходят гладко',
  },
};

const ACTION_STATUSES = ['pending_acceptance', 'pending_payment', 'pending_confirmation'];

export const DealsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const listRef = useRef<HTMLDivElement>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [botPreviews, setBotPreviews] = useState(MOCK_BOT_PREVIEWS);

  const displayName = user?.telegramFirstName || user?.telegramUsername || 'друг';

  const loadDeals = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      else setRefreshing(true);
      setError(null);
      const statusFilter =
        filter === 'active'
          ? ['pending_acceptance', 'pending_payment', 'in_progress', 'pending_confirmation']
          : filter === 'disputed'
            ? ['disputed', 'dispute_resolved', 'frozen']
            : ['completed'];
      const data = await dealsApi.getAll({ status: statusFilter, limit: 50 });
      setDeals(data.deals || []);
    } catch (err) {
      console.error('Failed to load deals:', err);
      setError('Не удалось загрузить сделки');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  useEffect(() => {
    storeApi.getMyBots().then((bots) => {
      if (bots.length > 0) {
        setBotPreviews(
          bots.slice(0, 3).map((b) => ({
            id: b.id,
            name: b.name,
            status: b.status,
            transactionCount: b.transactionCount,
          })),
        );
      }
    }).catch(() => {});
  }, []);

  const summary = useMemo(() => {
    const activeCount = deals.length;
    const escrowTotal = deals
      .filter((d) => ['pending_payment', 'in_progress', 'pending_confirmation'].includes(d.status))
      .reduce((sum, d) => sum + d.amount, 0);
    const actionRequired = deals.filter((d) => ACTION_STATUSES.includes(d.status)).length;
    return { activeCount, escrowTotal, actionRequired };
  }, [deals]);

  const emptyCopy = EMPTY_COPY[filter];

  const scrollToList = () => {
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="deals-page page-scroll fade-in">
      <AppTopBar onNotificationsClick={() => navigate('/disputes')} />
      <div className="deals-welcome-block slide-up">
        <p className="deals-welcome-label">Добро пожаловать,</p>
        <h1 className="deals-welcome-name">{displayName}</h1>
      </div>

      <div className="deals-quick-actions slide-up">
        <button type="button" className="quick-action quick-action--primary" onClick={() => navigate('/deal/new')}>
          <Plus size={20} />
          <span>Новая сделка</span>
        </button>
        <button type="button" className="quick-action" onClick={scrollToList}>
          <List size={20} />
          <span>Мои сделки</span>
        </button>
        <button type="button" className="quick-action" onClick={() => navigate('/bots/new')}>
          <BotIcon size={20} />
          <span>Создать бота</span>
        </button>
      </div>

      {botPreviews.length > 0 && (
        <section className="deals-bots-section slide-up">
          <div className="deals-section-head">
            <h2>Мои боты</h2>
            <button type="button" className="deals-link-btn" onClick={() => navigate('/bots')}>
              Все
            </button>
          </div>
          <div className="deals-bots-row">
            {botPreviews.map((bot) => (
              <BotPreviewCard key={bot.id} bot={bot} onClick={() => navigate(`/bots/${bot.id}`)} />
            ))}
          </div>
        </section>
      )}

      <div className="deals-page-header" ref={listRef}>
        <div>
          <h2 className="deals-section-title">Сделки</h2>
          <p className="deals-page-subtitle">Портфель эскроу · USDT в контракте</p>
        </div>
        <div className="deals-page-actions">
          <button
            type="button"
            className="deals-refresh-btn"
            onClick={() => loadDeals(true)}
            disabled={refreshing}
            aria-label="Обновить"
          >
            <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          </button>
          <Button variant="primary" size="sm" onClick={() => navigate('/deal/new')}>
            <Plus size={16} />
            Новая
          </Button>
        </div>
      </div>

      {!isLoading && !error && filter === 'active' && deals.length > 0 && (
        <Card className="deals-summary slide-up">
          <div className="deals-summary__grid">
            <div className="deals-summary__item">
              <span className="deals-summary__label">Активных</span>
              <span className="deals-summary__value">{summary.activeCount}</span>
            </div>
            <div className="deals-summary__item">
              <span className="deals-summary__label">В эскроу</span>
              <AmountDisplay amount={summary.escrowTotal} currency="RUB" size="sm" />
            </div>
            <div className="deals-summary__item">
              <span className="deals-summary__label">Нужно действие</span>
              <span className="deals-summary__value deals-summary__value--accent">
                {summary.actionRequired}
              </span>
            </div>
          </div>
        </Card>
      )}

      <SegmentedControl options={FILTER_OPTIONS} value={filter} onChange={setFilter} className="deals-filters" />

      {filter === 'disputed' && (
        <Button variant="ghost" size="sm" onClick={() => navigate('/disputes')} style={{ alignSelf: 'flex-start' }}>
          <Briefcase size={16} /> Все споры
        </Button>
      )}

      {isLoading && <DealListSkeleton />}

      {!isLoading && error && (
        <EmptyState
          icon={Inbox}
          title="Ошибка загрузки"
          description={error}
          actionLabel="Повторить"
          onAction={() => loadDeals()}
        />
      )}

      {!isLoading && !error && deals.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={emptyCopy.title}
          description={emptyCopy.description}
          actionLabel={filter === 'active' ? 'Создать сделку' : undefined}
          onAction={filter === 'active' ? () => navigate('/deal/new') : undefined}
        />
      )}

      {!isLoading && !error && deals.length > 0 && (
        <div className="deals-list slide-up">
          {deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              currentUserId={user?.id || ''}
              onClick={() => navigate(`/deals/${deal.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
