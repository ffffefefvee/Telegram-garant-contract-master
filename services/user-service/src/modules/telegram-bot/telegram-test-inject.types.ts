import type { Update } from 'telegraf/types';

export interface TelegramTestCapture {
  text?: string;
  messageId?: number;
  chatId?: number;
  replyMarkup?: unknown;
}

export interface TelegramTestInjectResult {
  ok: boolean;
  capture: TelegramTestCapture | null;
  error?: string;
}

export type TelegramTestUpdate = Update;
