import React, { useEffect, useRef, useState } from 'react';
import { Star, AlertTriangle } from 'lucide-react';
import { BottomSheet, Input, Button } from '../ui';
import { usersApi } from '../../api';
import { MOCK_SEARCH_USERS, type SearchUserResult } from '../../mocks/users';
import { USE_UI_MOCKS } from '../../mocks/config';
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

const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

export const CounterpartyCheckModal: React.FC<CounterpartyCheckModalProps> = ({
  open,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchUserResult | null>(null);
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = query.trim().replace(/^@/, '');

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (USE_UI_MOCKS) {
      setResults(
        MOCK_SEARCH_USERS.filter((u) =>
          u.username.toLowerCase().includes(trimmed.toLowerCase()),
        ),
      );
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await usersApi.search(trimmed);
        setResults(
          res.users.map((u) => ({
            id: u.id,
            username: u.telegramUsername ?? u.id,
            displayName: u.telegramFirstName ?? u.telegramUsername ?? 'User',
            dealsCount: u.completedDeals ?? 0,
            // Backend exposes a single 0–100 reputation score; map it onto
            // both the trust bar (as-is) and a 5-star scale for display.
            rating: Math.round(((u.reputationScore ?? 0) / 20) * 10) / 10,
            trustScore: u.reputationScore ?? 0,
          })),
        );
      } catch {
        setResults([]);
        setError('Не удалось выполнить поиск');
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

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
        {loading && <p className="deal-new-hint">Поиск…</p>}
        {error && <p className="deal-new-hint">{error}</p>}
        {!loading && !error && results.length === 0 &&
          query.trim().length >= MIN_QUERY_LENGTH && (
            <p className="deal-new-hint">Никого не нашли</p>
          )}
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
