// Типы перенесены в src/types/disputes.ts
export type { DisputeListStatus, DisputeListItem, DisputeTimelineEvent, DisputeEvidence, DisputeDetail } from '../types/disputes';
import type { DisputeListItem, DisputeDetail } from '../types/disputes';

export const MOCK_DISPUTES: DisputeListItem[] = [
  {
    id: 'disp-1',
    dealId: 'deal-mock-1',
    dealNumber: '1042',
    amount: 1500,
    currency: 'RUB',
    status: 'in_review',
    openedAt: '2026-05-20T14:00:00Z',
    counterpartyName: 'Seller Pro',
  },
  {
    id: 'disp-2',
    dealId: 'deal-mock-2',
    dealNumber: '1038',
    amount: 50,
    currency: 'USDT',
    status: 'resolved',
    openedAt: '2026-05-10T09:00:00Z',
    counterpartyName: 'alibasasend',
  },
];

export const MOCK_DISPUTE_DETAILS: Record<string, DisputeDetail> = {
  'disp-1': {
    id: 'disp-1',
    dealId: 'deal-mock-1',
    dealNumber: '1042',
    amount: 1500,
    currency: 'RUB',
    usdtAmount: 16.3,
    status: 'in_review',
    reason: 'Товар не соответствует описанию',
    timeline: [
      { id: 'e1', at: '2026-05-20T14:00:00Z', title: 'Спор открыт', description: 'Покупатель указал причину' },
      { id: 'e2', at: '2026-05-21T10:00:00Z', title: 'Доказательства загружены' },
      { id: 'e3', at: '2026-05-22T08:00:00Z', title: 'Арбитр назначен' },
    ],
    evidence: [
      { id: 'ev1', url: '#', name: 'screenshot1.png', uploadedBy: 'buyer' },
      { id: 'ev2', url: '#', name: 'chat_log.pdf', uploadedBy: 'seller' },
    ],
  },
  'disp-2': {
    id: 'disp-2',
    dealId: 'deal-mock-2',
    dealNumber: '1038',
    amount: 50,
    currency: 'USDT',
    usdtAmount: 50,
    status: 'resolved',
    reason: 'Не получен доступ',
    timeline: [
      { id: 'e1', at: '2026-05-10T09:00:00Z', title: 'Спор открыт' },
      { id: 'e2', at: '2026-05-12T15:00:00Z', title: 'Решение арбитра' },
    ],
    evidence: [],
    decision: {
      winner: 'buyer',
      comment: 'Продавец не предоставил доказательства передачи доступа в срок.',
      decidedAt: '2026-05-12T15:00:00Z',
    },
  },
};
