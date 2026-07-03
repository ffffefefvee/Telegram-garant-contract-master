# Payments Hardening Plan

План доработки финансовой части (Cryptomus → relay → on-chain escrow, TON rails,
direct-USDT). Отражает выполненные исправления и то, что осталось.

Связанные документы: [CRYPTOMUS_INTEGRATION.md](./CRYPTOMUS_INTEGRATION.md),
[PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md), [PRODUCT_PLAN.md](./PRODUCT_PLAN.md).

---

## Статус тестов (на момент последнего обновления)

| Набор | Результат |
|-------|-----------|
| Backend (`services/user-service`, `npm test`) | **318 / 318** ✅ |
| Смарт-контракты (`contracts`, `npx hardhat test`) | **114 / 114** ✅ |
| Mini-app (`mini-app`, `npm run build`) | ✅ сборка проходит |

Ключи/валюта для тестов НЕ требуются: backend — на моках, контракты — на локальном
Hardhat-узле с `MockERC20`. Реальные ключи нужны только для E2E в sandbox
(см. `PAYMENTS_E2E_CHECKLIST.md`).

---

## ✅ Сделано

### 1. Reconciliation фондирует в USDT, а не в фиате — `fix e651463` (HIGH)
`ReconciliationService` фондировал on-chain escrow суммой `Number(deal.amount)` —
в валюте сделки (по умолчанию RUB), хотя контракт ожидает USDT. Для RUB-сделки это
привело бы к фондированию ~50000 USDT вместо ~550.
- Добавлен `resolveFundingUsdt()` с приоритетом `deal.amountUsdt` →
  `payment.cryptoAmount` → USDT-quote → **safe-skip** (если USDT определить нельзя).
- Файлы: `modules/ops/reconciliation.service.ts` (+ spec). +3 теста.

### 2. Идемпотентность Cryptomus-webhook — `feat deb3433` (HIGH)
Повторный `PAID` (ретрай Cryptomus / ручной replay) снова вызывал `forwardAndFund`
→ второй USDT-перевод relay'ем (потеря денег). Docstring обещал идемпотентность,
но её не было.
- Новая сущность `ProcessedWebhookEvent` + миграция
  `1716400000000-CreateProcessedWebhookEvents` (unique `provider,eventKey`).
- `WebhookIdempotencyService` (`isProcessed`/`markProcessed`, запись только после
  успешного перевода; гонка дублей гасится swallow unique-violation).
- Guard перед `forwardAndFund`: skip, если событие обработано **или** сделка уже не
  в `PENDING_PAYMENT`.

### 3. Replay-защита webhook: IP allowlist — `feat deb3433` (HIGH)
Cryptomus не присылает nonce/timestamp, поэтому защита от replay = идемпотентность
(эффект) + ограничение источника (кто вызывает).
- `WebhookIpAllowlistGuard`, opt-in через `CRYPTOMUS_WEBHOOK_IP_ALLOWLIST`
  (офиц. IP Cryptomus `91.227.144.54`). Пусто → no-op с предупреждением (локалка/ngrok).
- Подключён в `CryptomusWebhookController` перед rate-limit; добавлена env в `.env.example`.

### 4. Сериализация relay-транзакций — `fix d87840d` (MEDIUM)
Общий relay-signer использовался конкурентно (webhook + watcher + reconciliation +
treasury cron) → одинаковый nonce → нода отбрасывала вторую tx («nonce too low»),
теряя fund-forwarding.
- `RelayTxQueue` сериализует все relay-write'ы (`transfer`, `notifyFunded`,
  `assignArbitrator`, `createEscrow`, `extend/expire`, `treasury.reconcile`) через
  broadcast+confirmation. Арбитражный `resolve()` (другой кошелёк) НЕ в очереди.
- Файлы: `modules/blockchain/relay-tx-queue.ts` (+ spec), обновлены 4 write-клиента
  и `blockchain.module.ts`. +6 тестов.

### 5. Атомарный recovery `forwardAndFund` — `fix 00049b1` (MEDIUM)
`transfer` + `notifyFunded` — две tx. Если `notify` падал после успешного `transfer`,
USDT уже в клоне, а повторный прогон переводил **второй раз** (double-spend).
- Теперь сначала читается on-chain состояние: skip если уже `FUNDED`; иначе
  переводится только недостающий shortfall до `amount + buyerFee`, затем `notifyFunded`.
- Результат: nullable tx-хэши + `alreadyFunded`. Обновлены TON rail и webhook.
- Файлы: `modules/blockchain/relay.service.ts` (+ spec), `escrow.service.ts`,
  `payment-webhook.service.ts`, `rails/ton-rail.base.ts`. +8 тестов.

### 6. Парсинг денег на границе без float-дрейфа — `fix 688334d` (MEDIUM)
Cryptomus присылает суммы строками; `parseFloat` гонял их через float и записывал
**NaN** в `payment.cryptoAmount` (decimal-колонка) при пустом/мусорном входе.
- `parseUsdtToWei` / `normalizeUsdtAmount`: точный разбор строки → 6-decimal wei,
  усечение >6 знаков (без over-credit), reject NaN/Infinity/negative/мусор/огромных сумм.
- `EscrowService.toWei` и webhook (FX lock + `cryptoAmount`) проведены через парсер.
- Файлы: `modules/escrow/usdt-amount.ts` (+ spec), `escrow.service.ts`,
  `payment-webhook.service.ts`. +17 тестов.

### 7. Оффлайн-fallback solc для Hardhat — `build 05f8650` (tooling)
`binaries.soliditylang.org` недоступен в ограниченных сетях (TLS виснет → HH502).
- Override `TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD`: использовать локальный
  `solc@0.8.20` (`npm i --no-save solc@0.8.20`), если установлен и версия совпадает;
  иначе — штатный загрузчик Hardhat (чисто аддитивно).
- Файл: `contracts/hardhat.config.ts`.

### 8. Распределённый лок TON `fundingLocks` в Redis (LOW)
Прежний `private readonly fundingLocks = new Set<string>()` в `BaseTonRail`
защищал float от двойного `forwardAndFund`, только пока процесс один: Set не
переживал рестарт и не разделялся между репликами → при горизонтальном
масштабировании возможен двойной перевод из float.
- Новый `TonFundingLockService`: `SET lock:ton-fund:<escrow> NX PX <ttl>` на
  входе, `DEL` в `finally`; TTL (`TON_FUNDING_LOCK_TTL_MS`, по умолчанию 120s) —
  предохранитель на случай краха держателя лока.
- Два слоя: Redis (межинстансный mutex) + локальный `Set` (guard в рамках
  инстанса **и** graceful-fallback, если Redis недоступен/SQLite-режим) —
  паттерн деградации как в `TelegramSessionStore`.
- `BaseTonRail.checkStatus` теперь `acquire`/`release` вместо Set; оба рейла
  (`ton-usdt`, `toncoin`) прокидывают сервис через конструктор; провайдер
  добавлен в `payment.module.ts`, env — в `.env.example`.
- Файлы: `modules/payment/rails/ton-funding-lock.service.ts` (+ spec),
  `ton-rail.base.ts`, `ton-usdt.rail.ts`, `toncoin.rail.ts`, `payment.module.ts`
  (+ обновлены spec'ы рейлов). +11 тестов.

**Примечание:** дополняет п.5 (recovery-aware `forwardAndFund` уже не переводит
повторно, если escrow `FUNDED` или баланс достаточен) — теперь двойной перевод
невозможен и при нескольких репликах.

### 9. B1 — `resolve()` удерживает уменьшенную комиссию (MEDIUM)
Было: в `release()` `totalFee` уходит в Treasury, а в `resolve()` весь `escrowBalance`
(за вычетом штрафа) делился между buyer/seller — платформа не получала комиссию по
спорным сделкам.
Бизнес-решение (USER): невиновная сторона НЕ платит комиссию из-за того, что в сделке
есть скамер. Комиссия при споре — уменьшенная (`DISPUTE_FEE_BPS=5000`, 50% от штатной)
и удерживается ТОЛЬКО из доли ВИНОВНОЙ стороны, пропорционально вине.
- `_computeResolveSplit()` (чистая функция, struct `ResolveSplit`): вина покупателя =
  `sellerSharePct`, вина продавца = `buyerSharePct`; `feeFromBuyer`/`feeFromSeller`
  capped долей каждого → полностью невиновный платит 0.
- Новое поле `feeToTreasury` в событии `Resolved`; ABI бэкенда синхронизирован.
- Файлы: `contracts/contracts/EscrowImplementation.sol`,
  `contracts/test/EscrowFactory.test.ts` (+3 теста). Контракты: 114/114.
- ⚠️ Требует редеплоя `EscrowImplementation` + обновления адреса.

### 10. B2 — единый источник комиссий + стартап-сверка (LOW)
Было: off-chain `CommissionConfigService` (RUB) и on-chain `EscrowFactory.computeTotalFee`
(USDT-wei) держали независимые копии сетки.
- `payment/fee-model.ts` — единый источник D5 (`D5_PERCENT_BPS=500`, threshold/flat) +
  `computeDealFeeRub()`; `CommissionConfigService` использует их (дубли убраны).
- `FeeConsistencyService` (`OnModuleInit`) читает on-chain `tariff.percentFeeBps` через
  `FactoryClient.readTariff()` и сверяет с canonical (сравним только процент —
  валюто-независимый параметр). Stub → skip; mismatch + `FEE_CONSISTENCY_STRICT=true`
  → abort boot; иначе → error-лог.
- Env `FEE_CONSISTENCY_STRICT` в `.env.example`. Тесты: property-тест + сверка (+9).

### 11. B3 — cron-алертинг застрявших платежей (MEDIUM)
Было: `PaymentService.findStuckFunding` вызывался только вручную из admin-панели.
- `MonitoringService.checkStuckFunding()` + интервал в `startMonitoring()`
  (`STUCK_FUNDING_CHECK_INTERVAL_MS`, по умолчанию 5 мин). При
  `findStuckFunding().length > STUCK_FUNDING_ALERT_THRESHOLD` — один `SystemAlert`
  (ERROR → Telegram админам), дедуп через `createAlertOnce` (без спама).
- Env `STUCK_FUNDING_ALERT_THRESHOLD`, `STUCK_FUNDING_CHECK_INTERVAL_MS` в `.env.example`.
  Тесты: `monitoring.service.spec.ts` (+5).

### 12. Bonus — связка openDispute → Dispute-сущность
Было (обнаружено при работе над mini-app): `DealService.openDispute`
(`POST /deals/:id/dispute`, используется фронтом) только выставлял
`deal.status = DISPUTED` и НЕ создавал `Dispute`-сущность, поэтому `disputeId` для
загрузки evidence не существовал.
- `DisputeService.createDisputeForDeal()` — узкий идемпотентный метод (Dispute + чат +
  событие, без дублирования статуса/статистики/outbox).
- `DealService.openDispute()` вызывает его, кладёт `dispute.id` в
  `deal.metadata.disputeId` и в outbox-payload; DI через взаимные `forwardRef`.
- Mini-app: `DealChatPage.handleDispute` грузит файлы через
  `arbitrationApi.uploadEvidence` (`Promise.allSettled`), TODO в `DisputeFormSheet` убран.

---

## ⏳ Осталось

### HIGH — ключ relay в KMS/Vault (требует инфраструктуры)
**Где:** `BLOCKCHAIN_PRIVATE_KEY` (env) → `BlockchainProvider` (`ethers.Wallet`).
**Проблема:** приватный ключ hot-wallet в `.env` — единая точка компрометации всех
средств «в полёте». Нет KMS/HSM/Vault.
**План:** вынести подпись в внешний signer (AWS KMS / GCP KMS / HashiCorp Vault
Transit) за интерфейсом вместо `ethers.Wallet`. **Невозможно проверить локально** в
текущей среде без доступа к KMS — делать в целевом окружении.
**Что нужно от USER для закрытия** (выбор провайдера, провижининг ключа, доступы,
env, приёмка): [RELAY_KMS_SIGNER_CHECKLIST.md](./RELAY_KMS_SIGNER_CHECKLIST.md).

### MEDIUM — редеплой контракта после B1 (требует целевого окружения)
**Что:** `EscrowImplementation` изменён (справедливая комиссия в `resolve()`, см. ·9).
**План:** задеплоить новую версию implementation, обновить адрес в фабрике/env,
синхронизировать ABI (уже сделано в репо). Проверить на Amoy testnet.

### LOW — два пути открытия спора (технический долг)
**Что:** после bonus-фикса (·12) `DealService.openDispute` и `DisputeService.openDispute`
ведут к одной цели разными путями (фронт использует первый). Свести на общий
код в отдельном рефакторинге, чтобы не было дрейфа логики.

### Инфраструктура / человек (вне кода)
- Реальный E2E платежей в Cryptomus sandbox (см. PAYMENTS_E2E_CHECKLIST.md).
- Внешний аудит контрактов перед mainnet; юрлицо, KYC-процесс, найм арбитров.

---

## Как прогнать тесты

```bash
# Backend (моки, ключи не нужны)
cd services/user-service && npm install && npm test

# Контракты (локальный Hardhat-узел, валюта не нужна)
cd contracts && npm install
npm i --no-save solc@0.8.20   # только если binaries.soliditylang.org недоступен
npx hardhat test
```
