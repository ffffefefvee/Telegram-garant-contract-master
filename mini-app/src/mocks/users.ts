export interface SearchUserResult {
  id: string;
  username: string;
  displayName: string;
  dealsCount: number;
  rating: number;
  trustScore: number;
}

export const MOCK_SEARCH_USERS: SearchUserResult[] = [
  { id: 'u1', username: 'bababoy1488', displayName: 'Bababoy1488', dealsCount: 12, rating: 4.2, trustScore: 78 },
  { id: 'u2', username: 'alibasasend', displayName: 'alibasasend', dealsCount: 0, rating: 0, trustScore: 45 },
  { id: 'u3', username: 'seller_pro', displayName: 'Seller Pro', dealsCount: 56, rating: 4.8, trustScore: 92 },
];

export const USDT_RUB_RATE = 92;

export function fiatToUsdt(amount: number, currency: 'RUB' | 'USDT'): number {
  if (currency === 'USDT') return amount;
  return Math.round((amount / USDT_RUB_RATE) * 100) / 100;
}
