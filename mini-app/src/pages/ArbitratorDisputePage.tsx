import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { arbitrationApi, type ArbitratorDisputeDetail } from '../api';
import './ArbitratorPage.css';

export const ArbitratorDisputePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ArbitratorDisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    arbitrationApi
      .getDisputeById(id)
      .then(setDetail)
      .catch((e: unknown) => {
        const msg =
          (e as { response?: { data?: { message?: string } } }).response?.data
            ?.message ?? 'Не удалось загрузить спор';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="arbitrator-page">
        <div className="arbitrator-placeholder"><p>Загрузка…</p></div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="arbitrator-page">
        <div className="arbitrator-placeholder">
          <p>{error ?? 'Спор не найден'}</p>
          <button
            onClick={() => navigate('/arbitrator')}
            style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer' }}
          >
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="arbitrator-page">
      <div className="arbitrator-header">
        <button
          onClick={() => navigate('/arbitrator')}
          style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', marginBottom: 8, fontSize: 'var(--text-sm)' }}
        >
          ← Назад
        </button>
        <h1>Спор {detail.id.slice(0, 8)}…</h1>
        <p className="arbitrator-subtitle">
          <span className={`admin-payment-status status-${detail.status}`}>{detail.status}</span>
          {detail.type && <span style={{ marginLeft: 8, color: 'var(--color-text-secondary)' }}>{detail.type}</span>}
        </p>
      </div>

      {/* Deal summary */}
      {detail.deal && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">Сделка</span>
            <span>#{detail.deal.dealNumber ?? detail.deal.id.slice(0, 8)} · {detail.deal.status}</span>
          </div>
          {detail.deal.amount != null && (
            <div className="arbitrator-availability-header" style={{ marginTop: 8 }}>
              <span className="arbitrator-availability-label">Сумма</span>
              <span>{detail.deal.amount} {detail.deal.currency}</span>
            </div>
          )}
        </section>
      )}

      {/* Reason */}
      {detail.reason && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">Причина спора</span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', marginTop: 8, color: 'var(--color-text-secondary)' }}>
            {detail.reason}
          </p>
        </section>
      )}

      {/* Evidence */}
      {detail.evidence && detail.evidence.length > 0 && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">
              Доказательства ({detail.evidence.length})
            </span>
          </div>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {detail.evidence.map((ev) => (
              <li
                key={ev.id}
                style={{
                  fontSize: 'var(--text-sm)',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{ev.name ?? ev.id.slice(0, 8)}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{ev.uploadedBy ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Timeline */}
      {detail.timeline && detail.timeline.length > 0 && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">Хронология</span>
          </div>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {detail.timeline.map((ev) => (
              <li key={ev.id} style={{ fontSize: 'var(--text-sm)', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 500 }}>{ev.title}</div>
                {ev.description && (
                  <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>{ev.description}</div>
                )}
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
                  {new Date(ev.at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Decision (read-only) */}
      {detail.decision && (
        <section className="arbitrator-availability-card">
          <div className="arbitrator-availability-header">
            <span className="arbitrator-availability-label">Решение</span>
            {detail.decision.winner && <span>{detail.decision.winner}</span>}
          </div>
          {detail.decision.comment && (
            <p style={{ fontSize: 'var(--text-sm)', marginTop: 8, color: 'var(--color-text-secondary)' }}>
              {detail.decision.comment}
            </p>
          )}
          {detail.decision.decidedAt && (
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 4, color: 'var(--color-text-tertiary)' }}>
              {new Date(detail.decision.decidedAt).toLocaleString()}
            </p>
          )}
        </section>
      )}
    </div>
  );
};
