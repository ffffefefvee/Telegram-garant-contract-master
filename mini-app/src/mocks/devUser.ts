import type { User } from '../types';
import { UserRole } from '../types';

/** Fallback user when backend is down but VITE_TG_MOCK=true (local UI QA). */
export const MOCK_DEV_USER: User = {
  id: 'mock-user-1',
  telegramId: 7124952069,
  telegramUsername: 'test_user',
  telegramFirstName: 'Test',
  telegramLastName: 'User',
  telegramLanguageCode: 'ru',
  status: 'active',
  roles: [UserRole.BUYER, UserRole.SELLER],
  balance: 0,
  reputationScore: 72,
  completedDeals: 5,
  cancelledDeals: 1,
  disputedDeals: 0,
  createdAt: '2026-02-12T20:39:00.000Z',
  updatedAt: new Date().toISOString(),
};
