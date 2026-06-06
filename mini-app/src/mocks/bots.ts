export interface BotItem {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  transactionCount: number;
  currencies: string[];
  welcomeMessage: string;
  rulesText: string;
  totalVolumeRub: number;
  successfulDeals: number;
  disputedDeals: number;
  weeklyStats: { label: string; value: number }[];
}

export const MOCK_BOTS: BotItem[] = [
  {
    id: 'bot-1',
    name: 'Shop Bot',
    description: 'Автопродажа цифровых ключей',
    status: 'active',
    transactionCount: 24,
    currencies: ['RUB', 'USDT'],
    welcomeMessage: 'Добро пожаловать! Выберите товар.',
    rulesText: 'Оплата через гарант. Возврат только через спор.',
    totalVolumeRub: 125000,
    successfulDeals: 22,
    disputedDeals: 1,
    weeklyStats: [
      { label: 'Пн', value: 4 },
      { label: 'Вт', value: 7 },
      { label: 'Ср', value: 3 },
      { label: 'Чт', value: 9 },
      { label: 'Пт', value: 6 },
      { label: 'Сб', value: 2 },
      { label: 'Вс', value: 5 },
    ],
  },
  {
    id: 'bot-2',
    name: 'Keys Store',
    description: 'Магазин лицензий',
    status: 'inactive',
    transactionCount: 3,
    currencies: ['RUB'],
    welcomeMessage: 'Привет!',
    rulesText: 'Правила магазина.',
    totalVolumeRub: 8900,
    successfulDeals: 3,
    disputedDeals: 0,
    weeklyStats: [
      { label: 'Пн', value: 0 },
      { label: 'Вт', value: 1 },
      { label: 'Ср', value: 0 },
      { label: 'Чт', value: 2 },
      { label: 'Пт', value: 0 },
      { label: 'Сб', value: 0 },
      { label: 'Вс', value: 0 },
    ],
  },
];

export function getMockBot(id: string): BotItem | undefined {
  return MOCK_BOTS.find((b) => b.id === id);
}
