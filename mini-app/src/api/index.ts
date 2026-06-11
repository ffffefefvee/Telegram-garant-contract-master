import axios, { AxiosInstance } from 'axios';
import type {
  AuthSession,
  CreatePaymentResponse,
  Deal,
  Message,
  Payment,
  PaymentMethodInfo,
  User,
} from '../types';
import {
  MOCK_DISPUTES,
  MOCK_DISPUTE_DETAILS,
  type DisputeDetail,
  type DisputeListItem,
} from '../mocks/disputes';
import { MOCK_BOTS, getMockBot, type BotItem } from '../mocks/bots';
import { USE_UI_MOCKS } from '../mocks/config';
import { MOCK_DEV_USER } from '../mocks/devUser';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function isMockMode(): boolean {
  return import.meta.env.VITE_TG_MOCK === 'true';
}

export const AUTH_TOKEN_STORAGE_KEY = 'auth_token';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: import.meta.env.VITE_TG_MOCK === 'true' ? 5000 : 30000,
    });

    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const isMock = import.meta.env.VITE_TG_MOCK === 'true';
          const offlineToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === 'mock-offline-token';
          if (!isMock && !offlineToken) {
            localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
            window.location.reload();
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status && status < 500) {
          throw err;
        }
        if (attempt === retries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.withRetry(async () => {
      const response = await this.client.get<T>(url, { params });
      return response.data;
    });
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    return this.withRetry(async () => {
      const response = await this.client.post<T>(url, data);
      return response.data;
    });
  }

  /** POST multipart/form-data (file uploads). Axios sets the boundary itself. */
  async postForm<T>(url: string, form: FormData): Promise<T> {
    const response = await this.client.post<T>(url, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await this.client.put<T>(url, data);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown): Promise<T> {
    const response = await this.client.patch<T>(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<T>(url);
    return response.data;
  }
}

export const api = new ApiClient();

export const authApi = {
  /**
   * Exchange Telegram `initData` for a backend-issued JWT + user payload.
   * Stores the token in localStorage on success so all subsequent requests
   * are authenticated via the Axios interceptor above.
   */
  loginWithTelegram: async (initData: string): Promise<AuthSession> => {
    const session = await api.post<AuthSession>('/auth/telegram', { initData });
    if (session.accessToken) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.accessToken);
    }
    return session;
  },

  /** Dev-only (AUTH_DEV_MODE=true). Used when VITE_TG_MOCK=true. */
  devLogin: async (telegramId: number): Promise<AuthSession> => {
    const session = await api.post<AuthSession>('/auth/dev-login', {
      telegramId,
      username: 'test_user',
      firstName: 'Test',
      lastName: 'User',
      languageCode: 'ru',
    });
    if (session.accessToken) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.accessToken);
    }
    return session;
  },

  logout: () => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  },
};

export interface EscrowInfo {
  ready: boolean;
  chainId: number;
  escrowAddress: string | null;
  status: string;
  releaseRequired: boolean;
  releaseTxHash: string | null;
  buyerWallet: string | null;
  sellerWallet: string | null;
}

const MOCK_SELLER: Deal['seller'] = {
  id: 'u-seller',
  telegramId: 2,
  telegramUsername: 'seller_pro',
  telegramFirstName: 'Seller',
  status: 'active',
  roles: ['seller'],
  balance: 0,
  reputationScore: 90,
  completedDeals: 10,
  cancelledDeals: 0,
  disputedDeals: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let mockDealsState: Deal[] = [
  {
    id: 'mock-deal-1',
    dealNumber: '1042',
    type: 'digital',
    status: 'pending_payment',
    amount: 1500,
    currency: 'RUB',
    description: 'Цифровой ключ активации',
    title: 'Steam key',
    buyerId: 'mock-user-1',
    sellerId: 'u-seller',
    escrowAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    acceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    buyer: MOCK_DEV_USER as Deal['buyer'],
    seller: MOCK_SELLER,
    metadata: { buyerPayCurrency: 'USDT', sellerPayoutCurrency: 'BTC' },
  },
  {
    id: 'mock-deal-2',
    dealNumber: '1043',
    type: 'digital',
    status: 'pending_acceptance',
    amount: 2500,
    currency: 'RUB',
    description: 'Подписка на сервис на 1 месяц',
    title: 'Подписка Premium',
    buyerId: 'mock-user-1',
    sellerId: 'u-seller',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    buyer: MOCK_DEV_USER as Deal['buyer'],
    seller: MOCK_SELLER,
  },
];

function patchMockDeal(id: string, patch: Partial<Deal>): Deal {
  const idx = mockDealsState.findIndex((d) => d.id === id);
  if (idx < 0) throw new Error('Deal not found');
  mockDealsState[idx] = { ...mockDealsState[idx], ...patch, updatedAt: new Date().toISOString() };
  return mockDealsState[idx];
}

export const dealsApi = {
  getAll: async (params?: { status?: string[]; limit?: number; offset?: number }) => {
    if (isMockMode()) {
      let deals = [...mockDealsState];
      const statuses = params?.status;
      if (statuses?.length) {
        deals = deals.filter((d) => statuses.includes(d.status));
      }
      return { deals, total: deals.length };
    }
    try {
      return await api.get<{ deals: Deal[]; total: number }>('/deals', params as Record<string, unknown>);
    } catch {
      return { deals: mockDealsState, total: mockDealsState.length };
    }
  },

  getById: async (id: string) => {
    if (isMockMode() && id.startsWith('mock-')) {
      const found = mockDealsState.find((d) => d.id === id);
      if (found) return found;
      throw new Error('Deal not found');
    }
    try {
      return await api.get<Deal>(`/deals/${id}`);
    } catch {
      if (isMockMode()) {
        const found = mockDealsState.find((d) => d.id === id);
        if (found) return found;
      }
      throw new Error('Failed to load deal');
    }
  },

  create: (data: {
    type: string;
    amount: number;
    description: string;
    title?: string;
    terms?: string;
    currency?: string;
    metadata?: Record<string, unknown>;
  }) => api.post<Deal>('/deals', data),

  createInvite: (dealId: string) =>
    api.post<{ inviteUrl: string; inviteToken: string }>(`/deals/${dealId}/invite`, {}),

  openDispute: (id: string, reason: string) =>
    api.post<Deal>(`/deals/${id}/dispute`, { reason }),

  cancel: (id: string, reason?: string) =>
    api.post<Deal>(`/deals/${id}/cancel`, { reason }),

  accept: async (id: string) => {
    try {
      return await api.post<Deal>(`/deals/${id}/accept`);
    } catch {
      if (import.meta.env.VITE_TG_MOCK === 'true') {
        return patchMockDeal(id, {
          status: 'pending_payment',
          acceptedAt: new Date().toISOString(),
        });
      }
      throw new Error('Failed to accept deal');
    }
  },

  confirm: async (id: string) => {
    try {
      return await api.post<Deal>(`/deals/${id}/confirm`);
    } catch {
      if (import.meta.env.VITE_TG_MOCK === 'true') {
        return patchMockDeal(id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          metadata: {
            releaseTxHash: '0xabc123def4567890abcdef1234567890abcdef12',
          },
        });
      }
      throw new Error('Failed to confirm deal');
    }
  },

  markShipped: async (id: string) => {
    try {
      return await api.post<Deal>(`/deals/${id}/ship`);
    } catch {
      if (import.meta.env.VITE_TG_MOCK === 'true') {
        return patchMockDeal(id, { status: 'pending_confirmation' });
      }
      throw new Error('Failed to mark shipped');
    }
  },

  deployEscrow: async (id: string): Promise<Deal> => {
    if (import.meta.env.VITE_TG_MOCK === 'true') {
      return patchMockDeal(id, {
        escrowAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        status: 'pending_payment',
      });
    }
    const escrow = await api.get<EscrowInfo>(`/deals/${id}/escrow`);
    if (escrow.escrowAddress) {
      return dealsApi.getById(id);
    }
    throw new Error('Escrow not ready');
  },

  getEscrow: (id: string) => api.get<EscrowInfo>(`/deals/${id}/escrow`),

  syncEscrowRelease: (id: string, txHash?: string) =>
    api.post<Deal>(`/deals/${id}/escrow/release-sync`, { txHash }),

  getMessages: async (id: string, limit = 50, offset = 0) => {
    try {
      return await api.get<Message[]>(`/deals/${id}/messages`, { limit, offset });
    } catch {
      if (import.meta.env.VITE_TG_MOCK === 'true' && id.startsWith('mock-')) {
        return [];
      }
      throw new Error('Failed to load messages');
    }
  },

  sendMessage: (id: string, content: string) =>
    api.post<Message>(`/deals/${id}/messages`, { content }),

  getEvents: (id: string, limit = 50) =>
    api.get<unknown[]>(`/deals/${id}/events`, { limit }),
};

export const paymentsApi = {
  create: async (data: {
    dealId: string;
    amount: number;
    currency?: string;
    description?: string;
    /** 'cryptomus' (hosted, default) | 'crypto' (direct USDT to escrow). */
    method?: 'cryptomus' | 'crypto' | 'crypto_ton';
  }): Promise<CreatePaymentResponse> => {
    try {
      return await api.post<CreatePaymentResponse>('/payments', data);
    } catch {
      if (isMockMode()) {
        const deal = mockDealsState.find((d) => d.id === data.dealId);
        if (deal) {
          patchMockDeal(data.dealId, {
            metadata: {
              ...deal.metadata,
              paymentConfirming: true,
              paymentConfirmations: 3,
            },
          });
        }
        const mockPayment: Payment = {
          id: `mock-pay-${Date.now()}`,
          dealId: data.dealId,
          amount: data.amount,
          currency: data.currency ?? 'USDT',
          status: 'pending' as const,
          paymentUrl:
            data.method === 'cryptomus' ? 'https://pay.cryptomus.com/mock' : undefined,
          createdAt: new Date().toISOString(),
        };
        return {
          payment: mockPayment,
          paymentUrl: mockPayment.paymentUrl,
          deposit:
            data.method === 'crypto'
              ? {
                  address: '0x1111111111111111111111111111111111111111',
                  network: 'polygon',
                  asset: 'USDT',
                  requiredAmount: String(data.amount),
                }
              : data.method === 'crypto_ton'
                ? {
                    address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
                    network: 'ton',
                    asset: 'USDT',
                    requiredAmount: String(data.amount),
                    memo: 'TG-MOCK1234',
                    jettonMaster: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
                  }
                : undefined,
        };
      }
      throw new Error('Failed to create payment');
    }
  },

  /** Available payment rails (Cryptomus / direct USDT). */
  getMethods: async (): Promise<PaymentMethodInfo[]> => {
    try {
      return await api.get<PaymentMethodInfo[]>('/payments/methods');
    } catch {
      // Fallback: hosted checkout only.
      return [
        { method: 'cryptomus', label: 'Cryptomus', available: true, kind: 'hosted' },
      ];
    }
  },

  getAll: (limit?: number, offset?: number) =>
    api.get<Payment[]>('/payments', { limit, offset }),

  getById: (id: string) => api.get<Payment>(`/payments/${id}`),

  checkStatus: (id: string) => api.post<Payment>(`/payments/${id}/check`),

  /** Backend returns ALL payments of the current user for this deal (array). */
  getForDeal: (dealId: string) => api.get<Payment[]>(`/payments/deal/${dealId}`),
};

/** Row shape of GET /users/search (subset of User selected by the backend). */
export interface UserSearchRow {
  id: string;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  reputationScore?: number | null;
  completedDeals?: number | null;
}

export const usersApi = {
  getMe: () => api.get<User>('/users/me'),

  getStats: () => api.get<unknown>('/users/me/stats'),

  setLanguage: (languageCode: string) =>
    api.post<User>('/users/me/language', { languageCode }),

  updateProfile: (data: Partial<User>) => api.put<User>('/users/me', data),

  /**
   * Attach an EVM wallet so the user can act as seller or arbitrator in
   * on-chain settled deals. The backend enforces EIP-55 checksum and
   * uniqueness. Returns the updated User row.
   */
  attachWallet: (walletAddress: string) =>
    api.post<User>('/users/me/wallet', { walletAddress }),

  detachWallet: () => api.delete<User>('/users/me/wallet'),

  /**
   * Search users by telegram username / first name (min 2 chars,
   * backend returns an empty list for shorter queries).
   */
  search: (q: string, limit = 10) =>
    api.get<{ users: UserSearchRow[] }>('/users/search', { q, limit }),
};

export type ArbitratorAvailability = 'available' | 'away';

export interface ArbitratorProfileSummary {
  id: string;
  userId: string;
  status: 'active' | 'pending' | 'suspended' | 'rejected';
  availability: ArbitratorAvailability;
  rating: number;
  totalCases: number;
  completedCases: number;
}

export const arbitrationApi = {
  /** Self-service profile fetch (404 if user is not an arbitrator). */
  getMyProfile: () =>
    api.get<ArbitratorProfileSummary>('/arbitration/arbitrators/me'),

  /** Flip work-state. Backend enforces status === ACTIVE. */
  setMyAvailability: (availability: ArbitratorAvailability) =>
    api.patch<ArbitratorProfileSummary>(
      '/arbitration/arbitrators/me/availability',
      { availability },
    ),

  /**
   * Disputes where the current user participates (opener, arbitrator,
   * buyer or seller). For arbitrators this is their case list.
   */
  getMyDisputes: () => api.get<ArbitratorDisputeRow[]>('/arbitration/disputes'),

  getDisputeById: (id: string) =>
    api.get<ArbitratorDisputeDetail>(`/arbitration/disputes/${id}`),

  /** Multipart upload to POST /arbitration/disputes/:id/evidence/upload. */
  uploadEvidence: (
    disputeId: string,
    file: File,
    description?: string,
    type?: string,
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (description) form.append('description', description);
    if (type) form.append('type', type);
    return api.postForm<unknown>(
      `/arbitration/disputes/${disputeId}/evidence/upload`,
      form,
    );
  },
};

/** Deal summary embedded in dispute rows (subset of the Deal entity). */
export interface DisputeDealSummary {
  id: string;
  dealNumber?: number | string;
  status?: string;
  amount?: number;
  currency?: string;
}

/** Row of GET /arbitration/disputes. */
export interface ArbitratorDisputeRow {
  id: string;
  status: string;
  type?: string;
  createdAt: string;
  deal?: DisputeDealSummary | null;
}

/** Detail of GET /arbitration/disputes/:id (fields the UI renders). */
export interface ArbitratorDisputeDetail extends ArbitratorDisputeRow {
  reason?: string;
  evidence?: Array<{ id: string; name?: string; uploadedBy?: string }>;
  timeline?: Array<{ id: string; title: string; description?: string; at: string }>;
  decision?: {
    winner?: string;
    comment?: string;
    decidedAt?: string;
  } | null;
}

export interface TreasurySummary {
  ready: boolean;
  treasuryAddress: string;
  tokenAddress: string;
  decimals: number;
  /** Decimal string of token base units. */
  main: string;
  reserve: string;
  rawTokenBalance: string;
  untracked: string;
  reserveBps: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  aggregateType: string;
  aggregateId: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  action?: string;
  aggregateType?: string;
  aggregateId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/**
 * Backend-known notification event types. Keep in sync with
 * `notification-template.registry.ts` on the user-service. Mini-app
 * only needs this list for the per-event mute UI; unknown values are
 * tolerated (server is the source of truth).
 */
export const NOTIFICATION_EVENT_TYPES = [
  'deal.created',
  'deal.payment_received',
  'deal.completed',
  'deal.release_required',
  'deal.cancelled',
  'invite.accepted',
  'dispute.opened',
  'dispute.arbitrator_assigned',
  'dispute.decision_made',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export interface NotificationPreferences {
  id?: string;
  userId: string;
  mutedAll: boolean;
  mutedEventTypes: string[];
  /** "HH:MM" UTC, or null when disabled. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateNotificationPreferencesInput {
  mutedAll?: boolean;
  mutedEventTypes?: string[];
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

export const notificationsApi = {
  getPreferences: () =>
    api.get<NotificationPreferences>('/notifications/preferences'),

  updatePreferences: (input: UpdateNotificationPreferencesInput) =>
    api.patch<NotificationPreferences>('/notifications/preferences', input),
};

export interface AdminPaymentRow {
  id: string;
  transactionId: string;
  status: string;
  amount: number;
  currency: string;
  paidAt?: string;
  dealId?: string;
  deal?: { id: string; status: string; dealNumber?: string };
}

export const disputesApi = {
  list: async (): Promise<DisputeListItem[]> => {
    try {
      return await api.get<DisputeListItem[]>('/arbitration/disputes/my');
    } catch {
      if (USE_UI_MOCKS) return MOCK_DISPUTES;
      throw new Error('Failed to load disputes');
    }
  },

  getById: async (id: string): Promise<DisputeDetail> => {
    try {
      return await api.get<DisputeDetail>(`/arbitration/disputes/${id}`);
    } catch {
      if (USE_UI_MOCKS && MOCK_DISPUTE_DETAILS[id]) return MOCK_DISPUTE_DETAILS[id];
      throw new Error('Dispute not found');
    }
  },
};

export const storeApi = {
  getMyBots: async (): Promise<BotItem[]> => {
    try {
      return await api.get<BotItem[]>('/stores/my');
    } catch {
      if (USE_UI_MOCKS) return MOCK_BOTS;
      return [];
    }
  },

  getBot: async (id: string): Promise<BotItem | null> => {
    try {
      return await api.get<BotItem>(`/stores/${id}`);
    } catch {
      if (USE_UI_MOCKS) return getMockBot(id) ?? null;
      return null;
    }
  },
};

export const adminApi = {
  /** On-chain treasury balances + token info. Read-only. */
  getTreasurySummary: () => api.get<TreasurySummary>('/admin/treasury/summary'),

  /** Paginated audit log; combine filters with AND. */
  getAuditLog: (query: AuditLogQuery = {}) =>
    api.get<AuditLogPage>('/admin/audit-log', query as Record<string, unknown>),

  getPayments: (page = 1, limit = 20, status?: string) =>
    api.get<{ payments: AdminPaymentRow[]; total: number }>('/admin/payments', {
      page,
      limit,
      ...(status ? { status } : {}),
    }),

  getStuckFundingPayments: (limit = 50) =>
    api.get<AdminPaymentRow[]>('/admin/payments/stuck/funding', { limit }),

  /** GET /admin/deals — paginated, with buyer/seller relations. */
  getDeals: (page = 1, limit = 20, status?: string) =>
    api.get<{ deals: AdminDealRow[]; total: number }>('/admin/deals', {
      page,
      limit,
      ...(status ? { status } : {}),
    }),

  /** GET /admin/disputes — paginated, with deal relation. */
  getDisputes: (page = 1, limit = 20, status?: string) =>
    api.get<{ disputes: AdminDisputeRow[]; total: number }>('/admin/disputes', {
      page,
      limit,
      ...(status ? { status } : {}),
    }),

  /** GET /admin/users — paginated. */
  getUsers: (page = 1, limit = 20) =>
    api.get<{ users: AdminUserRow[]; total: number }>('/admin/users', {
      page,
      limit,
    }),

  /** GET /admin/disputes/arbitrators/performance — full arbitrator roster. */
  getArbitrators: () =>
    api.get<AdminArbitratorRow[]>('/admin/disputes/arbitrators/performance'),
};

/** Row of GET /admin/deals (Deal entity with buyer/seller joined). */
export interface AdminDealRow {
  id: string;
  dealNumber?: number | string;
  type?: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  buyer?: { telegramUsername?: string | null } | null;
  seller?: { telegramUsername?: string | null } | null;
}

/** Row of GET /admin/disputes (Dispute entity with deal joined). */
export interface AdminDisputeRow {
  id: string;
  status: string;
  type?: string;
  createdAt: string;
  deal?: { id: string; dealNumber?: number | string } | null;
  arbitrator?: { id: string } | null;
}

/** Row of GET /admin/users (User entity). */
export interface AdminUserRow {
  id: string;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  status: string;
  roles: string[];
  reputationScore?: number;
  completedDeals?: number;
  createdAt: string;
}

/** Row of GET /admin/disputes/arbitrators/performance. */
export interface AdminArbitratorRow {
  id: string;
  userId: string;
  username?: string | null;
  status: string;
  availability?: string;
  rating: number;
  totalCases: number;
  completedCases?: number;
  appealedCases?: number;
  overturnedCases?: number;
  totalEarned?: number;
  user?: { telegramUsername?: string | null } | null;
}

export const reviewsApi = {
  /** GET /reviews/user/:userId — reviews about the user + average rating. */
  getUserReviews: (userId: string, limit = 10, offset = 0) =>
    api.get<{
      reviews: import('../types').Review[];
      total: number;
      averageRating: number;
    }>(`/reviews/user/${userId}`, { limit, offset }),

  markHelpful: (reviewId: string, isHelpful: boolean) =>
    api.post<import('../types').Review>(`/reviews/${reviewId}/helpful`, {
      isHelpful,
    }),
};
