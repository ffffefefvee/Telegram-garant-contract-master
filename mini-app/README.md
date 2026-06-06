# Telegram Guarantee Bot - Mini App

React + TypeScript Mini App для Telegram Guarantee Bot.

## 🚀 Быстрый старт

### Установка зависимостей

```bash
cd mini-app
npm install
```

### Запуск в режиме разработки

```bash
npm run dev
```

Приложение будет доступно по адресу: http://localhost:5173

### Сборка для продакшена

```bash
npm run build
```

## Карта экранов (UI)

| Маршрут | Экран |
|---------|--------|
| `/deals` | Дашборд: приветствие, быстрые действия, боты, список сделок |
| `/deal/new` | Создание сделки (контрагент, USDT, подтверждение, адрес контракта) |
| `/deals/:id` | Комната сделки: вкладки Чат / Условия / Контракт |
| `/disputes`, `/disputes/:id` | Споры и детали с таймлайном |
| `/bots`, `/bots/new`, `/bots/:id`, `/bots/:id/stats` | Конструктор ботов (**experimental / Phase 3**, не MVP) |
| `/profile` | Профиль, TrustScore, проверка контрагента |
| `/arbitrator/*`, `/admin/*` | Роли (из профиля) |

Нижняя навигация: **Сделки · Боты · Споры · Профиль**. Дизайн: тёмная тема ZELENKA (`--color-accent: #2eb872`), max-width 390px.

Mock-данные: `VITE_USE_UI_MOCKS=true` или автоматически в `import.meta.env.DEV` для споров/ботов при недоступном API.

## 📁 Структура проекта

```
mini-app/
├── src/
│   ├── api/           # API клиент и методы
│   ├── mocks/         # Демо-данные UI
│   ├── components/    # React компоненты
│   │   ├── shared/    # ContractAddress, PaymentVerifyModal, …
│   │   ├── deal-room/ # Вкладки комнаты сделки
│   │   ├── profile/   # TrustScore, проверка контрагента
│   │   ├── ChatWindow.tsx
│   │   ├── DealCard.tsx
│   │   └── BottomNav.tsx
│   ├── hooks/         # Custom hooks
│   │   └── useTelegramWebApp.ts
│   ├── pages/         # Страницы приложения
│   │   ├── DealsPage.tsx
│   │   ├── DealChatPage.tsx
│   │   └── ProfilePage.tsx
│   ├── store/         # Zustand store
│   │   └── appStore.ts
│   ├── styles/        # Глобальные стили
│   │   └── global.css
│   ├── types/         # TypeScript типы
│   │   └── index.ts
│   ├── utils/         # Утилиты
│   ├── App.tsx        # Главный компонент
│   └── main.tsx       # Точка входа
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 🎨 Компоненты

### ChatWindow
Компонент чата в стиле Telegram с поддержкой:
- Отправки сообщений
- Отображения времени
- Системных сообщений
- Анимации

### DealCard / DealList
Карточки сделок с:
- Статусами и бейджами
- Суммами и комиссиями
- Фильтрацией

### BottomNav
Нижняя навигационная панель с:
- 4 основными разделами
- Активными состояниями
- Telegram-подобным дизайном

## 🔧 Технологии

- **React 18** - UI библиотека
- **TypeScript** - Типизация
- **Vite** - Сборщик
- **React Router** - Роутинг
- **Zustand** - Управление состоянием
- **Axios** - HTTP клиент
- **date-fns** - Работа с датой
- **Telegram WebApp SDK** - Интеграция с Telegram

## 🎯 Интеграция с Telegram

### WebApp API
Приложение использует Telegram WebApp SDK для:
- Получения данных пользователя
- Управления MainButton и BackButton
- Тактильной обратной связи (HapticFeedback)
- Темы оформления (автоматическая адаптация)

### Инициализация
```typescript
import { useTelegramWebApp } from './hooks/useTelegramWebApp';

const { webApp, user, isDarkMode, mainButton, haptic } = useTelegramWebApp();
```

## 🌐 API Integration

API клиент настроен на `http://localhost:3001/api`

Изменить можно в `.env`:
```env
VITE_API_URL=https://your-api.com/api
```

### Основные методы:
```typescript
import { dealsApi, paymentsApi, usersApi } from './api';

// Сделки
const deals = await dealsApi.getAll();
const deal = await dealsApi.getById('id');
await dealsApi.sendMessage('id', 'Hello');

// Платежи
const payment = await paymentsApi.create({ type: 'deal_payment', amount: 1000 });

// Пользователь
const user = await usersApi.getMe();
```

## 📱 Адаптивный дизайн

Приложение автоматически адаптируется под:
- Светлую/тёмную тему Telegram
- Разные размеры экранов
- Safe area insets (iOS)

## 🚀 Деплой

### 1. Сборка
```bash
npm run build
```

### 2. Размещение файлов
Файлы из `dist/` загрузить на хостинг:
- GitHub Pages
- Vercel
- Netlify
- Ваш сервер

### 3. Настройка в Telegram
1. Откройте @BotFather
2. Выберите бота
3. Bot Settings → Menu Button → Configure Menu Button
4. Укажите URL вашего приложения

## 🎨 Темизация

Приложение использует CSS переменные Telegram:
```css
--tg-theme-bg-color
--tg-theme-text-color
--tg-theme-button-color
--tg-theme-hint-color
--tg-theme-secondary-bg-color
```

## 📝 Зависимости для Фазы 6

Следующая фаза (Отзывы и репутация) будет использовать:
- Компоненты UI для отображения отзывов
- API клиент для отправки отзывов
- ProfilePage для отображения репутации

---

**Статус**: ✅ Фаза 5 завершена
**Версия**: 1.0.0
