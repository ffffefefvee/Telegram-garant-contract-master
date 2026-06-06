export const UserRole = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ARBITRATOR: 'arbitrator',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface User {
  id: string;
  telegramId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  telegramLanguageCode?: string;
  email?: string;
  status: 'active' | 'inactive' | 'banned' | 'pending_verification';
  roles: UserRole[];
  balance: number;
  reputationScore: number;
  completedDeals: number;
  cancelledDeals: number;
  disputedDeals: number;
  walletAddress?: string | null;
  walletAttachedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  dealNumber: string;
  type: 'physical' | 'digital' | 'service' | 'rent';
  status: string;
  amount: number;
  currency: string;
  description: string;
  title?: string;
  terms?: string;
  buyer: User;
  seller?: User;
  buyerId: string;
  sellerId?: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  paidAt?: string;
  completedAt?: string;
  escrowAddress?: string;
  metadata?: {
    escrowAddress?: string;
    escrowReleaseRequired?: boolean;
    commissionModel?: string;
    digitalSubtype?: string;
    sellerPayoutCurrency?: string;
    buyerPayCurrency?: string;
    contractCreated?: boolean;
    paymentConfirming?: boolean;
    paymentConfirmations?: number;
    releaseTxHash?: string;
  };
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  type: 'text' | 'system';
  createdAt: string;
}

export interface Payment {
  id: string;
  dealId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentUrl?: string;
  createdAt: string;
}

export interface Review {
  id: string;
  rating: number;
  comment?: string;
  createdAt: string;
  isAnonymous?: boolean;
  author?: Pick<User, 'telegramFirstName' | 'telegramUsername'>;
  ratings?: Record<string, number>;
  helpfulCount?: number;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    telegramId: number;
    telegramUsername: string | null;
  };
}

/**
 * Minimal Telegram WebApp surface we rely on. The real SDK exposes far more —
 * we only type what is actually consumed.
 */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    auth_date?: number;
    hash?: string;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (eventType: string, handler: () => void) => void;
  offEvent: (eventType: string, handler: () => void) => void;
  HapticFeedback?: {
    impactOccurred?: (style: string) => void;
    notificationOccurred?: (type: string) => void;
  };
  MainButton?: {
    text: string;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    setText: (text: string) => void;
    enable: () => void;
    disable: () => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
}
