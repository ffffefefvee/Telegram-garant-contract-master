import { Markup } from 'telegraf';
import { User } from '../user/entities/user.entity';

type InlineKeyboardMarkup = ReturnType<typeof Markup.inlineKeyboard>;

/** Skip Telegram names that are empty or only punctuation (e.g. ")" from display quirks). */
function isMeaningfulName(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 1 && /[\p{L}\p{N}]/u.test(trimmed);
}

/** HTML-safe display line for profile and similar cards. */
export function formatTelegramUserDisplayName(user: User): string {
  const full = user.fullName?.trim();
  if (isMeaningfulName(full)) {
    const handle = user.telegramUsername ? ` (@${user.telegramUsername})` : '';
    return `<b>${full}</b>${handle}`;
  }
  if (user.telegramUsername) {
    return `<b>@${user.telegramUsername}</b>`;
  }
  return `<b>ID ${user.telegramId}</b>`;
}

/** Telegraf Markup must be spread into extra, not nested under `reply_markup`. */
export function withInlineKeyboard(
  markup: InlineKeyboardMarkup,
  extra?: { parse_mode?: 'HTML' | 'Markdown' },
): { parse_mode?: 'HTML' | 'Markdown'; reply_markup: InlineKeyboardMarkup['reply_markup'] } {
  return {
    ...extra,
    reply_markup: markup.reply_markup,
  };
}
