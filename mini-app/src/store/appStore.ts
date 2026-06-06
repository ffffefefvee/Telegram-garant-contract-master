import { create } from 'zustand';
import { authApi } from '../api';
import type { Deal, Message, User } from '../types';

export type AuthStatus = 'idle' | 'pending' | 'authenticated' | 'error';

interface AppState {
  // Auth
  user: User | null;
  authStatus: AuthStatus;
  authError: string | null;

  // Current deal
  currentDeal: Deal | null;
  messages: Message[];

  // UI State
  isLoading: boolean;
  error: string | null;
  theme: 'light' | 'dark';

  // Actions
  setUser: (user: User | null) => void;
  setAuthStatus: (status: AuthStatus, error?: string | null) => void;
  setCurrentDeal: (deal: Deal | null) => void;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  logout: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  authStatus: 'idle',
  authError: null,
  currentDeal: null,
  messages: [],
  isLoading: false,
  error: null,
  theme: 'light',

  setUser: (user) =>
    set({
      user,
      authStatus: user ? 'authenticated' : 'idle',
      authError: null,
      isLoading: false,
    }),

  setAuthStatus: (authStatus, authError = null) => set({ authStatus, authError }),

  setCurrentDeal: (deal) => set({ currentDeal: deal }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  setMessages: (messages) => set({ messages }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setTheme: (theme) => set({ theme }),

  logout: () => {
    authApi.logout();
    set({
      user: null,
      authStatus: 'idle',
      authError: null,
      currentDeal: null,
      messages: [],
      error: null,
    });
  },
}));

export const hasRole = (user: User | null | undefined, role: string): boolean =>
  !!user && Array.isArray(user.roles) && user.roles.includes(role as never);
