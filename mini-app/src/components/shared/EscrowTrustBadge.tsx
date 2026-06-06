import React from 'react';
import { Shield, ArrowRight, AlertTriangle, Clock } from 'lucide-react';
import type { EscrowTrustState } from '../../types/ui';
import './shared.css';

const LABELS: Record<EscrowTrustState, string> = {
  in_contract: 'Деньги в контракте',
  released_to_seller: 'Деньги переведены продавцу',
  dispute: 'Спор — средства заморожены',
  pending: 'Ожидается поступление',
};

const ICONS: Record<EscrowTrustState, React.ReactNode> = {
  in_contract: <Shield size={14} />,
  released_to_seller: <ArrowRight size={14} />,
  dispute: <AlertTriangle size={14} />,
  pending: <Clock size={14} />,
};

interface EscrowTrustBadgeProps {
  state: EscrowTrustState;
}

export const EscrowTrustBadge: React.FC<EscrowTrustBadgeProps> = ({ state }) => (
  <span className={`escrow-trust-badge escrow-trust-badge--${state}`}>
    {ICONS[state]}
    {LABELS[state]}
  </span>
);

export function escrowStateFromDealStatus(status: string): EscrowTrustState {
  if (['disputed', 'frozen', 'dispute_resolved'].includes(status)) return 'dispute';
  if (['completed', 'resolved'].includes(status)) return 'released_to_seller';
  if (['in_progress', 'pending_confirmation', 'funded'].includes(status)) return 'in_contract';
  if (status === 'pending_payment') return 'pending';
  return 'pending';
}
