import React, { useEffect, useState } from 'react';
import { Card } from '../ui';
import { ContractAddress } from '../shared';
import { SmartContractTooltip, SafetyAccordion } from './SafetyAccordion';
import { ContractStatusCard, contractStatusFromDealStatus } from './ContractStatusCard';
import { fiatToUsdt } from '../../mocks/users';
import type { Deal } from '../../types';
import './deal-room.css';

const PAYOUT_CURRENCIES = ['USDT', 'BTC', 'ETH', 'RUB'] as const;

interface ContractPanelProps {
  deal: Deal;
  isBuyer?: boolean;
  showSafety?: boolean;
}

export const ContractPanel: React.FC<ContractPanelProps> = ({
  deal,
  isBuyer = false,
  showSafety = true,
}) => {
  const [payoutCurrency, setPayoutCurrency] = useState<string>(
    deal.metadata?.sellerPayoutCurrency ?? 'BTC',
  );
  const [payCurrency, setPayCurrency] = useState<string>(
    deal.metadata?.buyerPayCurrency ?? 'USDT',
  );

  const escrowAddress =
    deal.escrowAddress ?? deal.metadata?.escrowAddress ?? '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

  const usdtAmount =
    deal.currency === 'USDT' ? deal.amount : fiatToUsdt(deal.amount, deal.currency as 'RUB' | 'USDT');

  const sellerEquivalent = (() => {
    const payout = payoutCurrency;
    if (payout === 'BTC') {
      const btc = deal.currency === 'USDT' ? deal.amount * 0.000015 : usdtAmount * 0.000015;
      return `${btc.toFixed(6)} BTC`;
    }
    if (payout === 'ETH') {
      return `${(usdtAmount * 0.00028).toFixed(4)} ETH`;
    }
    if (payout === 'RUB' && deal.currency !== 'RUB') {
      return `${(usdtAmount * 95).toLocaleString('ru-RU')} RUB`;
    }
    return `${deal.amount.toLocaleString('ru-RU')} ${deal.currency}`;
  })();

  const statusVariant = contractStatusFromDealStatus(deal.status);
  const showContractBlock = statusVariant !== null;

  useEffect(() => {
    if (deal.metadata?.buyerPayCurrency) {
      setPayCurrency(deal.metadata.buyerPayCurrency);
    }
  }, [deal.metadata?.buyerPayCurrency]);

  if (!showContractBlock && deal.status === 'pending_acceptance') {
    return null;
  }

  return (
    <div className="contract-panel-stack slide-up">
      {statusVariant && <ContractStatusCard variant={statusVariant} />}

      {showContractBlock && (
        <Card className="contract-panel">
          <div className="contract-panel__title-row">
            <h3 className="contract-panel__title">Смарт-контракт</h3>
            <SmartContractTooltip />
          </div>

          <ContractAddress address={escrowAddress} label="Адрес контракта" />

          <div className="contract-panel__amounts">
            <div className="contract-panel__amount-primary">
              {usdtAmount.toLocaleString('ru-RU')} {payCurrency}
            </div>
            <div className="contract-panel__amount-secondary">
              ≈ {sellerEquivalent} для продавца ({payoutCurrency})
            </div>
          </div>

          {isBuyer && deal.status === 'pending_payment' && (
            <div className="contract-panel__currency-row">
              <label className="contract-panel__currency-label" htmlFor="pay-currency">
                Валюта оплаты:
              </label>
              <select
                id="pay-currency"
                className="contract-panel__select"
                value={payCurrency}
                onChange={(e) => setPayCurrency(e.target.value)}
              >
                {PAYOUT_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="contract-panel__currency-row">
            <label className="contract-panel__currency-label" htmlFor="payout-currency">
              Продавец получит в:
            </label>
            <select
              id="payout-currency"
              className="contract-panel__select"
              value={payoutCurrency}
              onChange={(e) => setPayoutCurrency(e.target.value)}
            >
              {PAYOUT_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </Card>
      )}

      {showSafety && showContractBlock && <SafetyAccordion />}
    </div>
  );
};
