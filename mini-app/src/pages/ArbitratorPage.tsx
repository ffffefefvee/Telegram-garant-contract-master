import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  arbitrationApi,
  type ArbitratorAvailability,
  type ArbitratorProfileSummary,
  type ArbitratorDisputeRow,
} from '../api';
import './ArbitratorPage.css';

const STATUS_LABEL: Record<ArbitratorProfileSummary['status'], string> = {
  active: 'Активен',
  pending: 'Ожидает одобрения',
  suspended: 'Приостановлен',
  rejected: 'Отклонён',
};

export const ArbitratorPage: React.FC = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ArbitratorProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const [disputes, setDisputes] = useState<ArbitratorDisputeRow[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputesError, setDisputesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    arbitrationApi
      .getMyProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          (e as { response?: { data?: { message?: string } } }).response?.data
            ?.message ?? 'Не удалось загрузить профиль';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDisputesLoading(true);
    setDisputesError(null);
    arbitrationApi
      .getMyDisputes()
      .then((raw) => {
        if (cancelled) return;
        const list = Array.isArray(raw)
          ? raw
          : (raw as any).disputes ?? (raw as any).items ?? [];
        setDisputes(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          (e as { response?: { data?: { message?: string } } }).response?.data
            ?.message ?? 'Не удалось загрузить споры';
        setDisputesError(msg);
      })
      .finally(() => {
        if (!cancelled) setDisputesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleAvailability = async (next: ArbitratorAvailability) => {
    if (!profile || profile.availability === next || toggling) return;
    setToggling(true);
    setError(null);
    // Optimistic update — revert if the call fails.
    const previous = profile.availability;
    setProfile({ ...profile, availability: next });
    try {
      const updated = await arbitrationApi.setMyAvailability(next);
      setProfile(updated);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? 'Не удалось изменить статус';
      setError(msg);
      setProfile({ ...profile, availability: previous });
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="arbitrator-page">
      <div className="arbitrator-header">
        <h1>Кабинет арбитра</h1>
        <p className="arbitrator-subtitle">
          Управление спорами, статус работы, выплаты
        </p>
      </div>

      {loading && (
        <div className="arbitrator-placeholder">
          <p>Загрузка профиля…</p>
        </div>
      )}

      {!loading && error && !profile && (
        <div className="arbitrator-placeholder">
          <p>{error}</p>
        </div>
      )}

      {profile && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">
              Статус профиля
            </span>
            <span
              className={`arbitrator-availability-status arbitrator-availability-status--${profile.status}`}
            >
              {STATUS_LABEL[profile.status]}
            </span>
          </div>

          <div className="arbitrator-availability-toggle">
            <span className="arbitrator-availability-label">Доступность</span>
            <div
              className="arbitrator-availability-buttons"
              role="group"
              aria-label="Доступность арбитра"
            >
              <button
                type="button"
                className={`arbitrator-availability-btn ${profile.availability === 'available' ? 'is-active' : ''}`}
                disabled={
                  toggling ||
                  profile.status !== 'active' ||
                  profile.availability === 'available'
                }
                onClick={() => handleToggleAvailability('available')}
              >
                Принимаю дела
              </button>
              <button
                type="button"
                className={`arbitrator-availability-btn ${profile.availability === 'away' ? 'is-active' : ''}`}
                disabled={
                  toggling ||
                  profile.status !== 'active' ||
                  profile.availability === 'away'
                }
                onClick={() => handleToggleAvailability('away')}
              >
                В отъезде
              </button>
            </div>
            {profile.status !== 'active' && (
              <p className="arbitrator-availability-hint">
                Управление доступностью включится, когда профиль будет одобрен
                админом.
              </p>
            )}
            {error && profile && (
              <p className="arbitrator-availability-error">{error}</p>
            )}
          </div>
        </section>
      )}

      <section className="arbitrator-disputes">
        <h2 className="arbitrator-section-title">Мои споры</h2>

        {disputesLoading && (
          <div className="arbitrator-placeholder"><p>Загрузка споров…</p></div>
        )}
        {disputesError && (
          <div className="arbitrator-placeholder">
            <p className="arbitrator-error">{disputesError}</p>
          </div>
        )}
        {!disputesLoading && !disputesError && disputes.length === 0 && (
          <div className="arbitrator-placeholder"><p>Назначенных споров нет.</p></div>
        )}

        {disputes.map((d) => (
          <div
            key={d.id}
            className="arbitrator-dispute-item"
            onClick={() => navigate(`/arbitrator/dispute/${d.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div className="arbitrator-dispute-row">
              <span className="arbitrator-dispute-id">{d.id.slice(0, 8)}…</span>
              <span className={`admin-payment-status status-${d.status}`}>{d.status}</span>
            </div>
            <div className="arbitrator-dispute-meta">
              {d.deal && <span>Сделка #{d.deal.dealNumber ?? d.deal.id.slice(0, 8)}</span>}
              {d.deal?.amount != null && <span>{d.deal.amount} {d.deal.currency}</span>}
              <span>{new Date(d.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};
