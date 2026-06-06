# Plan-prompt для Claude Sonnet 4.6 — Telegram Garant

Скопируйте блок **«Промпт для агента»** в новый чат Sonnet вместе с этим репозиторием.  
Цель: снять «витринный долг» (моки, пустая админка, заглушки) **без** изменений платёжного контура и blockchain.

---

## Промпт для агента (скопировать целиком)

```
Ты — разработчик в репозитории Telegram Garant (P2P escrow в Telegram).

## Сначала прочитай (обязательно, не пиши код до этого)

1. docs/SONNET_HANDOFF.md (этот файл) — scope и порядок PR.
2. docs/PRODUCT_PLAN.md — §1–3 (продукт), §7 (Mini App страницы), §9 (сущности). Не реализуй Phase 3+ (боты-конструктор, decentralized arb, mainnet).
3. mini-app/README.md — маршруты и структура UI.
4. mini-app/src/api/index.ts — как устроены api-клиенты (axios, auth token, mocks).
5. services/user-service/src/app.module.ts — какие модули уже есть.

Эталоны кода (копируй стиль отсюда):
- Список с загрузкой: mini-app/src/pages/DealsPage.tsx
- Админ-вкладка с пагинацией: mini-app/src/pages/AdminPage.tsx (PaymentsSection, AuditSection)
- FSM сделок (только читать, не менять без тикета): services/user-service/src/modules/deal/fsm/deal-state-machine.ts

## Жёсткие ограничения (OUT OF SCOPE)

НЕ трогай:
- payment-webhook, cryptomus, reconciliation, forwardAndFund
- blockchain env, .env, docker secrets, mainnet/deploy
- evidence.service.ts (пути на диск) — только UI → существующий upload endpoint
- удаление модуля store/ и страниц /bots
- on-chain enforce, форму решения арбитра со слайдерами 70/30
- git filter-repo, отзыв TELEGRAM_BOT_TOKEN

Definition of done на каждый PR:
- npm run build в затронутом пакете (mini-app и/или services/user-service)
- для нового backend endpoint — unit-тест по образцу user.service.spec.ts
- без регрессии существующих тестов: npm test -- --passWithNoTests (user-service)

Проверяй против реального API (VITE_API_URL=http://localhost:3001/api), не считай VITE_TG_MOCK=true достаточным критерием готовности.

## Порядок работы — три пакета, отдельный PR на пакет (или на пункт)

### Пакет A — mini-app wiring + docs (нулевой финансовый риск)

A1. Отзывы
- Backend уже есть: GET /api/reviews/user/:userId (review.controller.ts)
- Добавь reviewsApi в mini-app/src/api/index.ts
- Подключи mini-app/src/components/ReviewList.tsx — убери hardcoded mock array
- Loading / empty / error как в DealsPage

A2. Админ: сделки
- Backend: GET /api/admin/deals (admin-deal.controller.ts → DealService.findAllForAdmin)
- adminApi.getDeals(page, limit, status?) в api/index.ts
- Вкладка «Сделки» в AdminPage.tsx — таблица, пагинация, фильтр status

A3. Админ: споры
- Backend: GET /api/admin/disputes (admin-dispute.controller.ts)
- adminApi.getDisputes(...)
- Вкладка «Споры» в AdminPage.tsx — read-only список

A4. Убрать дубль-заглушку
- Удали GET /admin/deals с return { status: 'Not implemented yet' } из admin.controller.ts (строки ~68–75)
- Сделки только через AdminDealController (/admin/deals)

A5. Документация
- Обнови README.md: актуальная архитектура (user-service, mini-app, contracts), ссылка на docs/PRODUCT_PLAN.md
- В mini-app/README.md: раздел /bots пометь experimental / Phase 3

### Пакет B — backend search + споры/evidence UI

B1. Поиск контрагента
- Backend: GET /api/users/search?q= (telegram_username, limit 10, RequireAuth)
- Ответ: { users: [{ id, telegramUsername, reputationScore, completedDeals }] }
- Unit-тест в user.service.spec.ts
- DealNewPage.tsx: убрать MOCK_SEARCH_USERS, debounced fetch

B2. Evidence upload
- API client: arbitrationApi.uploadEvidence(disputeId, file, description?, type?) → POST /api/arbitration/disputes/:id/evidence/upload (multipart)
- UI: форма на DisputeDetailPage или после openDispute; убери TODO в DisputeFormSheet.tsx
- Не меняй evidence.service.ts

B3. Типы споров
- Вынеси типы из mini-app/src/mocks/disputes.ts в mini-app/src/types/ (например disputes.ts)
- DisputeDetailPage — поля согласовать с GET /api/arbitration/disputes/:id (читай dispute.entity / disputeService response)
- mocks — только fallback при USE_UI_MOCKS

B4. PaymentVerifyModal
- Подключи polling к paymentsApi.checkStatus (см. комментарий в PaymentVerifyModal.tsx)

### Пакет C — арбитр + админ users (read-only, без enforce)

C1. Кабинет арбитра — список
- Роуты под /arbitrator/* в App.tsx
- Список споров арбитра: уточни endpoint (disputes для arbitrator — admin-arbitration или arbitration controller)
- Убери placeholder «полный интерфейс в следующем релизе» когда есть список

C2. Кабинет арбитра — карточка
- /arbitrator/dispute/:id — read-only: статус, evidence, deal summary
- Кнопки accept/decline только если есть matching POST в arbitration.controller.ts
- БЕЗ MakeDecisionDto / enforce on-chain

C3. Админ: пользователи
- GET /api/admin/users уже в admin.controller.ts
- Вкладка read-only в AdminPage, без ban UI в этом PR

C4. Админ: арбитры
- GET /api/admin/arbitration/arbitrators (admin-arbitration.controller.ts)
- Read-only таблица в AdminPage

## Как работать

- Один PR = один пакет или один пункт (A1, A2, …).
- Перед изменением файла — прочитай соседний эталон.
- Не добавляй зависимости без необходимости.
- Коммиты не делай, если пользователь не просил.

Начни с Пакета A. После завершения A — краткий отчёт: что изменено, как проверить локально.
```

---

## Что изучить (карта чтения)

| Приоритет | Файл | Зачем |
|-----------|------|--------|
| P0 | [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) | Продукт, MVP scope, что **не** делать (§1, §7.1–7.3, §12) |
| P0 | [mini-app/src/api/index.ts](../mini-app/src/api/index.ts) | Все API-вызовы, моки, adminApi |
| P0 | [mini-app/src/App.tsx](../mini-app/src/App.tsx) | Маршруты и RoleGuard |
| P1 | [PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md) | Только контекст — **не реализовывать** (делает человек) |
| P1 | [CRYPTOMUS_INTEGRATION.md](./CRYPTOMUS_INTEGRATION.md) | Только контекст — не трогать webhook |
| P1 | [mini-app/README.md](../mini-app/README.md) | Экраны и dev-запуск |
| P1 | [README.md](../README.md) | Устарел — обновить в A5 |
| P2 | [deal-state-machine.ts](../services/user-service/src/modules/deal/fsm/deal-state-machine.ts) | Статусы сделок для UI |
| P2 | [admin-deal.controller.ts](../services/user-service/src/modules/admin/admin-deal.controller.ts) | Админ-сделки |
| P2 | [admin-dispute.controller.ts](../services/user-service/src/modules/admin/admin-dispute.controller.ts) | Админ-споры |
| P2 | [admin.controller.ts](../services/user-service/src/modules/admin/admin.controller.ts) | users + stub deals (удалить stub) |
| P2 | [admin-arbitration.controller.ts](../services/user-service/src/modules/arbitration/admin-arbitration.controller.ts) | Админ-арбитры |
| P2 | [arbitration.controller.ts](../services/user-service/src/modules/arbitration/arbitration.controller.ts) | disputes, evidence upload |
| P2 | [review.controller.ts](../services/user-service/src/modules/review/review.controller.ts) | Отзывы |
| P3 | [ArbitratorPage.tsx](../mini-app/src/pages/ArbitratorPage.tsx) | Текущий кабинет арбитра |
| P3 | [DealNewPage.tsx](../mini-app/src/pages/DealNewPage.tsx) | Мок поиска контрагента |
| P3 | [DisputeDetailPage.tsx](../mini-app/src/pages/DisputeDetailPage.tsx) | Споры UI |

---

## Готовые backend endpoints (не изобретать заново)

| Задача | Метод | Путь |
|--------|--------|------|
| Отзывы пользователя | GET | `/api/reviews/user/:userId` |
| Админ сделки | GET | `/api/admin/deals` |
| Админ споры | GET | `/api/admin/disputes` |
| Админ пользователи | GET | `/api/admin/users` |
| Админ арбитры | GET | `/api/admin/arbitration/arbitrators` |
| Мои споры | GET | `/api/arbitration/disputes` (+ `/my` в disputesApi) |
| Спор по id | GET | `/api/arbitration/disputes/:id` |
| Загрузка evidence | POST | `/api/arbitration/disputes/:id/evidence/upload` |
| Профиль арбитра | GET/PATCH | `/api/arbitration/arbitrators/me` |
| Казна / платежи / аудит | GET | `/api/admin/treasury/summary`, `/api/admin/payments`, `/api/admin/audit-log` |

**Нужно создать (Пакет B1):** `GET /api/users/search?q=` — в [user.controller.ts](../services/user-service/src/modules/user/user.controller.ts) пока нет.

**Удалить (Пакет A4):** дублирующий `GET /api/admin/deals` в [admin.controller.ts](../services/user-service/src/modules/admin/admin.controller.ts) с ответом `Not implemented yet`.

---

## Эталоны UI (копировать паттерн)

| Паттерн | Файл |
|---------|------|
| Список + skeleton + empty | `mini-app/src/pages/DealsPage.tsx` |
| Админ вкладка + пагинация + фильтр | `mini-app/src/pages/AdminPage.tsx` → `PaymentsSection` |
| API client метод | `mini-app/src/api/index.ts` → `dealsApi`, `adminApi` |
| Форма в bottom sheet | `mini-app/src/components/deal-room/DisputeFormSheet.tsx` |

---

## Чеклист приёмки (для каждого PR)

- [ ] `cd mini-app && npm run build` — успех
- [ ] `cd services/user-service && npm run build` — успех (если трогали backend)
- [ ] `cd services/user-service && npm test` — без новых падений
- [ ] Нет новых секретов в коде
- [ ] Моки остались только как fallback (`USE_UI_MOCKS`), не единственный путь
- [ ] Не изменены: payment-webhook, blockchain config, .env.example с реальными ключами

---

## Локальный запуск для проверки

```bash
# Backend + DB
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose exec user-service npm run migration:run

# Mini App
cd mini-app
npm install
npm run dev
# VITE_API_URL=http://localhost:3001/api
```

Auth в dev: `AUTH_DEV_MODE=true` на backend, при необходимости `VITE_TG_MOCK=true` только для входа — но фичи проверять с реальным API.

---

## Что остаётся человеку (не Sonnet)

- Настройка blockchain RPC, relay wallet, Amoy/mainnet
- Прогон [PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md)
- Cryptomus sandbox/production webhooks
- Отзыв bot token через @BotFather
- Найм арбитров, юрлицо, внешний аудит контрактов

---

*Документ для делегирования Sonnet 4.6. Не заменяет PRODUCT_PLAN — сужает scope до безопасных PR.*

Сложные задачи (платежи, blockchain, арбитраж enforce, контракты): [OPUS_HANDOFF.md](./OPUS_HANDOFF.md).
