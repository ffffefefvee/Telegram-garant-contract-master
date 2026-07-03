# Telegram Garant — P2P Escrow в Telegram

P2P-гарант для Telegram: участник А и участник Б создают сделку через бота / Mini App, оплата замораживается в смарт-контракте, арбитр разрешает споры.
Подробное описание продукта: [docs/PRODUCT_PLAN.md](./docs/PRODUCT_PLAN.md)

## 🏗️ Архитектура

```
╒══════════════════════════════╕
║  Telegram Bot (NestJS)         ║
║  + Mini App (React/Vite)       ║   ← mini-app/
╠══════════════════════════════╣
║  user-service (NestJS/TS)      ║   ← services/user-service/
║    auth, deals, arbitration,   ║
║    payments, admin, reviews    ║
╠══════════════════════════════╣
║  contracts/ (Solidity)         ║   ← contracts/
║    EscrowFactory, Escrow        ║
╙══════════════════════════════╢

PostgreSQL + Redis  (docker-compose)
```

### Пакеты
| Папка | Назначение |
|---|---|
| `services/user-service/` | Backend API (NestJS), TypeORM, миграции |
| `mini-app/` | Telegram Mini App (React + Vite), маршруты и UI |
| `contracts/` | Solidity эскроу-контракты (Hardhat) |

## 🗄️ База Данных

### Таблицы

#### `users`
- `id` (UUID) - Primary key
- `telegram_id` (BIGINT) - ID пользователя Telegram
- `telegram_username` - Username из Telegram
- `telegram_first_name` - Имя
- `telegram_last_name` - Фамилия
- `telegram_language_code` - Язык Telegram
- `email` - Email (уникальный)
- `password_hash` - Хэш пароля
- `status` (ENUM) - active/inactive/banned/pending_verification
- `roles` (ENUM[]) - buyer/seller/arbitrator/admin
- `balance` (DECIMAL) - Баланс счёта
- `reputation_score` (DECIMAL) - Рейтинг репутации
- `completed_deals` - Завершённые сделки
- `cancelled_deals` - Отменённые сделки
- `disputed_deals` - Сделки со спорами
- `settings` (JSONB) - Настройки
- `metadata` (JSONB) - Дополнительные данные
- `created_at`, `updated_at`, `deleted_at`

#### `user_sessions`
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key к users
- `token` (VARCHAR) - Уникальный токен сессии
- `type` (ENUM) - telegram/web/api
- `ip_address`, `user_agent`, `device_info`
- `is_active`, `expires_at`, `last_activity_at`
- `revoked_at`, `revoke_reason`

#### `language_preferences`
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key к users
- `language_code` (ENUM) - ru/en/es
- `context` (VARCHAR) - Контекст языка (global, deal, etc.)
- `usage_count` - Счётчик использований

## 🌐 Интернационализация (i18n)

### Поддерживаемые языки
- 🇷🇺 Русский (ru)
- 🇬🇧 English (en)
- 🇪🇸 Español (es)

### Горячая перезагрузка
Переводы автоматически обновляются при изменении файлов в `/locales` без перезапуска сервиса.

### Автоматическое определение языка
- При первом запуске язык определяется из `Telegram User.language_code`
- Пользователь может изменить язык через `/language` или настройки
- Поддержка контекстных переводов (разные языки для разных частей приложения)

## 🤖 Telegram Bot

### Команды
| Команда | Описание |
|---------|----------|
| `/start` | Приветственное сообщение |
| `/menu` | Главное меню с кнопками |
| `/help` | Справка по командам |
| `/language` | Выбор языка |
| `/settings` | Настройки пользователя |
| `/profile` | Информация о профиле |

### Callback кнопки
- `menu_back` - Вернуться в меню
- `settings_language` - Выбор языка
- `lang_ru/en/es` - Изменение языка
- `deal_create` - Создание сделки
- `deals_list` - Список сделок
- `balance` - Баланс
- `profile` - Профиль
- `help` - Помощь
- `support` - Поддержка

## 🔐 Авторизация

### Middleware
- `AuthMiddleware` - Опциональная авторизация
- `RequireAuthMiddleware` - Обязательная авторизация
- `TelegramAuthMiddleware` - Авторизация через Telegram

### Сессии
- JWT-токены для веб-доступа
- Сессионные токены для Telegram
- Автоматическое продление активности
- Отзыв сессий

## 📦 Установка и запуск

### Предварительные требования
- Docker & Docker Compose
- Node.js 20+ (для локальной разработки)

### Быстрый старт

```bash
# Клонировать репозиторий
cd telegram-garant

# Скопировать .env.example в .env
cp .env.example .env

# Отредактировать .env (указать TELEGRAM_BOT_TOKEN)

# Запустить сервисы
docker-compose up -d

# Применить миграции
docker-compose exec user-service npm run migration:run

# Просмотр логов
docker-compose logs -f user-service
```

### Docker: разработка без пересборки на каждый коммит

Продакшен-образ копирует код внутрь образа — любая правка требует `docker compose build`. Для ежедневной работы используйте второй файл compose: исходники **проброшены с диска**, Nest перезапускается сам (`start --watch`), образ пересобирайте только когда меняются `package.json` / `Dockerfile.dev`.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

При первом включении dev-режима соберите образ `user-service` (иначе Compose может подставить старый production `:latest`):  
`docker compose -f docker-compose.yml -f docker-compose.dev.yml build user-service`  
или сразу `... up -d --build`.

Миграции в этом режиме те же:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec user-service npm run migration:run
```

Если обновили зависимости и что-то ломается — один раз удалите том с `node_modules` (имя посмотрите в `docker volume ls`, чаще всего суффикс `user_service_node_modules`) и поднимите стек снова, чтобы entrypoint снова выполнил `npm install`.

Сборки ускорены за счёт `.dockerignore`: в контекст Docker не попадают локальные `node_modules` и `dist`.

### Фронтенд (mini-app) в режиме разработки

Самый быстрый вариант — не в Docker:

```bash
cd mini-app
npm install
npm run dev
```

API по умолчанию указывайте на `http://localhost:3001` (порт `user-service` из compose). При необходимости можно собрать отдельный образ с `mini-app/Dockerfile.dev` и запускать Vite в контейнере (аналогично backend, с монтированием `./mini-app:/app` и томом для `node_modules`).

### Локальная разработка

```bash
cd services/user-service

# Установить зависимости
npm install

# Запустить в режиме разработки
npm run start:dev

# Запустить с дебагом
npm run start:debug
```

## 🧪 Тестирование

```bash
# Unit тесты
npm run test

# Тесты с покрытием
npm run test:cov

# E2E тесты
npm run test:e2e
```

## 🔧 Миграции БД

```bash
# Создать новую миграцию
npm run migration:generate --name=MigrationName

# Применить миграции
npm run migration:run

# Откатить миграцию
npm run migration:revert
```

## 📡 API Endpoints

### Users
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/users` | Создать пользователя |
| GET | `/api/users/telegram/:id` | Найти по Telegram ID |
| GET | `/api/users/email/:email` | Найти по email |
| GET | `/api/users/me` | Текущий пользователь (auth) |
| GET | `/api/users/:id` | Найти по UUID |
| PUT | `/api/users/:id` | Обновить пользователя |
| DELETE | `/api/users/:id` | Удалить пользователя |

### Sessions
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/users/:id/sessions` | Создать сессию |
| DELETE | `/api/users/:id/sessions/:token` | Отозвать сессию |

### Language
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/users/:id/language` | Получить язык |
| POST | `/api/users/:id/language` | Установить язык |

### Stats
| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/users/:id/stats` | Статистика пользователя |
| POST | `/api/users/:id/balance` | Обновить баланс |

## 🔑 Environment Variables

```env
# Database
DB_USERNAME=garant_user
DB_PASSWORD=garant_secure_pass_2024
DB_NAME=garant_db
DB_PORT=5432

# Redis
REDIS_PASSWORD=garant_secure_redis_2024
REDIS_PORT=6379

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here

# JWT
JWT_SECRET=your_super_secret_jwt_key

# Application
NODE_ENV=development
USER_SERVICE_PORT=3001

# i18n
I18N_HOT_RELOAD=true
```

## 📊 Мониторинг

### Health Checks
- PostgreSQL: автоматическая проверка подключения
- Redis: проверка доступности
- Bot: проверка статуса запуска

### Логирование
- Development: подробные логи
- Production: ошибки и предупреждения

## 📈 Статус готовности

Кодовая часть MVP практически завершена. Тесты: backend **318/318**, контракты
**114/114**, mini-app — сборка проходит.

### ✅ Готово
- Auth (Telegram initData + JWT), i18n, профили/роли.
- Сделки: модели, FSM, invite/accept/cancel, чат, escrow release.
- Платежи: Cryptomus + TON + direct-USDT rails, reconciliation, идемпотентность webhook.
- Арбитраж: споры, evidence upload, назначение арбитров, on-chain resolve.
- Смарт-контракты: EscrowFactory/Implementation, PlatformTreasury, ArbitratorRegistry.
- **Справедливая комиссия в споре**: невиновная сторона не платит (см. ·6.5 PRODUCT_PLAN).
- Мониторинг: cron-алерты застрявших платежей, treasury reserve, TON ops.
- Единый источник комиссий + startup-сверка on-chain/off-chain.

### ⏳ Осталось (не код / инфраструктура)
- **HIGH**: вынести relay-ключ (`BLOCKCHAIN_PRIVATE_KEY`) в KMS/Vault
  (см. [docs/RELAY_KMS_SIGNER_CHECKLIST.md](./docs/RELAY_KMS_SIGNER_CHECKLIST.md)).
- **MEDIUM**: редеплой `EscrowImplementation` (изменён `resolve()`) + обновление адреса,
  проверка на Amoy testnet.
- **MEDIUM**: реальный E2E платежей в Cryptomus sandbox
  (см. [docs/PAYMENTS_E2E_CHECKLIST.md](./docs/PAYMENTS_E2E_CHECKLIST.md)).
- **LOW**: техдолг — два пути открытия спора свести на общий код.
- **Человек/бизнес**: внешний аудит контрактов, mainnet deploy, юрлицо, KYC,
  найм арбитров, отзыв утёкшего bot-токена.

Подробнее: [docs/PAYMENTS_HARDENING_PLAN.md](./docs/PAYMENTS_HARDENING_PLAN.md).

## 🛡️ Безопасность

- Все endpoints защищены middleware
- Пароли хэшируются (будет реализовано в Фазе 3)
- Сессии автоматически истекают
- Поддержка CORS
- Валидация входных данных

## 📄 License

MIT
