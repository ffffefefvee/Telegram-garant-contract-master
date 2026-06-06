import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from '../ui';
import './shared.css';

function truncateAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

interface ContractAddressProps {
  address: string;
  label?: string;
}

export const ContractAddress: React.FC<ContractAddressProps> = ({ address, label }) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      showToast('Адрес скопирован');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Не удалось скопировать');
    }
  };

  return (
    <div>
      {label && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-hint)', marginBottom: 6 }}>
          {label}
        </p>
      )}
      <div className="contract-address">
        <code className="contract-address__text font-mono">{truncateAddress(address)}</code>
        <button type="button" className="contract-address__copy" onClick={handleCopy} aria-label="Копировать адрес">
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
    </div>
  );
};
