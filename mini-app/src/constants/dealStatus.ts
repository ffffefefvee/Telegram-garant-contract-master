export type DealStatusKey =
  | 'draft'
  | 'pending_acceptance'
  | 'pending_payment'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'disputed'
  | 'dispute_resolved'
  | 'cancelled'
  | 'refunded'
  | 'frozen';

export const DEAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  pending_acceptance: 'Ожидает принятия',
  pending_payment: 'Ожидает оплаты',
  in_progress: 'В процессе',
  pending_confirmation: 'Ожидает подтверждения',
  completed: 'Завершена',
  disputed: 'Спор',
  dispute_resolved: 'Спор решён',
  cancelled: 'Отменена',
  refunded: 'Возврат',
  frozen: 'Заморожена',
};

export const DEAL_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral',
  pending_acceptance: 'warning',
  pending_payment: 'warning',
  in_progress: 'info',
  pending_confirmation: 'info',
  completed: 'success',
  disputed: 'danger',
  dispute_resolved: 'info',
  cancelled: 'neutral',
  refunded: 'warning',
  frozen: 'danger',
};

export const DEAL_TYPE_LABELS: Record<string, string> = {
  physical: 'Физический товар',
  digital: 'Цифровой товар',
  service: 'Услуга',
  rent: 'Аренда',
};

export const DEAL_FLOW_STEPS = [
  { key: 'conditions', label: 'Условия', description: 'Созданы' },
  { key: 'contract', label: 'Контракт', description: 'Создан' },
  { key: 'payment', label: 'Оплата', description: 'Ожидается' },
  { key: 'confirmation', label: 'Подтверждение', description: 'На проверке' },
  { key: 'done', label: 'Завершено', description: 'Готово' },
] as const;

export interface DealFlowProgressContext {
  hasEscrow?: boolean;
  paymentVerifying?: boolean;
}

/** 0–4 index for the 5-step deal flow progress bar */
export function getDealFlowStepIndex(
  status: string,
  ctx: DealFlowProgressContext = {},
): number {
  const hasEscrow = Boolean(ctx.hasEscrow);

  switch (status) {
    case 'draft':
    case 'pending_acceptance':
      return 0;
    case 'pending_payment':
      return hasEscrow ? 2 : 1;
    case 'in_progress':
      return 3;
    case 'pending_confirmation':
    case 'disputed':
    case 'frozen':
      return 3;
    case 'completed':
    case 'dispute_resolved':
      return 4;
    default:
      return 0;
  }
}

/** System chat messages keyed by deal status transition */
export function getDealSystemMessage(status: string): string | null {
  switch (status) {
    case 'pending_acceptance':
      return null;
    case 'pending_payment':
      return 'Система: смарт-контракт создан. Теперь покупатель может безопасно отправить средства — они будут заморожены до вашего подтверждения.';
    case 'in_progress':
      return 'Система: деньги заморожены, ожидайте выполнения продавцом.';
    case 'pending_confirmation':
      return 'Система: продавец выполнил условия. Нажимайте «Подтвердить получение», только если получили товар — деньги уйдут продавцу.';
    case 'completed':
      return 'Система: сделка завершена. Средства переведены продавцу.';
    case 'disputed':
      return 'Система: спор открыт. Арбитр изучит материалы, обычно до 24 часов.';
    default:
      return null;
  }
}

/** Extra system line after buyer accepts conditions */
export const DEAL_CONDITIONS_ACCEPTED_MESSAGE =
  'Система: условия согласованы обеими сторонами. Продавец может создать смарт-контракт.';

/** Cumulative system messages for the deal chat (shown in order) */
export function getDealSystemMessages(
  status: string,
  acceptedAt?: string,
  hasEscrow?: boolean,
): string[] {
  const messages: string[] = [];

  if (acceptedAt && status !== 'draft' && status !== 'pending_acceptance') {
    messages.push(DEAL_CONDITIONS_ACCEPTED_MESSAGE);
  }

  if (
    hasEscrow ||
    ['in_progress', 'pending_confirmation', 'completed', 'disputed'].includes(status)
  ) {
    messages.push(
      'Система: смарт-контракт создан. Теперь покупатель может безопасно отправить средства — они будут заморожены до вашего подтверждения.',
    );
  }

  if (['in_progress', 'pending_confirmation', 'completed', 'disputed'].includes(status)) {
    messages.push('Система: деньги заморожены, ожидайте выполнения продавцом.');
  }

  if (['pending_confirmation', 'completed'].includes(status)) {
    messages.push(
      'Система: продавец выполнил условия. Нажимайте «Подтвердить получение», только если получили товар — деньги уйдут продавцу.',
    );
  }

  if (status === 'completed' || status === 'dispute_resolved') {
    messages.push('Система: сделка завершена. Средства переведены продавцу.');
  }

  if (status === 'disputed' || status === 'frozen') {
    messages.push('Система: спор открыт. Арбитр изучит материалы, обычно до 24 часов.');
  }

  return messages;
}

export const DEAL_STEPPER_STEPS = [
  { key: 'created', label: 'Создана' },
  { key: 'accepted', label: 'Принята' },
  { key: 'paid', label: 'Оплачена' },
  { key: 'progress', label: 'В работе' },
  { key: 'confirmed', label: 'Подтверждена' },
  { key: 'released', label: 'Завершена' },
] as const;

export function getStepperIndex(status: string): number {
  switch (status) {
    case 'draft':
    case 'pending_acceptance':
      return 0;
    case 'pending_payment':
      return 1;
    case 'in_progress':
      return 3;
    case 'pending_confirmation':
      return 4;
    case 'completed':
    case 'dispute_resolved':
      return 5;
    case 'disputed':
    case 'frozen':
      return 3;
    default:
      return 0;
  }
}

export function getStatusLabel(status: string): string {
  return DEAL_STATUS_LABELS[status] || status;
}

export function getStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  return DEAL_STATUS_VARIANT[status] || 'neutral';
}
