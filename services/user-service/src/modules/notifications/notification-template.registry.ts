import { Injectable } from '@nestjs/common';

/**
 * Maps an outbox `eventType` to:
 *   - a list of recipient user-ids (extracted from the payload), and
 *   - a rendered message body (HTML, Telegram-parse-mode='HTML' safe).
 *
 * Keeping this as a registry (not inline in the dispatcher) makes it
 * trivial to add new notification types — just register a new builder
 * and the worker picks it up.
 */
export type Lang = 'ru' | 'en' | 'es';

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface RenderedNotification {
  text: string;
  keyboard?: InlineKeyboard;
}

export interface DeeplinkBuilder {
  /** Returns null if the bot/miniapp env isn't configured. */
  build: (path: string, payload?: string) => string | null;
}

export interface RenderInput {
  recipientUserId: string;
  lang: Lang;
  payload: Record<string, unknown>;
  deeplink: DeeplinkBuilder;
}

export type Renderer = (input: RenderInput) => RenderedNotification;

export interface NotificationTemplate {
  /** Outbox eventType this template matches. */
  eventType: string;
  /** Pulls recipient user-ids from the payload. */
  recipients: (payload: Record<string, unknown>) => string[];
  /** Renders the message body per recipient + language. */
  render: Renderer;
}

@Injectable()
export class NotificationTemplateRegistry {
  private readonly templates = new Map<string, NotificationTemplate>();

  register(template: NotificationTemplate): void {
    this.templates.set(template.eventType, template);
  }

  get(eventType: string): NotificationTemplate | undefined {
    return this.templates.get(eventType);
  }

  listRegisteredEventTypes(): string[] {
    return [...this.templates.keys()];
  }
}

// ─── Built-in templates ──────────────────────

export function registerBuiltinTemplates(
  registry: NotificationTemplateRegistry,
): void {
  // ─── Dispute lifecycle (H2S1 PR 1/3) ───

  registry.register({
    eventType: 'dispute.opened',
    recipients: (p) =>
      typeof p.opponentUserId === 'string' ? [p.opponentUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `⚖️ <b>Против вас открыт спор</b>\nСделка: ${safe(payload.dealTitle)}\nПричина: ${safe(payload.reason)}\n\nОткройте приложение, чтобы ответить.`,
          en: `⚖️ <b>A dispute has been opened against you</b>\nDeal: ${safe(payload.dealTitle)}\nReason: ${safe(payload.reason)}\n\nOpen the app to respond.`,
          es: `⚖️ <b>Se ha abierto una disputa contra usted</b>\nTrato: ${safe(payload.dealTitle)}\nMotivo: ${safe(payload.reason)}\n\nAbra la aplicación para responder.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('dispute', stringField(payload, 'disputeId')),
        pickLang(
          { ru: 'Открыть спор', en: 'Open dispute', es: 'Abrir disputa' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'dispute.arbitrator_assigned',
    recipients: (p) =>
      typeof p.arbitratorUserId === 'string' ? [p.arbitratorUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `🧑‍⚖️ <b>Вам назначен спор</b>\nСделка: ${safe(payload.dealTitle)}\nСумма: ${safe(payload.dealAmount)} USDT\nДедлайн: ${safe(payload.decisionDueAt)}`,
          en: `🧑‍⚖️ <b>A dispute has been assigned to you</b>\nDeal: ${safe(payload.dealTitle)}\nAmount: ${safe(payload.dealAmount)} USDT\nDeadline: ${safe(payload.decisionDueAt)}`,
          es: `🧑‍⚖️ <b>Se le ha asignado una disputa</b>\nTrato: ${safe(payload.dealTitle)}\nCantidad: ${safe(payload.dealAmount)} USDT\nFecha límite: ${safe(payload.decisionDueAt)}`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('arbitrator/dispute', stringField(payload, 'disputeId')),
        pickLang(
          { ru: 'Открыть спор', en: 'Open dispute', es: 'Abrir disputa' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'dispute.decision_made',
    recipients: (p) => {
      const ids: string[] = [];
      if (typeof p.buyerUserId === 'string') ids.push(p.buyerUserId);
      if (typeof p.sellerUserId === 'string') ids.push(p.sellerUserId);
      return ids;
    },
    render: ({ lang, payload, recipientUserId, deeplink }) => {
      const isBuyer = payload.buyerUserId === recipientUserId;
      const share = isBuyer ? payload.buyerShare : payload.sellerShare;
      return {
        text: pickLang(
          {
            ru: `📣 <b>Арбитр принял решение по спору</b>\nСделка: ${safe(payload.dealTitle)}\nВаша доля: ${safe(share)} USDT\n\nОткройте приложение, чтобы увидеть обоснование.`,
            en: `📣 <b>Arbitrator has made a decision</b>\nDeal: ${safe(payload.dealTitle)}\nYour share: ${safe(share)} USDT\n\nOpen the app to see the reasoning.`,
            es: `📣 <b>El árbitro ha tomado una decisión</b>\nTrato: ${safe(payload.dealTitle)}\nSu parte: ${safe(share)} USDT\n\nAbra la aplicación para ver el razonamiento.`,
          },
          lang,
        ),
        keyboard: maybeKeyboard(
          deeplink.build('dispute', stringField(payload, 'disputeId')),
          pickLang(
            { ru: 'Открыть спор', en: 'Open dispute', es: 'Abrir disputa' },
            lang,
          ),
        ),
      };
    },
  });

  // ─── Deal lifecycle (H2S1 PR 2/3) ───

  registry.register({
    eventType: 'deal.created',
    recipients: (p) =>
      typeof p.sellerUserId === 'string' ? [p.sellerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `🆕 <b>Вам предложена новая сделка</b>\nСделка: ${safe(payload.dealTitle)}\nСумма: ${safe(payload.dealAmount)}\n\nОткройте приложение, чтобы принять или отклонить.`,
          en: `🆕 <b>You have a new deal proposal</b>\nDeal: ${safe(payload.dealTitle)}\nAmount: ${safe(payload.dealAmount)}\n\nOpen the app to accept or decline.`,
          es: `🆕 <b>Tiene una nueva propuesta de trato</b>\nTrato: ${safe(payload.dealTitle)}\nCantidad: ${safe(payload.dealAmount)}\n\nAbra la aplicación para aceptar o rechazar.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Открыть сделку', en: 'Open deal', es: 'Abrir trato' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'deal.payment_reminder',
    recipients: (p) =>
      typeof p.buyerUserId === 'string' ? [p.buyerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `⏰ <b>Напоминание об оплате</b>\nСделка: ${safe(payload.dealTitle)}\nОплата ещё не получена — завершите платёж, чтобы продавец мог приступить к работе.`,
          en: `⏰ <b>Payment reminder</b>\nDeal: ${safe(payload.dealTitle)}\nPayment is still pending — complete it so the seller can proceed.`,
          es: `⏰ <b>Recordatorio de pago</b>\nTrato: ${safe(payload.dealTitle)}\nEl pago sigue pendiente.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang({ ru: 'Оплатить', en: 'Pay now', es: 'Pagar' }, lang),
      ),
    }),
  });

  registry.register({
    eventType: 'deal.payment_received',
    recipients: (p) =>
      typeof p.sellerUserId === 'string' ? [p.sellerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `💰 <b>Оплата получена</b>\nСделка: ${safe(payload.dealTitle)}\nСумма: ${safe(payload.dealAmount)}\n\nДеньги в эскроу — можно отгружать товар/услугу.`,
          en: `💰 <b>Payment received</b>\nDeal: ${safe(payload.dealTitle)}\nAmount: ${safe(payload.dealAmount)}\n\nFunds are in escrow — you can ship the goods/service.`,
          es: `💰 <b>Pago recibido</b>\nTrato: ${safe(payload.dealTitle)}\nCantidad: ${safe(payload.dealAmount)}\n\nLos fondos están en garantía — puede enviar.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Открыть сделку', en: 'Open deal', es: 'Abrir trato' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'deal.release_required',
    recipients: (p) =>
      typeof p.buyerUserId === 'string' ? [p.buyerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `🔓 <b>Выпустите средства из эскроу</b>\nСделка: ${safe(payload.dealTitle)}\nВы подтвердили получение — откройте Mini App и подпишите release() в кошельке покупателя.`,
          en: `🔓 <b>Release escrow funds</b>\nDeal: ${safe(payload.dealTitle)}\nYou confirmed receipt — open the Mini App and sign release() with the buyer wallet.`,
          es: `🔓 <b>Libere fondos del escrow</b>\nTrato: ${safe(payload.dealTitle)}\nConfirmó la recepción — abra la Mini App y firme release() con la wallet del comprador.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Выпустить средства', en: 'Release funds', es: 'Liberar fondos' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'deal.completed',
    recipients: (p) =>
      typeof p.sellerUserId === 'string' ? [p.sellerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `✅ <b>Сделка завершена</b>\nСделка: ${safe(payload.dealTitle)}\nПокупатель подтвердил получение, средства вам выплачены.`,
          en: `✅ <b>Deal completed</b>\nDeal: ${safe(payload.dealTitle)}\nBuyer confirmed receipt, funds have been released to you.`,
          es: `✅ <b>Trato completado</b>\nTrato: ${safe(payload.dealTitle)}\nEl comprador confirmó la recepción, los fondos le han sido liberados.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Открыть сделку', en: 'Open deal', es: 'Abrir trato' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'deal.cancelled',
    recipients: (p) =>
      typeof p.counterpartyUserId === 'string' ? [p.counterpartyUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `❌ <b>Сделка отменена контрагентом</b>\nСделка: ${safe(payload.dealTitle)}\n${payload.reason ? `Причина: ${safe(payload.reason)}` : ''}`.trim(),
          en: `❌ <b>Deal cancelled by counterparty</b>\nDeal: ${safe(payload.dealTitle)}\n${payload.reason ? `Reason: ${safe(payload.reason)}` : ''}`.trim(),
          es: `❌ <b>Trato cancelado por la contraparte</b>\nTrato: ${safe(payload.dealTitle)}\n${payload.reason ? `Motivo: ${safe(payload.reason)}` : ''}`.trim(),
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Открыть сделку', en: 'Open deal', es: 'Abrir trato' },
          lang,
        ),
      ),
    }),
  });

  registry.register({
    eventType: 'invite.accepted',
    recipients: (p) =>
      typeof p.buyerUserId === 'string' ? [p.buyerUserId] : [],
    render: ({ lang, payload, deeplink }) => ({
      text: pickLang(
        {
          ru: `🤝 <b>Контрагент принял приглашение</b>\nСделка: ${safe(payload.dealTitle)}\nСумма: ${safe(payload.dealAmount)}\n\nМожно оплатить — деньги уйдут в эскроу.`,
          en: `🤝 <b>Counterparty accepted your invite</b>\nDeal: ${safe(payload.dealTitle)}\nAmount: ${safe(payload.dealAmount)}\n\nYou can now pay — funds will go to escrow.`,
          es: `🤝 <b>La contraparte aceptó su invitación</b>\nTrato: ${safe(payload.dealTitle)}\nCantidad: ${safe(payload.dealAmount)}\n\nAhora puede pagar — los fondos irán a la garantía.`,
        },
        lang,
      ),
      keyboard: maybeKeyboard(
        deeplink.build('deal', stringField(payload, 'dealId')),
        pickLang(
          { ru: 'Открыть сделку', en: 'Open deal', es: 'Abrir trato' },
          lang,
        ),
      ),
    }),
  });
}

function pickLang(d: Record<Lang, string>, lang: Lang): string {
  return d[lang] ?? d.ru;
}

function safe(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = String(v);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stringField(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const v = payload[field];
  return typeof v === 'string' ? v : undefined;
}

function maybeKeyboard(
  url: string | null,
  buttonText: string,
): InlineKeyboard | undefined {
  if (!url) return undefined;
  return { inline_keyboard: [[{ text: buttonText, url }]] };
}
