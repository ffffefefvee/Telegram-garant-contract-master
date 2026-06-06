export interface BotPreview {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  transactionCount: number;
}

export type EscrowTrustState = 'in_contract' | 'released_to_seller' | 'dispute' | 'pending';
