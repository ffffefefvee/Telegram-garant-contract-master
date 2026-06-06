import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flag, MessageSquare, CheckCircle2 } from 'lucide-react';
import { dealsApi, paymentsApi } from '../api';
import { useAppStore } from '../store/appStore';
import { ChatWindow } from '../components/ChatWindow';
import { EscrowReleasePanel } from '../components/EscrowReleasePanel';
import { Deal } from '../types';
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
    setActionLoading(true);
    try {
      const result = await paymentsApi.create({
        dealId: deal.id,
        amount: deal.amount,
        currency: deal.currency,
        description: `Оплата сделки #${deal.dealNumber}`,
      });
      const url = result.paymentUrl;
      if (!url) {
        setActionError('Не удалось получить ссылку на оплату');
        return;
      }
      setPaymentUrl(url);
      setShowPaymentSheet(true);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (error) {
      console.error('Payment error:', error);
      setActionError('Ошибка создания платежа');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setActionLoading(false);
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
            {paymentUrl && (
              <Button variant="primary" fullWidth onClick={() => window.open(paymentUrl, '_blank')}>
                Перейти к оплате (Cryptomus)
              </Button>
            )}
            <Button variant="secondary" fullWidth onClick={() => void handlePaymentSent()}>
              Я отправил средства
            </Button>
          </div>
        }
      >
        <FeeBreakdown
          amount={deal.amount}
          currency={deal.currency}
          commissionModel={dealMeta?.commissionModel}
        />
        <p className="deal-new-hint" style={{ marginTop: 12 }}>
          Cryptomus конвертирует оплату в USDT и направляет на адрес смарт-контракта сделки.
        </p>
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
