# Payments Hardening Plan

План доработки финансовой части (Cryptomus → relay → on-chain escrow, TON rails,
direct-USDT). Отражает выполненные исправления и то, что осталось.

Связанные документы: [CRYPTOMUS_INTEGRATION.md](./CRYPTOMUS_INTEGRATION.md),
[PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md), [PRODUCT_PLAN.md](./PRODUCT_PLAN.md).

---

## Статус тестов (на момент последнего обновления)

| Набор | Результат |
|-------|-----------|
| Backend (`services/user-service`, `npm test`) | **293 / 293** ✅ |
| Смарт-контракты (`contracts`, `npx hardhat test`) | **111 / 111** ✅ |

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

---

## ⏳ Осталось

### LOW — TON `fundingLocks` в Redis/БД (отложено)
**Где:** `services/user-service/src/modules/payment/rails/ton-rail.base.ts`.
**Проблема:** `private readonly fundingLocks = new Set<string>()` — in-memory.
Защищает float от double-spend, когда тик watcher'а и пользовательская проверка
гонятся за одним escrow. Но Set:
- не переживает рестарт процесса;
- не разделяется между инстансами при горизонтальном масштабировании.
→ при нескольких репликах возможен двойной `forwardAndFund` из float.

**План:** заменить `Set` на распределённый лок в Redis (ioredis уже в проекте,
см. `app.module.ts` RedisModule): `SET lock:ton-fund:<escrow> NX PX <ttl>` на входе,
`DEL` в `finally`. TTL ~ время одного `forwardAndFund` + запас. Покрыть тестами:
лок захвачен другим инстансом → текущая проверка только репортит прогресс.

**Примечание:** частично смягчено п.5 (recovery-aware `forwardAndFund` уже не
переводит повторно, если escrow `FUNDED` или баланс достаточен) — но
распределённый лок всё равно нужен для чистоты при масштабировании.

### HIGH — ключ relay в KMS/Vault (требует инфраструктуры)
**Где:** `BLOCKCHAIN_PRIVATE_KEY` (env) → `BlockchainProvider` (`ethers.Wallet`).
**Проблема:** приватный ключ hot-wallet в `.env` — единая точка компрометации всех
средств «в полёте». Нет KMS/HSM/Vault.
**План:** вынести подпись в внешний signer (AWS KMS / GCP KMS / HashiCorp Vault
Transit) за интерфейсом вместо `ethers.Wallet`. **Невозможно проверить локально** в
текущей среде без доступа к KMS — делать в целевом окружении.

---

## Прочие наблюдения (бэклог, не начато)

- **resolve() при споре** не проводит платформенную комиссию в Treasury (в отличие от
  `release()`) — проверить бизнес-намерение.
- **Двойная модель комиссий**: on-chain (`computeTotalFee`, USDT-wei) vs off-chain
  (`CommissionConfigService`, RUB-сетка) — следить за рассинхроном.
- **Мониторинг застрявших платежей**: алертинг по `findStuckFunding` /
  `reconciliation.buildDailyReport` (limbo-платежи копятся молча).

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
