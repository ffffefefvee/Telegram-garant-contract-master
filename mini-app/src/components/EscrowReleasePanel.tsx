import React, { useEffect, useState } from 'react';
import { dealsApi, EscrowInfo } from '../api';
import { useEscrowRelease } from '../hooks/useEscrowRelease';
import './EscrowReleasePanel.css';

interface Props {
  dealId: string;
  onReleased?: () => void;
}

export const EscrowReleasePanel: React.FC<Props> = ({ dealId, onReleased }) => {
  const [info, setInfo] = useState<EscrowInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const chainId = info?.chainId ?? 80002;
  const { connecting, releasing, walletAddress, error, txHash, connectWallet, releaseFunds } =
    useEscrowRelease(dealId, chainId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await dealsApi.getEscrow(dealId);
        if (!cancelled) setInfo(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить эскроу');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loadError) {
    return <p className="escrow-release-error">{loadError}</p>;
  }
  if (!info?.releaseRequired) {
    return null;
  }

  const explorerBase =
    chainId === 137
      ? 'https://polygonscan.com'
      : 'https://amoy.polygonscan.com';

  return (
    <div className="escrow-release-panel">
      <h4>Выпуск USDT продавцу</h4>
      <p className="escrow-release-hint">
        Подтвердите транзакцию <code>release()</code> в кошельке покупателя. Средства уйдут
        на адрес продавца из эскроу.
      </p>
      {info.escrowAddress && (
        <a
          className="explorer-link"
          href={`${explorerBase}/address/${info.escrowAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Контракт эскроу
        </a>
      )}
      {!walletAddress ? (
        <button
          type="button"
          className="btn-action btn-primary"
          disabled={connecting}
          onClick={() => void connectWallet()}
        >
          {connecting ? 'Подключение…' : 'Подключить кошелёк'}
        </button>
      ) : (
        <button
          type="button"
          className="btn-action btn-success"
          disabled={releasing || !info.escrowAddress}
          onClick={async () => {
            if (!info.escrowAddress) return;
            await releaseFunds(info.escrowAddress, info.buyerWallet);
            onReleased?.();
          }}
        >
          {releasing ? 'Подпись…' : 'Выпустить средства'}
        </button>
      )}
      {walletAddress && (
        <p className="escrow-wallet-connected">
          Кошелёк: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
        </p>
      )}
      {txHash && (
        <a
          className="explorer-link"
          href={`${explorerBase}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Транзакция в эксплорере
        </a>
      )}
      {(error || loadError) && (
        <p className="escrow-release-error">{error ?? loadError}</p>
      )}
    </div>
  );
};
