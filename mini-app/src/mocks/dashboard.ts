import type { BotPreview } from '../types/ui';

export const MOCK_NOTIFICATION_COUNT = 2;

export const MOCK_BOT_PREVIEWS: BotPreview[] = [
  {
    id: 'bot-1',
    name: 'Shop Bot',
    status: 'active',
    transactionCount: 24,
  },
  {
    id: 'bot-2',
    name: 'Keys Store',
    status: 'inactive',
    transactionCount: 3,
  },
];
