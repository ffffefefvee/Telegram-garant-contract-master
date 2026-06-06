import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { disputesApi, arbitrationApi } from '../api';
import type { DisputeDetail } from '../types/disputes';
import { PageHeader, Card, StatusPill, Button, AmountDisplay } from '../components/ui';
import './DisputeDetailPage.css';

export const DisputeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setUploadError(null);
    try {
      await arbitrationApi.uploadEvidence(id, file);
      const updated = await disputesApi.getById(id);
      setDetail(updated);
    } catch {
      setUploadError('Не удалось загрузить файл');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (!id) return;
    disputesApi
      .getById(id)
      .then(setDetail)
      .catch(() => setError(true));
  }, [id]);

  if (error || !detail) {
    return (
      <div className="dispute-detail page-scroll">
        <PageHeader title="Спор" onBack={() => navigate('/disputes')} />
        <p style={{ padding: 16, color: 'var(--color-hint)' }}>
          {error ? 'Не удалось загрузить' : 'Загрузка…'}
        </p>
      </div>
    );
  }

  const statusLabel =
    detail.status === 'in_review' ? 'Идёт рассмотрение' : 'Решён';

  return (
    <div className="dispute-detail page-scroll">
      <PageHeader title={`Спор #${detail.dealNumber}`} onBack={() => navigate('/disputes')} />

      <div className="dispute-detail__body">
        <Card className="slide-up">
          <StatusPill
            variant={detail.status === 'in_review' ? 'warning' : 'success'}
            label={statusLabel}
          />
          <AmountDisplay amount={detail.amount} currency={detail.currency} size="lg" />
          <p className="dispute-detail__usdt">≈ {detail.usdtAmount} USDT</p>
          <p className="dispute-detail__reason"><strong>Причина:</strong> {detail.reason}</p>
        </Card>

        <section className="dispute-timeline slide-up">
          <h2>Хронология</h2>
          <ul>
            {detail.timeline.map((ev) => (
              <li key={ev.id} className="dispute-timeline__item">
                <span className="dispute-timeline__dot" />
                <div>
                  <strong>{ev.title}</strong>
                  {ev.description && <p>{ev.description}</p>}
                  <time>{new Date(ev.at).toLocaleString('ru-RU')}</time>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="slide-up">
          <h2>Доказательства</h2>
          {detail.evidence.length > 0 && (
            <div className="dispute-evidence-grid">
              {detail.evidence.map((ev) => (
                <Card key={ev.id} className="dispute-evidence-item">
                  <span>{ev.name}</span>
                  <span className="dispute-evidence-meta">
                    {ev.uploadedBy === 'buyer' ? 'Покупатель' : 'Продавец'}
                  </span>
                </Card>
              ))}
            </div>
          )}
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Добавить доказательство
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              disabled={uploading}
              onChange={handleUpload}
              style={{ display: 'block', marginTop: 8, fontSize: 'var(--text-xs)' }}
            />
            {uploading && <p style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>Загрузка…</p>}
            {uploadError && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginTop: 4 }}>{uploadError}</p>}
          </label>
        </section>

        {detail.decision && (
          <Card className="dispute-decision slide-up">
            <h2>Решение арбитра</h2>
            <p>
              В пользу{' '}
              <strong>{detail.decision.winner === 'buyer' ? 'покупателя' : 'продавца'}</strong>
            </p>
            <p className="dispute-decision__comment">{detail.decision.comment}</p>
            <time>{new Date(detail.decision.decidedAt).toLocaleString('ru-RU')}</time>
          </Card>
        )}

        <Button variant="secondary" fullWidth onClick={() => navigate(`/deals/${detail.dealId}`)}>
          Открыть сделку
        </Button>
      </div>
    </div>
  );
};
