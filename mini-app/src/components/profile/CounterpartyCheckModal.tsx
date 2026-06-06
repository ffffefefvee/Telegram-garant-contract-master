import React, { useState } from 'react';
import { Star, AlertTriangle } from 'lucide-react';
import { BottomSheet, Input, Button } from '../ui';
import { MOCK_SEARCH_USERS, type SearchUserResult } from '../../mocks/users';
import { TrustScoreBar } from './TrustScoreBar';
import './profile.css';

interface CounterpartyCheckModalProps {
  open: boolean;
  onClose: () => void;
}

function RiskWarnings({ user }: { user: SearchUserResult }) {
  const warnings: string[] = [];
  if (user.dealsCount < 3) warnings.push('Мало завершённых сделок');
  if (user.trustScore < 50) warnings.push('Низкий TrustScore');
  if (user.rating < 3 && user.dealsCount > 0) warnings.push('Низкий рейтинг отзывов');
  if (warnings.length === 0) return null;
  return (
    <div className="risk-warnings">
      {warnings.map((w) => (
        <p key={w}>
          <AlertTriangle size={14} /> {w}
        </p>
      ))}
    </div>
  );
}

export const CounterpartyCheckModal: React.FC<CounterpartyCheckModalProps> = ({
  open,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchUserResult | null>(null);

  const results = MOCK_SEARCH_USERS.filter(
    (u) =>
      !query.trim() ||
      u.username.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Проверить контрагента">
      <Input
        label="Поиск"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        placeholder="@username"
      />
      <div className="counterparty-results">
        {results.map((u) => (
          <button
            key={u.id}
            type="button"
            className={`counterparty-row ${selected?.id === u.id ? 'counterparty-row--selected' : ''}`}
            onClick={() => setSelected(u)}
          >
            <span>{u.displayName}</span>
            <span className="counterparty-row__meta">@{u.username}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="counterparty-detail slide-up">
          <TrustScoreBar score={selected.trustScore} />
          <div className="profile-rating-blocks">
            <div>
              <span>Как продавец</span>
              <p>
                <Star size={14} fill="var(--color-warning)" color="var(--color-warning)" />
                {selected.rating.toFixed(1)}/5 · {selected.dealsCount} сделок
              </p>
            </div>
          </div>
          <RiskWarnings user={selected} />
        </div>
      )}
      <Button variant="secondary" fullWidth onClick={onClose} style={{ marginTop: 16 }}>
        Закрыть
      </Button>
    </BottomSheet>
  );
};
