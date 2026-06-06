import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Key,
  FileText,
  Monitor,
  RefreshCw,
  Share2,
  type LucideIcon,
} from 'lucide-react';
import { dealsApi, usersApi } from '../api';
import {
  PageHeader,
  Button,
  Card,
  Input,
  Textarea,
  SegmentedControl,
  FeeBreakdown,
  useToast,
} from '../components/ui';
import { ContractAddress } from '../components/shared';
import { fiatToUsdt, type SearchUserResult } from '../mocks/users';
import { Star } from 'lucide-react';
import './DealNewPage.css';

type Step = 'category' | 'details' | 'counterparty' | 'price' | 'commission' | 'confirm' | 'done';

export const DIGITAL_SUBCATEGORIES = [
  { id: 'account', label: 'Аккаунт', hint: 'Логин, доступ, передача учётной записи', icon: User },
  { id: 'key_code', label: 'Ключ / код', hint: 'Лицензия, промокод, ключ активации', icon: Key },
  { id: 'file', label: 'Цифровой файл', hint: 'Файл, архив, материалы для скачивания', icon: FileText },
  { id: 'online_service', label: 'Онлайн-услуга', hint: 'Работа, консультация, выполнение задачи', icon: Monitor },
  { id: 'subscription_transfer', label: 'Перенос подписки', hint: 'Передача подписки или слота', icon: RefreshCw },
] as const;

type DigitalSubtype = (typeof DIGITAL_SUBCATEGORIES)[number]['id'];

const COMMISSION_OPTIONS = [
  { id: 'buyer' as const, label: 'Комиссию платит покупатель', note: '+5% к сумме сделки' },
  { id: 'seller' as const, label: 'Комиссию платит продавец', note: '−5% от выплаты продавцу' },
  { id: 'split' as const, label: 'Пополам (50/50)', note: '2,5% с каждой стороны' },
];

const STEP_LABELS: Record<Exclude<Step, 'done'>, string> = {
  category: '1/6',
  details: '2/6',
  counterparty: '3/6',
  price: '4/6',
  commission: '5/6',
  confirm: '6/6',
};

function parseAmount(raw: string): number | null {
  const parsed = parseFloat(raw.replace(',', '.').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const DealNewPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('category');
  const [subtype, setSubtype] = useState<DigitalSubtype | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'RUB' | 'USDT'>('RUB');
  const [commissionModel, setCommissionModel] = useState<'buyer' | 'seller' | 'split'>('buyer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [counterpartyQuery, setCounterpartyQuery] = useState('');
  const [selectedCounterparty, setSelectedCounterparty] = useState<SearchUserResult | null>(null);
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!counterpartyQuery.trim() || counterpartyQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await usersApi.search(counterpartyQuery.trim());
        setSearchResults(
          res.users.map((u: any) => ({
            id: u.id,
            username: u.telegramUsername ?? u.id,
            displayName: u.telegramFirstName ?? u.telegramUsername ?? 'User',
            dealsCount: u.completedDeals ?? 0,
            rating: u.reputationScore ?? 0,
            trustScore: u.reputationScore ?? 0,
          })),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [counterpartyQuery]);

  const subtypeMeta = DIGITAL_SUBCATEGORIES.find((c) => c.id === subtype);
  const parsedAmount = parseAmount(amount);
  const showSummary = step === 'price' || step === 'commission' || step === 'confirm';
  const usdtPreview = parsedAmount !== null ? fiatToUsdt(parsedAmount, currency) : null;

  const commissionLabel = useMemo(
    () => COMMISSION_OPTIONS.find((o) => o.id === commissionModel)?.label,
    [commissionModel],
  );

  const handleCreate = async () => {
    if (!subtype || !description.trim() || parsedAmount === null) {
      setError('Заполните все поля корректно');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const deal = await dealsApi.create({
        type: 'digital',
        amount: parsedAmount,
        description: description.trim(),
        title: title.trim() || subtypeMeta?.label,
        terms: deliveryNote.trim() || undefined,
        currency,
        metadata: {
          digitalSubtype: subtype,
          commissionModel,
          quoteCurrency: currency,
          counterpartyUsername: selectedCounterparty?.username,
        },
      });

      const invite = await dealsApi.createInvite(deal.id);
      setInviteUrl(invite.inviteUrl);
      setCreatedDealId(deal.id);
      const addr =
        deal.escrowAddress ??
        deal.metadata?.escrowAddress ??
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      setEscrowAddress(addr);
      setStep('done');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      console.error(e);
      setError('Не удалось создать сделку. Проверьте сумму и попробуйте снова.');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Ссылка скопирована');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch {
      showToast('Не удалось скопировать');
    }
  };

  const shareInvite = () => {
    if (!inviteUrl) return;
    const text = encodeURIComponent(`Приглашение в сделку: ${inviteUrl}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${text}`, '_blank');
  };

  const renderOptionCard = (
    id: string,
    label: string,
    note: string,
    Icon: LucideIcon,
    selected: boolean,
    onSelect: () => void,
  ) => (
    <button
      key={id}
      type="button"
      className={`deal-new-option ${selected ? 'deal-new-option--selected' : ''}`}
      onClick={onSelect}
    >
      <span className="deal-new-option__icon">
        <Icon size={20} />
      </span>
      <span className="deal-new-option__body">
        <strong>{label}</strong>
        <span>{note}</span>
      </span>
    </button>
  );

  return (
    <div className="deal-new-page">
      <PageHeader
        title="Новая сделка"
        onBack={() => navigate('/deals')}
        action={
          <span className="deal-new-step-badge">
            {step !== 'done' ? STEP_LABELS[step as Exclude<Step, 'done'>] : '✓'}
          </span>
        }
      />

      {error && <p className="deal-new-error">{error}</p>}

      <div className="deal-new-content page-scroll">
        {step === 'category' && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">Цифровой товар — выберите подкатегорию:</p>
            <div className="deal-new-options">
              {DIGITAL_SUBCATEGORIES.map((item) =>
                renderOptionCard(item.id, item.label, item.hint, item.icon, subtype === item.id, () =>
                  setSubtype(item.id),
                ),
              )}
            </div>
            <Button variant="primary" fullWidth disabled={!subtype} onClick={() => setStep('details')}>
              Далее
            </Button>
          </section>
        )}

        {step === 'details' && subtypeMeta && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">{subtypeMeta.label}</p>
            <Input label="Название (необязательно)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Кратко о товаре" />
            <Textarea
              label="Описание сделки *"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что передаётся, сроки, условия"
              rows={4}
            />
            <Textarea
              label="Детали передачи"
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              placeholder="Как продавец передаст товар после оплаты"
              rows={2}
            />
            <p className="deal-new-hint">Поддерживается Markdown в описании.</p>
            <div className="deal-new-actions">
              <Button variant="secondary" onClick={() => setStep('category')}>Назад</Button>
              <Button variant="primary" disabled={description.trim().length < 10} onClick={() => setStep('counterparty')}>
                Далее
              </Button>
            </div>
          </section>
        )}

        {step === 'counterparty' && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">Контрагент (необязательно)</p>
            <Input
              label="Поиск по username"
              value={counterpartyQuery}
              onChange={(e) => setCounterpartyQuery(e.target.value)}
              placeholder="Введите @username"
            />
            <div className="deal-new-user-list">
              {searchLoading && <p className="deal-new-hint">Поиск...</p>}
              {searchResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`deal-new-user-row ${selectedCounterparty?.id === u.id ? 'deal-new-user-row--selected' : ''}`}
                  onClick={() => setSelectedCounterparty(u)}
                >
                  <span className="deal-new-user-avatar">{u.displayName[0]}</span>
                  <span className="deal-new-user-info">
                    <strong>{u.displayName}</strong>
                    <span>@{u.username} · {u.dealsCount} сделок</span>
                  </span>
                  <span className="deal-new-user-rating">
                    <Star size={12} fill="var(--color-warning)" color="var(--color-warning)" />
                    {u.rating.toFixed(1)}/5
                  </span>
                </button>
              ))}
            </div>
            <p className="deal-new-hint">Или отправьте invite-ссылку после создания сделки.</p>
            <div className="deal-new-actions">
              <Button variant="secondary" onClick={() => setStep('details')}>Назад</Button>
              <Button variant="primary" onClick={() => setStep('price')}>Далее</Button>
            </div>
          </section>
        )}

        {step === 'price' && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">Сумма и валюта котировки</p>
            <Input
              label="Сумма *"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              error={amount.trim() && parsedAmount === null ? 'Введите положительное число' : undefined}
            />
            <SegmentedControl
              options={[
                { value: 'RUB', label: '₽ RUB' },
                { value: 'USDT', label: 'USDT' },
              ]}
              value={currency}
              onChange={setCurrency}
            />
            {usdtPreview !== null && (
              <p className="deal-new-usdt-preview">≈ {usdtPreview.toLocaleString('ru-RU')} USDT в эскроу</p>
            )}
            <p className="deal-new-hint">Эскроу в USDT; при RUB курс фиксируется при оплате (Cryptomus).</p>
            <div className="deal-new-actions">
              <Button variant="secondary" onClick={() => setStep('details')}>Назад</Button>
              <Button variant="primary" disabled={parsedAmount === null} onClick={() => setStep('commission')}>
                Далее
              </Button>
            </div>
          </section>
        )}

        {step === 'commission' && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">Распределение комиссии платформы (5%)</p>
            <div className="deal-new-options">
              {COMMISSION_OPTIONS.map((opt) =>
                renderOptionCard(opt.id, opt.label, opt.note, RefreshCw, commissionModel === opt.id, () =>
                  setCommissionModel(opt.id),
                ),
              )}
            </div>
            <div className="deal-new-actions">
              <Button variant="secondary" onClick={() => setStep('price')}>Назад</Button>
              <Button variant="primary" onClick={() => setStep('confirm')}>Далее</Button>
            </div>
          </section>
        )}

        {step === 'confirm' && parsedAmount !== null && (
          <section className="deal-new-section slide-up">
            <p className="deal-new-lead">Подтверждение</p>
            <Card>
              <p><strong>{title.trim() || subtypeMeta?.label}</strong></p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-hint)', marginTop: 8 }}>
                {parsedAmount} {currency} (≈ {usdtPreview} USDT)
              </p>
              {selectedCounterparty && (
                <p style={{ marginTop: 8 }}>Контрагент: @{selectedCounterparty.username}</p>
              )}
            </Card>
            <p className="deal-new-hint">
              После создания будет сгенерирован смарт-контракт (CREATE2) и ссылка для покупателя.
            </p>
            <div className="deal-new-actions">
              <Button variant="secondary" onClick={() => setStep('commission')}>Назад</Button>
              <Button variant="primary" loading={submitting} onClick={handleCreate}>
                Предложить сделку
              </Button>
            </div>
          </section>
        )}

        {step === 'done' && (
          <section className="deal-new-section deal-new-done slide-up">
            <p className="deal-new-done__title">Сделка создана</p>
            {escrowAddress && (
              <Card style={{ marginBottom: 12 }}>
                <ContractAddress address={escrowAddress} label="Адрес смарт-контракта" />
                <p className="deal-new-hint" style={{ marginTop: 12 }}>
                  Покупатель оплачивает через Cryptomus — USDT поступает на этот контракт.
                </p>
              </Card>
            )}
            <p className="deal-new-lead">Отправьте invite-ссылку контрагенту:</p>
            {inviteUrl && (
              <Card className="deal-new-invite">
                <code>{inviteUrl}</code>
                <div className="deal-new-invite__actions">
                  <Button variant="secondary" size="sm" onClick={copyInvite}>Копировать</Button>
                  <Button variant="ghost" size="sm" onClick={shareInvite}>
                    <Share2 size={16} /> Telegram
                  </Button>
                </div>
              </Card>
            )}
            <Button
              variant="primary"
              fullWidth
              onClick={() => navigate(createdDealId ? `/deals/${createdDealId}` : '/deals')}
            >
              Открыть сделку
            </Button>
          </section>
        )}
      </div>

      {showSummary && parsedAmount !== null && (
        <aside className="deal-new-summary">
          <Card>
            <p className="deal-new-summary__title">Сводка заказа</p>
            <FeeBreakdown
              amount={parsedAmount}
              currency={currency}
              commissionModel={commissionLabel}
            />
          </Card>
        </aside>
      )}
    </div>
  );
};
