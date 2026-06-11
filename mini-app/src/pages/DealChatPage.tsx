import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flag, MessageSquare, CheckCircle2 } from 'lucide-react';
import { dealsApi, paymentsApi } from '../api';
import { useAppStore } from '../store/appStore';
import { ChatWindow } from '../components/ChatWindow';
import { EscrowReleasePanel } from '../components/EscrowReleasePanel';
import { Deal, PaymentMethodInfo, CreatePaymentResponse } from '../types';
import {
  PageHeader,
  Button,
  StatusPill,
  AmountDisplay,
  FeeBreakdown,
  BottomSheet,
  ConfirmSheet,
  Card,
  DealListSkeleton,
  useToast,
} from '../components/ui';
import {
  DealRoomTabs,
  ConditionsPanel,
  ContractPanel,
  DisputeFormSheet,
  DealFlowProgressBar,
  PaymentConfirmations,
  DealRoomHeader,
  DealCompletedCard,
  type DealRoomTab,
} from '../components/deal-room';
import { PaymentVerifyModal } from '../components/shared';
import { getStatusLabel, getStatusVariant, getDealSystemMessages } from '../constants/dealStatus';
import { fiatToUsdt } from '../mocks/users';
import './DealChatPage.css';

export const DealChatPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAppStore();
  const { showToast } = useToast();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [tab, setTab] = useState<DealRoomTab>('chat');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [payMethods, setPayMethods] = useState<PaymentMethodInfo[] | null>(null);
  const [payStep, setPayStep] = useState<'choose' | 'hosted' | 'direct'>('choose');
  const [deposit, setDeposit] = useState<CreatePaymentResponse['deposit'] | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [showPaymentVerify, setShowPaymentVerify] = useState(false);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  const [showDisputeSheet, setShowDisputeSheet] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [confirmations, setConfirmations] = useState(0);

  const loadDeal = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setLoadError(false);
      const data = await dealsApi.getById(id);
      setDeal(data);
      if (data.metadata?.paymentConfirming) {
        setPaymentSubmitted(true);
        setConfirmations(data.metadata.paymentConfirmations ?? 3);
      }
    } catch (error) {
      console.error('Failed to load deal:', error);
      setLoadError(true);
      setDeal(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDeal();
  }, [loadDeal]);

  useEffect(() => {
    if (!paymentSubmitted) return;
    const startFrom = deal?.metadata?.paymentConfirmations ?? 0;
    setConfirmations(startFrom);
    const interval = setInterval(() => {
      setConfirmations((prev) => {
        if (prev >= 10) {
          clearInterval(interval);
          if (deal && deal.status === 'pending_payment') {
            void dealsApi.getById(deal.id).then((updated) => {
              if (updated.status === 'pending_payment') {
                setDeal((d) =>
                  d
                    ? {
                        ...d,
                        status: 'in_progress',
                        paidAt: new Date().toISOString(),
                        metadata: { ...d.metadata, paymentConfirming: false },
                      }
                    : d,
                );
              }
            });
          }
          return 10;
        }
        return prev + 1;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [paymentSubmitted, deal?.id, deal?.metadata?.paymentConfirmations, deal?.status]);

  const handlePay = async () => {
    if (!deal) return;
    setActionError(null);
    setPayStep('choose');
    setPaymentUrl(null);
    setDeposit(null);
    setShowPaymentSheet(true);
    if (!payMethods) {
      const methods = await paymentsApi.getMethods();
      setPayMethods(methods.filter((m) => m.available));
    }
  };

  const handleSelectMethod = async (method: 'cryptomus' | 'crypto') => {
    if (!deal) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const result = await paymentsApi.create({
        dealId: deal.id,
        amount: deal.amount,
        currency: deal.currency,
        method,
        description: `Оплата сделки #${deal.dealNumber}`,
      });
      if (method === 'crypto') {
        if (!result.deposit) {
          setActionError('Не удалось получить адрес для перевода');
          return;
        }
        setDeposit(result.deposit);
        setPayStep('direct');
      } else {
        const url = result.paymentUrl;
        if (!url) {
          setActionError('Не удалось получить ссылку на оплату');
          return;
        }
        setPaymentUrl(url);
        setPayStep('hosted');
      }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Payment error:', error);
      setActionError('Ошибка создания платежа');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!deposit) return;
    try {
      await navigator.clipboard.writeText(deposit.address);
      setAddressCopied(true);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      // clipboard unavailable in some webviews — user can long-press the text
    }
  };

  const handlePaymentSent = async () => {
    setPaymentSubmitted(true);
    setShowPaymentSheet(false);
    setShowPaymentVerify(true);
    await loadDeal();
  };

  const handleAccept = async () => {
    if (!deal) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await dealsApi.accept(deal.id);
      await loadDeal();
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Accept error:', error);
      setActionError('Не удалось принять сделку');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateContract = async () => {
    if (!deal) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await dealsApi.deployEscrow(deal.id);
      await loadDeal();
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Contract error:', error);
      setActionError('Не удалось создать смарт-контракт');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkDelivered = async () => {
    if (!deal) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await dealsApi.markShipped(deal.id);
      await loadDeal();
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Deliver error:', error);
      setActionError('Не удалось отметить выполнение');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!deal) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await dealsApi.confirm(deal.id);
      await loadDeal();
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Confirm error:', error);
      setActionError('Не удалось подтвердить');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!deal) return;
    setActionLoading(true);
    try {
      await dealsApi.cancel(deal.id, 'Отменено пользователем');
      setShowCancelSheet(false);
      await loadDeal();
    } catch (error) {
      console.error('Cancel error:', error);
      setActionError('Отмена недоступна в текущем статусе');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDispute = async (reason: string, _files: File[]) => {
    if (!deal) return;
    setActionLoading(true);
    try {
      await dealsApi.openDispute(deal.id, reason);
      setShowDisputeSheet(false);
      await loadDeal();
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    } catch (error) {
      console.error('Dispute error:', error);
      setActionError('Не удалось открыть спор');
    } finally {
      setActionLoading(false);
    }
  };

  const getOtherUser = () => {
    if (!deal || !user) return { id: '', name: 'Неизвестно' };
    const other = deal.buyer.id === user.id ? deal.seller : deal.buyer;
    return {
      id: other?.id || '',
      name: other?.telegramFirstName || other?.telegramUsername || 'Неизвестно',
    };
  };

  if (isLoading) {
    return (
      <div className="deal-chat-page page-scroll">
        <PageHeader title="Загрузка…" onBack={() => navigate('/deals')} />
        <div style={{ padding: 16 }}><DealListSkeleton /></div>
      </div>
    );
  }

  if (loadError || !deal) {
    return (
      <div className="deal-chat-page page-scroll">
        <PageHeader title="Сделка" onBack={() => navigate('/deals')} />
        <div className="deal-chat-error">
          <p>{loadError ? 'Не удалось загрузить сделку' : 'Сделка не найдена'}</p>
          <Button variant="secondary" onClick={() => (loadError ? loadDeal() : navigate('/deals'))}>
            {loadError ? 'Повторить' : 'К списку'}
          </Button>
        </div>
      </div>
    );
  }

  const otherUser = getOtherUser();
  const isMockDeal = import.meta.env.VITE_TG_MOCK === 'true' && deal.id.startsWith('mock-');
  const isBuyer = deal.buyer.id === user?.id || deal.buyerId === user?.id || isMockDeal;
  const isSeller = deal.seller?.id === user?.id || deal.sellerId === user?.id;
  const hasEscrow = Boolean(deal.escrowAddress ?? deal.metadata?.escrowAddress);
  const paymentVerifying = paymentSubmitted || Boolean(deal.metadata?.paymentConfirming);
  const canCancel = ['draft', 'pending_acceptance', 'pending_payment'].includes(deal.status);
  const canDispute =
    ['in_progress', 'pending_confirmation', 'pending_payment'].includes(deal.status) &&
    hasEscrow;
  const dealMeta = deal.metadata;
  const showEscrowRelease = deal.status === 'completed' || Boolean(dealMeta?.escrowReleaseRequired);
  const canAccept = deal.status === 'pending_acceptance' && isBuyer;
  const needsContract =
    deal.status === 'pending_payment' && !hasEscrow && isSeller && Boolean(deal.acceptedAt);
  const showContractBlock =
    hasEscrow || ['in_progress', 'pending_confirmation', 'completed', 'disputed'].includes(deal.status);
  const systemMessages = getDealSystemMessages(deal.status, deal.acceptedAt, hasEscrow);
  const showPaymentProgress =
    paymentVerifying && deal.status === 'pending_payment' && confirmations < 10;
  const confirmationCount = Math.max(deal.metadata?.paymentConfirmations ?? 3, confirmations);

  const usdtDisplay =
    deal.currency === 'USDT' ? deal.amount : fiatToUsdt(deal.amount, deal.currency as 'RUB' | 'USDT');

  const renderPrimaryAction = () => {
    if (canAccept) {
      return (
        <Button variant="primary" fullWidth loading={actionLoading} onClick={handleAccept}>
          Принять условия
        </Button>
      );
    }
    if (needsContract) {
      return (
        <Button variant="primary" fullWidth loading={actionLoading} onClick={handleCreateContract}>
          Создать смарт-контракт
        </Button>
      );
    }
    if (deal.status === 'pending_payment' && isBuyer && hasEscrow && !paymentVerifying) {
      return (
        <Button variant="primary" fullWidth loading={actionLoading} onClick={handlePay}>
          Отправить средства
        </Button>
      );
    }
    if (deal.status === 'pending_confirmation' && isBuyer) {
      return (
        <Button variant="primary" fullWidth loading={actionLoading} onClick={handleConfirm}>
          Подтвердить получение
        </Button>
      );
    }
    if (deal.status === 'in_progress' && isSeller) {
      return (
        <Button variant="primary" fullWidth loading={actionLoading} onClick={handleMarkDelivered}>
          <CheckCircle2 size={18} />
          Я выполнил
        </Button>
      );
    }
    return null;
  };

  const renderSecondaryAction = () => {
    if (canAccept && isBuyer) {
      return (
        <Button
          variant="secondary"
          fullWidth
          onClick={() => {
            setTab('conditions');
            showToast('Опишите правки в чате или на вкладке «Условия»');
          }}
        >
          <MessageSquare size={16} />
          Предложить правки
        </Button>
      );
    }
    return renderDisputeButton();
  };

  const renderDisputeButton = () => {
    if (!canDispute) return null;
    return (
      <Button
        variant="secondary"
        fullWidth
        className="deal-action-btn--dispute"
        onClick={() => setShowDisputeSheet(true)}
      >
        <Flag size={16} />
        Открыть спор
      </Button>
    );
  };

  const actorHint = () => {
    if (canAccept) return 'Вы можете принять условия или открыть спор, если что-то не так';
    if (needsContract) return 'Создайте смарт-контракт — покупатель сможет безопасно оплатить';
    if (deal.status === 'pending_payment') {
      if (paymentVerifying) return 'Сеть проверяет платёж. Обычно это занимает 2–5 минут';
      if (!hasEscrow) {
        return isBuyer
          ? 'Ожидается создание смарт-контракта продавцом'
          : 'Создайте смарт-контракт — покупатель сможет безопасно оплатить';
      }
      return isBuyer
        ? 'Отправьте средства и нажмите «Я отправил средства» после перевода'
        : 'Ожидается оплата покупателя';
    }
    if (deal.status === 'pending_confirmation') {
      return isBuyer
        ? 'Нажимайте, только если получили товар — деньги уйдут продавцу'
        : 'Ожидается подтверждение покупателя';
    }
    if (deal.status === 'in_progress') {
      return isSeller ? 'Выполните условия сделки и нажмите «Я выполнил»' : 'Ожидается выполнение продавцом';
    }
    if (deal.status === 'disputed') {
      return 'Арбитр изучит материалы, обычно до 24 часов';
    }
    return null;
  };

  const txHash =
    dealMeta?.releaseTxHash ??
    (dealMeta as { escrowReleaseTxHash?: string } | undefined)?.escrowReleaseTxHash;

  return (
    <div className="deal-chat-page">
      <PageHeader
        title={deal.title || `Сделка #${deal.dealNumber}`}
        onBack={() => navigate('/deals')}
      />

      <DealFlowProgressBar
        status={deal.status}
        progressContext={{ hasEscrow, paymentVerifying }}
      />

      <div className="deal-chat-body page-scroll">
        <DealRoomHeader deal={deal} />

        <Card className="deal-hero slide-up">
          <div className="deal-hero__top">
            <StatusPill variant={getStatusVariant(deal.status)} label={getStatusLabel(deal.status)} />
            <div className="deal-hero__amounts">
              <AmountDisplay amount={deal.amount} currency={deal.currency} size="lg" />
              <span className="deal-hero__usdt">≈ {usdtDisplay.toLocaleString('ru-RU')} USDT</span>
            </div>
          </div>
          {actorHint() && <p className="deal-hero__hint">{actorHint()}</p>}
        </Card>

        <DealRoomTabs active={tab} onChange={setTab} />

        {tab === 'chat' && (
          <div className="deal-room-stack">
            {showContractBlock && (
              <ContractPanel deal={deal} isBuyer={isBuyer} showSafety />
            )}

            {showPaymentProgress && (
              <PaymentConfirmations current={confirmationCount} total={10} />
            )}

            {deal.status === 'completed' && (
              <DealCompletedCard
                txHash={txHash}
                onLeaveReview={() => showToast('Отзыв скоро будет доступен')}
              />
            )}

            <div className="deal-actions-block">
              {renderPrimaryAction()}
              {renderSecondaryAction()}
              {actionError && <p className="deal-action-error">{actionError}</p>}
            </div>

            {showEscrowRelease && (
              <EscrowReleasePanel dealId={deal.id} onReleased={() => void loadDeal()} />
            )}

            <div className="deal-secondary-actions">
              {canCancel && (
                <Button variant="ghost" size="sm" onClick={() => setShowCancelSheet(true)}>
                  Отменить сделку
                </Button>
              )}
            </div>

            <div className="deal-content">
              <ChatWindow
                dealId={deal.id}
                otherUser={otherUser}
                systemMessages={systemMessages}
              />
            </div>
          </div>
        )}

        {tab === 'conditions' && <ConditionsPanel deal={deal} isBuyer={isBuyer} />}
        {tab === 'contract' && (
          <ContractPanel deal={deal} isBuyer={isBuyer} showSafety />
        )}
      </div>

      <BottomSheet
        open={showPaymentSheet}
        onClose={() => setShowPaymentSheet(false)}
        title="Отправка средств"
        footer={
          <div className="deal-actions-block">
            {payStep === 'choose' && (
              <>
                {(payMethods ?? [{ method: 'cryptomus', label: 'Cryptomus', available: true, kind: 'hosted' } as PaymentMethodInfo]).map(
                  (m) => (
                    <Button
                      key={m.method}
                      variant={m.kind === 'direct' ? 'secondary' : 'primary'}
                      fullWidth
                      loading={actionLoading}
                      onClick={() => void handleSelectMethod(m.method)}
                    >
                      {m.kind === 'direct'
                        ? 'Перевести USDT напрямую (Polygon)'
                        : 'Оплатить через Cryptomus'}
                    </Button>
                  ),
                )}
              </>
            )}
            {payStep === 'hosted' && paymentUrl && (
              <>
                <Button variant="primary" fullWidth onClick={() => window.open(paymentUrl, '_blank')}>
                  Перейти к оплате (Cryptomus)
                </Button>
                <Button variant="secondary" fullWidth onClick={() => void handlePaymentSent()}>
                  Я отправил средства
                </Button>
              </>
            )}
            {payStep === 'direct' && deposit && (
              <Button variant="primary" fullWidth onClick={() => void handlePaymentSent()}>
                Я отправил средства
              </Button>
            )}
          </div>
        }
      >
        {payStep !== 'direct' && (
          <FeeBreakdown
            amount={deal.amount}
            currency={deal.currency}
            commissionModel={dealMeta?.commissionModel}
          />
        )}
        {payStep === 'choose' && (
          <p className="deal-new-hint" style={{ marginTop: 12 }}>
            Cryptomus — оплата картой или криптовалютой через платёжную страницу.
            Прямой перевод — отправьте USDT в сети Polygon с любого кошелька или биржи
            сразу на адрес смарт-контракта сделки, без посредников.
          </p>
        )}
        {payStep === 'hosted' && (
          <p className="deal-new-hint" style={{ marginTop: 12 }}>
            Cryptomus конвертирует оплату в USDT и направляет на адрес смарт-контракта сделки.
          </p>
        )}
        {payStep === 'direct' && deposit && (
          <div className="deal-direct-deposit">
            <p style={{ marginBottom: 8 }}>
              Отправьте <strong>ровно {deposit.requiredAmount} {deposit.asset}</strong> (сумма сделки +
              комиссия покупателя) на адрес смарт-контракта:
            </p>
            <div
              onClick={() => void handleCopyAddress()}
              style={{
                fontFamily: 'monospace',
                fontSize: 13,
                wordBreak: 'break-all',
                background: 'var(--color-bg-secondary, rgba(128,128,128,0.12))',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              {deposit.address}
            </div>
            <Button variant="secondary" fullWidth onClick={() => void handleCopyAddress()} style={{ marginTop: 8 }}>
              {addressCopied ? 'Скопировано ✓' : 'Скопировать адрес'}
            </Button>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deposit.address)}`}
                alt="QR-код адреса"
                width={160}
                height={160}
                style={{ borderRadius: 8, background: '#fff', padding: 6 }}
              />
            </div>
            <p className="deal-new-hint" style={{ marginTop: 12 }}>
              ⚠️ Только <strong>{deposit.asset}</strong> в сети{' '}
              <strong>{deposit.network === 'polygon' ? 'Polygon' : deposit.network}</strong>.
              Перевод в другой сети приведёт к потере средств. Средства зачисляются
              напрямую в эскроу-контракт — платформа их не хранит. Подтверждение
              занимает 1–2 минуты после поступления.
            </p>
          </div>
        )}
      </BottomSheet>

      <PaymentVerifyModal
        open={showPaymentVerify}
        onClose={() => setShowPaymentVerify(false)}
        dealId={deal.id}
        onVerified={() => void loadDeal()}
      />

      <ConfirmSheet
        open={showCancelSheet}
        onClose={() => setShowCancelSheet(false)}
        title="Отменить сделку?"
        message="Сделка будет отменена. Это действие необратимо на текущем этапе."
        confirmLabel="Отменить сделку"
        danger
        loading={actionLoading}
        onConfirm={handleCancel}
      />

      <DisputeFormSheet
        open={showDisputeSheet}
        onClose={() => setShowDisputeSheet(false)}
        onSubmit={handleDispute}
        loading={actionLoading}
      />
    </div>
  );
};
