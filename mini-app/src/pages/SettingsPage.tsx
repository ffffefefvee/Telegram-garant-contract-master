import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  NOTIFICATION_EVENT_TYPES,
  NotificationPreferences,
  notificationsApi,
} from '../api';
import { useTheme } from '../hooks/useTheme';
import { ThemeToggle } from '../components/shared';
import { ThemePreference } from '../theme/theme';
import {
  PageHeader,
  Button,
  Card,
  SegmentedControl,
  Toggle,
  AmountDisplay,
  Skeleton,
} from '../components/ui';
import './SettingsPage.css';

const EVENT_LABELS: Record<string, string> = {
  'deal.created': 'Новая сделка (для продавца)',
  'deal.payment_received': 'Оплата получена в эскроу',
  'deal.completed': 'Сделка завершена',
  'deal.release_required': 'Требуется выпуск средств из эскроу',
  'deal.cancelled': 'Сделка отменена',
  'invite.accepted': 'Контрагент принял приглашение',
  'dispute.opened': 'По вашей сделке открыт спор',
  'dispute.arbitrator_assigned': 'Арбитр назначен на ваш спор',
  'dispute.decision_made': 'Принято решение по спору',
};

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function isQuietWindowDirty(prev: NotificationPreferences | null, next: {
  start: string | null;
  end: string | null;
}): boolean {
  return (prev?.quietHoursStart ?? null) !== next.start ||
    (prev?.quietHoursEnd ?? null) !== next.end;
}

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { preference, resolvedTheme, setPreference } = useTheme();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [mutedAll, setMutedAll] = useState(false);
  const [mutedEventTypes, setMutedEventTypes] = useState<Set<string>>(new Set());
  const [quietHoursOn, setQuietHoursOn] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = await notificationsApi.getPreferences();
        if (cancelled) return;
        setPrefs(fresh);
        setMutedAll(fresh.mutedAll);
        setMutedEventTypes(new Set(fresh.mutedEventTypes ?? []));
        if (fresh.quietHoursStart && fresh.quietHoursEnd) {
          setQuietHoursOn(true);
          setQuietStart(fresh.quietHoursStart);
          setQuietEnd(fresh.quietHoursEnd);
        } else {
          setQuietHoursOn(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError(extractErrorMessage(err) ?? 'Не удалось загрузить настройки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleEvent = (eventType: string) => {
    setMutedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  };

  const onSave = async () => {
    setError(null);

    if (quietHoursOn) {
      if (!isValidTime(quietStart) || !isValidTime(quietEnd)) {
        setError('Время должно быть в формате HH:MM (00:00–23:59)');
        return;
      }
      if (quietStart === quietEnd) {
        setError('Начало и конец «тихих часов» не могут совпадать');
        return;
      }
    }

    const nextStart = quietHoursOn ? quietStart : null;
    const nextEnd = quietHoursOn ? quietEnd : null;

    setSaving(true);
    try {
      const updated = await notificationsApi.updatePreferences({
        mutedAll,
        mutedEventTypes: Array.from(mutedEventTypes),
        quietHoursStart: nextStart,
        quietHoursEnd: nextEnd,
      });
      setPrefs(updated);
      setMutedAll(updated.mutedAll);
      setMutedEventTypes(new Set(updated.mutedEventTypes ?? []));
      if (updated.quietHoursStart && updated.quietHoursEnd) {
        setQuietHoursOn(true);
        setQuietStart(updated.quietHoursStart);
        setQuietEnd(updated.quietHoursEnd);
      } else {
        setQuietHoursOn(false);
      }
    } catch (err) {
      setError(extractErrorMessage(err) ?? 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!prefs &&
    (prefs.mutedAll !== mutedAll ||
      !setsEqual(new Set(prefs.mutedEventTypes ?? []), mutedEventTypes) ||
      isQuietWindowDirty(prefs, {
        start: quietHoursOn ? quietStart : null,
        end: quietHoursOn ? quietEnd : null,
      }));

  if (loading) {
    return (
      <div className="settings-page">
        <PageHeader title="Настройки" onBack={() => navigate(-1)} />
        <div className="settings-loading">
          <Skeleton height={120} />
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page page-scroll">
      <PageHeader title="Настройки" onBack={() => navigate(-1)} />

      <p className="settings-subtitle">
        Оформление и Telegram-уведомления от платформы.
      </p>

      <p className="settings-section-label">Оформление</p>
      <Card className="settings-section">
        <div className="settings-theme-row">
          <div>
            <div className="settings-row__title">Тема интерфейса</div>
            <div className="settings-row__hint">
              {resolvedTheme === 'dark'
                ? 'ZELENKA — тёмный фон с зелёным акцентом (как в Telegram)'
                : 'Светлая тема для дневного использования'}
            </div>
          </div>
        </div>
        <div className="settings-theme-control">
          <SegmentedControl
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
          />
          <div className="settings-theme-quick">
            <ThemeToggle compact={false} />
          </div>
        </div>
        <div className="settings-theme-preview" data-theme-preview={resolvedTheme}>
          <div className="settings-theme-preview__card">
            <span className="settings-theme-preview__label">Пример карточки</span>
            <AmountDisplay amount={12500} currency="RUB" size="md" />
          </div>
        </div>
      </Card>

      <p className="settings-section-label">Уведомления</p>
      <Card className="settings-section">
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__title">Полный «не беспокоить»</div>
            <div className="settings-row__hint">
              Отключает все уведомления, включая срочные про споры.
            </div>
          </div>
          <Toggle checked={mutedAll} onChange={setMutedAll} id="muted-all" />
        </div>
      </Card>

      <Card className={`settings-section ${mutedAll ? 'settings-section--disabled' : ''}`}>
        <h2 className="settings-section__title">Типы событий</h2>
        <p className="settings-section__hint">
          Снимите переключатель, чтобы заглушить отдельный тип уведомлений.
        </p>
        {NOTIFICATION_EVENT_TYPES.map((eventType) => {
          const active = !mutedEventTypes.has(eventType);
          return (
            <div key={eventType} className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__title">
                  {EVENT_LABELS[eventType] ?? eventType}
                </div>
              </div>
              <Toggle
                checked={active}
                disabled={mutedAll}
                onChange={() => toggleEvent(eventType)}
                id={`event-${eventType}`}
              />
            </div>
          );
        })}
      </Card>

      <Card className="settings-section">
        <h2 className="settings-section__title">Тихие часы</h2>
        <p className="settings-section__hint">
          В этом окне (по UTC) уведомления будут отложены до его окончания.
        </p>
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__title">Включить тихие часы</div>
          </div>
          <Toggle checked={quietHoursOn} onChange={setQuietHoursOn} id="quiet-hours" />
        </div>
        {quietHoursOn && (
          <div className="settings-quiet">
            <label className="settings-quiet__field">
              <span>С (UTC)</span>
              <input
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
              />
            </label>
            <label className="settings-quiet__field">
              <span>До (UTC)</span>
              <input
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
              />
            </label>
          </div>
        )}
      </Card>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-actions">
        <Button variant="primary" fullWidth disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Сохраняем…' : 'Сохранить уведомления'}
        </Button>
      </div>
    </div>
  );
};

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function extractErrorMessage(err: unknown): string | null {
  if (
    err &&
    typeof err === 'object' &&
    'response' in err &&
    err.response &&
    typeof err.response === 'object'
  ) {
    const data = (err as { response: { data?: unknown } }).response.data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'message' in data) {
      const msg = (data as { message?: unknown }).message;
      if (typeof msg === 'string') return msg;
      if (Array.isArray(msg) && msg.every((m) => typeof m === 'string')) {
        return msg.join(', ');
      }
    }
  }
  if (err instanceof Error) return err.message;
  return null;
}
