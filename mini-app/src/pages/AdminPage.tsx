import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  AdminPaymentRow,
  AdminDealRow,
  AdminDisputeRow,
  AdminUserRow,
  AdminArbitratorRow,
  AuditLogEntry,
  AuditLogQuery,
  TreasurySummary,
} from '../api';
import './AdminPage.css';

type Tab = 'treasury' | 'payments' | 'audit' | 'deals' | 'disputes' | 'users' | 'arbitrators';

const formatToken = (raw: string, decimals: number): string => {
  // raw is a decimal string of base units (e.g. "12345600" with decimals=6 → "12.3456").
  if (!raw || raw === '0') return '0';
  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const padded = abs.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const result = fracPart ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${result}` : result;
};

const shortAddr = (addr: string): string =>
  addr && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

export const AdminPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('treasury');

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Админ-панель</h1>
        <p className="admin-subtitle">Казна, платежи и журнал аудита</p>
      </div>

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === 'treasury' ? 'active' : ''}`}
          onClick={() => setTab('treasury')}
        >
          Казна
        </button>
        <button
          className={`admin-tab ${tab === 'payments' ? 'active' : ''}`}
          onClick={() => setTab('payments')}
        >
          Платежи
        </button>
        <button
          className={`admin-tab ${tab === 'deals' ? 'active' : ''}`}
          onClick={() => setTab('deals')}
        >
          Сделки
        </button>
        <button
          className={`admin-tab ${tab === 'disputes' ? 'active' : ''}`}
          onClick={() => setTab('disputes')}
        >
          Споры
        </button>
        <button
          className={`admin-tab ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          Пользователи
        </button>
        <button
          className={`admin-tab ${tab === 'arbitrators' ? 'active' : ''}`}
          onClick={() => setTab('arbitrators')}
        >
          Арбитры
        </button>
        <button
          className={`admin-tab ${tab === 'audit' ? 'active' : ''}`}
          onClick={() => setTab('audit')}
        >
          Журнал
        </button>
      </div>

      {tab === 'treasury' && <TreasurySection />}
      {tab === 'payments' && <PaymentsSection />}
      {tab === 'deals' && <DealsSection />}
      {tab === 'disputes' && <DisputesSection />}
      {tab === 'users' && <UsersSection />}
      {tab === 'arbitrators' && <ArbitratorsSection />}
      {tab === 'audit' && <AuditSection />}
    </div>
  );
};

const TreasurySection: React.FC = () => {
  const [data, setData] = useState<TreasurySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await adminApi.getTreasurySummary();
      setData(summary);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить казну';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <div className="admin-placeholder"><p>Загрузка…</p></div>;
  }
  if (error) {
    return (
      <div className="admin-placeholder">
        <p className="admin-error">{error}</p>
        <button className="admin-link-button" onClick={load}>
          Повторить
        </button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="admin-treasury">
      {!data.ready && (
        <div className="admin-banner">
          On-chain layer is not configured (stub mode). Все балансы показаны как 0.
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-row">
          <span className="admin-card-label">Основной баланс</span>
          <span className="admin-card-value">
            {formatToken(data.main, data.decimals)}
          </span>
        </div>
        <div className="admin-card-row">
          <span className="admin-card-label">Резерв</span>
          <span className="admin-card-value">
            {formatToken(data.reserve, data.decimals)}
          </span>
        </div>
        <div className="admin-card-row">
          <span className="admin-card-label">Сырой баланс контракта</span>
          <span className="admin-card-value">
            {formatToken(data.rawTokenBalance, data.decimals)}
          </span>
        </div>
        <div className="admin-card-row">
          <span className="admin-card-label">Не разнесено (нужен reconcile)</span>
          <span className={`admin-card-value ${data.untracked !== '0' ? 'admin-warn' : ''}`}>
            {formatToken(data.untracked, data.decimals)}
          </span>
        </div>
        <div className="admin-card-row">
          <span className="admin-card-label">Доля резерва</span>
          <span className="admin-card-value">{(data.reserveBps / 100).toFixed(2)}%</span>
        </div>
      </div>

      <div className="admin-card admin-card-meta">
        <div className="admin-card-row">
          <span className="admin-card-label">Treasury</span>
          <span className="admin-card-mono" title={data.treasuryAddress}>
            {shortAddr(data.treasuryAddress)}
          </span>
        </div>
        <div className="admin-card-row">
          <span className="admin-card-label">Token</span>
          <span className="admin-card-mono" title={data.tokenAddress}>
            {shortAddr(data.tokenAddress)}
          </span>
        </div>
      </div>

      <button className="admin-link-button" onClick={load}>
        Обновить
      </button>
    </div>
  );
};

const PAGE_SIZE = 25;

const PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'completed', label: 'Оплачен' },
  { value: 'failed', label: 'Ошибка' },
  { value: 'refunded', label: 'Возврат' },
  { value: 'expired', label: 'Истёк' },
];

const formatPaymentStatus = (status: string): string => {
  const found = PAYMENT_STATUS_OPTIONS.find((o) => o.value === status);
  return found?.label ?? status;
};

const PaymentsSection: React.FC = () => {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [stuck, setStuck] = useState<AdminPaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listResult, stuckRows] = await Promise.all([
        adminApi.getPayments(page, PAGE_SIZE, statusFilter || undefined),
        adminApi.getStuckFundingPayments(20),
      ]);
      setPayments(listResult.payments);
      setTotal(listResult.total);
      setStuck(stuckRows);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить платежи';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1),
    [total],
  );

  const renderPaymentRow = (row: AdminPaymentRow) => (
    <li key={row.id} className="admin-payment-item">
      <div className="admin-audit-row">
        <span className="admin-audit-action">
          {row.amount.toLocaleString()} {row.currency}
        </span>
        <span className={`admin-payment-status status-${row.status}`}>
          {formatPaymentStatus(row.status)}
        </span>
      </div>
      <div className="admin-audit-meta">
        <span title={row.transactionId}>#{row.transactionId.slice(0, 20)}…</span>
        {row.deal && (
          <span>
            сделка #{row.deal.dealNumber ?? row.deal.id.slice(0, 8)} ({row.deal.status})
          </span>
        )}
        {row.paidAt && (
          <span>{new Date(row.paidAt).toLocaleString()}</span>
        )}
      </div>
    </li>
  );

  return (
    <div className="admin-payments">
      {stuck.length > 0 && (
        <div className="admin-stuck-section">
          <h3 className="admin-section-title">Застрявший funding</h3>
          <p className="admin-stuck-hint">
            Платёж completed, но сделка всё ещё pending_payment — нужен reconcile или ручная проверка webhook.
          </p>
          <ul className="admin-audit-list">{stuck.map(renderPaymentRow)}</ul>
        </div>
      )}

      <div className="admin-filters">
        <select
          className="admin-filter-input"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          {PAYMENT_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button className="admin-link-button" onClick={load} disabled={loading}>
          Обновить
        </button>
      </div>

      {error && (
        <div className="admin-placeholder">
          <p className="admin-error">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : payments.length === 0 ? (
        <div className="admin-placeholder"><p>Платежей пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">{payments.map(renderPaymentRow)}</ul>
      )}

      <div className="admin-pager">
        <button
          className="admin-link-button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ←
        </button>
        <span className="admin-pager-info">
          {page} / {totalPages} · всего {total}
        </span>
        <button
          className="admin-link-button"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
};

const AuditSection: React.FC = () => {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<{ action: string; aggregateType: string }>({
    action: '',
    aggregateType: '',
  });
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: AuditLogQuery = { page, limit: PAGE_SIZE };
      if (filters.action.trim()) query.action = filters.action.trim();
      if (filters.aggregateType.trim()) query.aggregateType = filters.aggregateType.trim();
      const result = await adminApi.getAuditLog(query);
      setData(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить журнал';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1),
    [total],
  );

  return (
    <div className="admin-audit">
      <div className="admin-filters">
        <input
          className="admin-filter-input"
          placeholder="action (e.g. arbitrator.approved)"
          value={filters.action}
          onChange={(e) => {
            setFilters((f) => ({ ...f, action: e.target.value }));
            setPage(1);
          }}
        />
        <input
          className="admin-filter-input"
          placeholder="aggregateType (e.g. arbitrator)"
          value={filters.aggregateType}
          onChange={(e) => {
            setFilters((f) => ({ ...f, aggregateType: e.target.value }));
            setPage(1);
          }}
        />
      </div>

      {error && (
        <div className="admin-placeholder">
          <p className="admin-error">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : data.length === 0 ? (
        <div className="admin-placeholder"><p>Записей пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">
          {data.map((entry) => (
            <li key={entry.id} className="admin-audit-item">
              <div className="admin-audit-row">
                <span className="admin-audit-action">{entry.action}</span>
                <span className="admin-audit-time">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="admin-audit-meta">
                <span>
                  {entry.aggregateType}/{entry.aggregateId.slice(0, 8)}…
                </span>
                {entry.actorRole && <span>actor: {entry.actorRole}</span>}
              </div>
              {entry.details && Object.keys(entry.details).length > 0 && (
                <pre className="admin-audit-details">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="admin-pager">
        <button
          className="admin-link-button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ←
        </button>
        <span className="admin-pager-info">
          {page} / {totalPages} · всего {total}
        </span>
        <button
          className="admin-link-button"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
};

// === A2: ADMIN DEALS ===
const DEAL_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'pending_acceptance', label: 'Ожидает принятия' },
  { value: 'pending_payment', label: 'Ожидает оплаты' },
  { value: 'in_progress', label: 'В процессе' },
  { value: 'pending_confirmation', label: 'Ожидает подтверждения' },
  { value: 'completed', label: 'Завершена' },
  { value: 'cancelled', label: 'Отменена' },
  { value: 'disputed', label: 'Спор' },
  { value: 'frozen', label: 'Заморожена' },
];

const DealsSection: React.FC = () => {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [deals, setDeals] = useState<AdminDealRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getDeals(page, PAGE_SIZE, statusFilter || undefined);
      setDeals(result.deals);
      setTotal(result.total);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить сделки';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1), [total]);

  return (
    <div className="admin-audit">
      <div className="admin-filters">
        <select
          className="admin-filter-input"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          {DEAL_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button className="admin-link-button" onClick={load} disabled={loading}>Обновить</button>
      </div>

      {error && <div className="admin-placeholder"><p className="admin-error">{error}</p></div>}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : deals.length === 0 ? (
        <div className="admin-placeholder"><p>Сделок пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">
          {deals.map((deal) => (
            <li key={deal.id} className="admin-audit-item">
              <div className="admin-audit-row">
                <span className="admin-audit-action">
                  #{deal.dealNumber ?? deal.id.slice(0, 8)}&hellip; {deal.type}
                </span>
                <span className={`admin-payment-status status-${deal.status}`}>{deal.status}</span>
              </div>
              <div className="admin-audit-meta">
                <span>{deal.amount.toLocaleString()} {deal.currency}</span>
                {deal.buyer?.telegramUsername && <span>Покуп: @{deal.buyer.telegramUsername}</span>}
                {deal.seller?.telegramUsername && <span>Прод: @{deal.seller.telegramUsername}</span>}
                <span>{new Date(deal.createdAt).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="admin-pager">
        <button className="admin-link-button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>←</button>
        <span className="admin-pager-info">{page} / {totalPages} · всего {total}</span>
        <button className="admin-link-button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>→</button>
      </div>
    </div>
  );
};

// === A3: ADMIN DISPUTES ===
const DISPUTE_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'open', label: 'Открыт' },
  { value: 'under_review', label: 'На рассмотрении' },
  { value: 'resolved', label: 'Разрешён' },
  { value: 'closed', label: 'Закрыт' },
];

const DisputesSection: React.FC = () => {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [disputes, setDisputes] = useState<AdminDisputeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getDisputes(page, PAGE_SIZE, statusFilter || undefined);
      setDisputes(result.disputes);
      setTotal(result.total);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить споры';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1), [total]);

  return (
    <div className="admin-audit">
      <div className="admin-filters">
        <select
          className="admin-filter-input"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          {DISPUTE_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button className="admin-link-button" onClick={load} disabled={loading}>Обновить</button>
      </div>

      {error && <div className="admin-placeholder"><p className="admin-error">{error}</p></div>}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : disputes.length === 0 ? (
        <div className="admin-placeholder"><p>Споров пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="admin-audit-item">
              <div className="admin-audit-row">
                <span className="admin-audit-action">{dispute.id.slice(0, 8)}…</span>
                <span className={`admin-payment-status status-${dispute.status}`}>{dispute.status}</span>
              </div>
              <div className="admin-audit-meta">
                {dispute.type && <span>Тип: {dispute.type}</span>}
                {dispute.deal && (
                  <span>Сделка #{dispute.deal.dealNumber ?? dispute.deal.id.slice(0, 8)}</span>
                )}
                {dispute.arbitrator
                  ? <span>Арбитр назначен</span>
                  : <span>Арбитр не назначен</span>
                }
                <span>{new Date(dispute.createdAt).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="admin-pager">
        <button className="admin-link-button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>←</button>
        <span className="admin-pager-info">{page} / {totalPages} · всего {total}</span>
        <button className="admin-link-button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>→</button>
      </div>
    </div>
  );
};

// === C3: ADMIN USERS (read-only) ===
const UsersSection: React.FC = () => {
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await adminApi.getUsers(page, PAGE_SIZE);
      if (Array.isArray(raw)) {
        setUsers(raw as AdminUserRow[]);
        setTotal((raw as AdminUserRow[]).length);
      } else {
        setUsers((raw as any).users ?? []);
        setTotal((raw as any).total ?? 0);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить пользователей';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1), [total]);

  return (
    <div className="admin-audit">
      <div className="admin-filters">
        <button className="admin-link-button" onClick={load} disabled={loading}>Обновить</button>
      </div>

      {error && <div className="admin-placeholder"><p className="admin-error">{error}</p></div>}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : users.length === 0 ? (
        <div className="admin-placeholder"><p>Пользователей пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">
          {users.map((u) => (
            <li key={u.id} className="admin-audit-item">
              <div className="admin-audit-row">
                <span className="admin-audit-action">
                  {u.telegramUsername ? `@${u.telegramUsername}` : (u.telegramFirstName ?? u.id.slice(0, 8))}
                </span>
                <span className={`admin-payment-status status-${u.status}`}>{u.status}</span>
              </div>
              <div className="admin-audit-meta">
                <span>Роли: {u.roles.join(', ') || '—'}</span>
                <span>Репут: {u.reputationScore}</span>
                <span>Сделок: {u.completedDeals}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="admin-pager">
        <button className="admin-link-button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>←</button>
        <span className="admin-pager-info">{page} / {totalPages} · всего {total}</span>
        <button className="admin-link-button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>→</button>
      </div>
    </div>
  );
};

// === C4: ADMIN ARBITRATORS (read-only) ===
const ArbitratorsSection: React.FC = () => {
  const [arbitrators, setArbitrators] = useState<AdminArbitratorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await adminApi.getArbitrators();
      const list = Array.isArray(raw)
        ? raw
        : (raw as any).arbitrators ?? (raw as any).items ?? [];
      setArbitrators(list);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Не удалось загрузить арбитров';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="admin-audit">
      <div className="admin-filters">
        <button className="admin-link-button" onClick={load} disabled={loading}>Обновить</button>
      </div>

      {error && <div className="admin-placeholder"><p className="admin-error">{error}</p></div>}

      {loading ? (
        <div className="admin-placeholder"><p>Загрузка…</p></div>
      ) : arbitrators.length === 0 ? (
        <div className="admin-placeholder"><p>Арбитров пока нет.</p></div>
      ) : (
        <ul className="admin-audit-list">
          {arbitrators.map((a) => (
            <li key={a.id} className="admin-audit-item">
              <div className="admin-audit-row">
                <span className="admin-audit-action">
                  {a.user?.telegramUsername ? `@${a.user.telegramUsername}` : a.userId.slice(0, 8)}
                </span>
                <span className={`admin-payment-status status-${a.status}`}>{a.status}</span>
              </div>
              <div className="admin-audit-meta">
                <span>Доступность: {a.availability}</span>
                <span>Рейтинг: {a.rating}</span>
                <span>Дел: {a.completedCases}/{a.totalCases}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
