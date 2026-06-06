import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, HelpCircle, LogOut, Shield, Gavel, UserSearch, Star } from 'lucide-react';
import { useAppStore, hasRole } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { WalletCard } from '../components/WalletCard';
import { ReviewList } from '../components/ReviewList';
import { TrustScoreBar } from '../components/profile/TrustScoreBar';
import { CounterpartyCheckModal } from '../components/profile/CounterpartyCheckModal';
import { Card, ListRow, Badge, Button } from '../components/ui';
import { ThemeToggle } from '../components/shared';
import { UserRole } from '../types';
import './ProfilePage.css';

const ROLE_LABELS: Record<UserRole, string> = {
  buyer: 'Покупатель',
  seller: 'Продавец',
  arbitrator: 'Арбитр',
  admin: 'Администратор',
};

const SUPPORT_BOT_URL = 'https://t.me/Garantt_antiscam_bot';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAppStore();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const [checkOpen, setCheckOpen] = useState(false);

  if (!user) {
    return (
      <div className="profile-page">
        <div className="profile-empty">Загрузка профиля…</div>
      </div>
    );
  }

  const displayName = user.telegramFirstName || user.telegramUsername || 'Пользователь';
  const trustScore = Math.min(100, Math.max(0, user.reputationScore || 0));
  const registered = new Date(user.createdAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="profile-page page-scroll">
      <Card className="profile-hero profile-hero--zelenka slide-up">
        <div className="profile-avatar profile-avatar--large">
          {displayName[0]?.toUpperCase() || '?'}
        </div>
        {user.telegramUsername && (
          <span className="profile-username profile-username--center">@{user.telegramUsername}</span>
        )}
        <p className="profile-registered">Зарегистрирован {registered}</p>

        <TrustScoreBar score={trustScore} />

        <div className="profile-rating-blocks">
          <div>
            <span>Как покупатель</span>
            <p>
              <Star size={14} fill="var(--color-warning)" color="var(--color-warning)" />
              4.5/5 · 3 отзыва
            </p>
          </div>
          <div>
            <span>Как продавец</span>
            <p>
              <Star size={14} fill="var(--color-warning)" color="var(--color-warning)" />
              4.8/5 · 12 отзывов
            </p>
          </div>
        </div>

        <div className="profile-roles">
          {user.roles.map((role) => (
            <Badge key={role} variant="info">
              {ROLE_LABELS[role] ?? role}
            </Badge>
          ))}
        </div>
      </Card>

      <Button variant="secondary" fullWidth onClick={() => setCheckOpen(true)}>
        <UserSearch size={18} /> Проверить контрагента
      </Button>

      <WalletCard />

      <Card className="profile-deals-summary">
        <div className="deals-row">
          <span>Завершено</span>
          <span className="deals-value success">{user.completedDeals || 0}</span>
        </div>
        <div className="deals-row">
          <span>Отменено</span>
          <span className="deals-value danger">{user.cancelledDeals || 0}</span>
        </div>
        <div className="deals-row">
          <span>Со спорами</span>
          <span className="deals-value warning">{user.disputedDeals || 0}</span>
        </div>
      </Card>

      <section className="profile-reviews-section">
        <h2>Последние отзывы</h2>
        <ReviewList userId={user.id} limit={5} />
      </section>

      <Card className="profile-menu">
        <ListRow
          label="Тема оформления"
          hint={resolvedTheme === 'dark' ? 'ZELENKA (тёмная)' : 'Светлая'}
          trailing={<ThemeToggle compact />}
        />
        {hasRole(user, UserRole.ARBITRATOR) && (
          <ListRow
            label="Кабинет арбитра"
            onClick={() => navigate('/arbitrator')}
            trailing={<Gavel size={18} color="var(--color-accent)" />}
          />
        )}
        {hasRole(user, UserRole.ADMIN) && (
          <ListRow
            label="Админ-панель"
            onClick={() => navigate('/admin')}
            trailing={<Shield size={18} color="var(--color-accent)" />}
          />
        )}
        <ListRow
          label="Настройки"
          onClick={() => navigate('/settings')}
          trailing={<Settings size={18} color="var(--color-accent)" />}
        />
        <ListRow
          label="Помощь"
          hint="Написать в поддержку"
          onClick={() => window.open(SUPPORT_BOT_URL, '_blank')}
          trailing={<HelpCircle size={18} color="var(--color-accent)" />}
        />
        <ListRow
          label="Выйти"
          danger
          onClick={logout}
          trailing={<LogOut size={18} color="var(--color-danger)" />}
        />
      </Card>

      <p className="profile-demo-hint">
        <Shield size={14} /> USDT в эскроу отображаются в комнате сделки, не в демо-балансе
      </p>

      <CounterpartyCheckModal open={checkOpen} onClose={() => setCheckOpen(false)} />
    </div>
  );
};
