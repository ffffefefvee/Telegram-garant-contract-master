import type { EscrowTrustState } from '../../types/ui';

export function escrowStateFromDealStatus(status: string): EscrowTrustState {
  if (['disputed', 'frozen', 'dispute_resolved'].includes(status)) return 'dispute';
  if (['completed', 'resolved'].includes(status)) return 'released_to_seller';
  if (['in_progress', 'pending_confirmation', 'funded'].includes(status)) return 'in_contract';
  if (status === 'pending_payment') return 'pending';
  return 'pending';
}
