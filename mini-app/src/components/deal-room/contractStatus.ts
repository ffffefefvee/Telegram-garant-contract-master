export type ContractStatusVariant =
  | 'awaiting_payment'
  | 'funds_locked'
  | 'completed'
  | 'dispute';

export function contractStatusFromDealStatus(status: string): ContractStatusVariant | null {
  switch (status) {
    case 'pending_payment':
      return 'awaiting_payment';
    case 'in_progress':
    case 'pending_confirmation':
      return 'funds_locked';
    case 'completed':
    case 'dispute_resolved':
      return 'completed';
    case 'disputed':
    case 'frozen':
      return 'dispute';
    default:
      return null;
  }
}
