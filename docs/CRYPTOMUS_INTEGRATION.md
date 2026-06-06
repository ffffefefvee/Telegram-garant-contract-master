# Cryptomus Integration

Полное описание платёжного контура Cryptomus → relay → on-chain escrow в Telegram Garant. См. также [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) (§3 happy path, D1–D2).

---

## Что реализовано

| Компонент | Описание |
|-----------|----------|
| `CryptomusService` | Создание инвойсов, проверка статуса, refund через Cryptomus API |
| `CryptomusWebhookController` | `POST /api/webhook/cryptomus`, HMAC по `CRYPTOMUS_API_KEY`, rate limit |
| `PaymentWebhookService` | FX lock (`lockFundingFx`), `createEscrow` + `forwardAndFund`, idempotent PAID |
| `PaymentService` | CRUD платежей, admin list/stats, `findStuckFunding`, refund |
| `DealService` | `confirmReceipt` → `deal.release_required` при on-chain release; `getEscrowForDeal`, `syncEscrowRelease` |
| Mini App | Оплата сделки, `EscrowReleasePanel` (ethers `release()`), Admin «Платежи» |
| Notifications | Шаблон `deal.release_required` с deeplink в сделку |

---

## Переменные окружения

```env
# Публичный HTTPS URL backend — Cryptomus шлёт webhook сюда
BACKEND_URL=https://api.yourdomain.com

# Cryptomus Merchant Panel
CRYPTOMUS_MERCHANT_ID=...
CRYPTOMUS_API_KEY=...          # также используется для HMAC webhook (sign header)
CRYPTOMUS_SANDBOX=true         # true = sandbox, false = production

# Hosted HTTPS URL of the mini-app used as Cryptomus return URL
# Do not use t.me/... here; Telegram deeplinks are derived separately from
# TELEGRAM_BOT_USERNAME + TELEGRAM_MINIAPP_SLUG.
MINI_APP_URL=https://mini.yourdomain.com

# On-chain (Polygon Amoy testnet / mainnet)
BLOCKCHAIN_RPC_URL=...
BLOCKCHAIN_CHAIN_ID=80002
BLOCKCHAIN_PRIVATE_KEY=...     # relay hot-wallet
ESCROW_FACTORY_ADDRESS=...
USDT_CONTRACT_ADDRESS=...
```

Webhook URL в Merchant Panel:

```
{BACKEND_URL}/api/webhook/cryptomus
```

Для локальной разработки: `ngrok http 3001` → указать `https://xxxx.ngrok.io/api/webhook/cryptomus`.

---

## API (пользователь)

### Создать платёж

```
POST /api/payments
Authorization: Bearer <jwt>

{
  "dealId": "uuid",
  "amount": 50000,
  "currency": "RUB",
  "description": "Оплата сделки #123"
}
```

Ответ: `{ payment, paymentUrl, expiresAt }`. Покупатель открывает `paymentUrl` в Cryptomus.

### Проверить статус

```
POST /api/payments/:id/check
```

### Escrow info + release sync

```
GET  /api/deals/:id/escrow
POST /api/deals/:id/escrow/release-sync
Body: { "txHash": "0x..." }   // optional — если уже отправили release() из кошелька
```

---

## API (admin)

```
GET  /api/admin/payments?page=1&limit=20&status=completed
GET  /api/admin/payments/stats/summary
GET  /api/admin/payments/stuck/funding?limit=50
GET  /api/admin/payments/:id
POST /api/admin/payments/:id/refund   Body: { "reason": "..." }
GET  /api/admin/payments/:id/check-cryptomus
```

**Stuck funding** — платёж `completed`, но сделка всё ещё `pending_payment` (webhook partial / relay fail). Смотреть логи `PaymentWebhookService`, затем `ReconciliationScheduler`.

---

## Webhook flow (PAID)

1. Cryptomus POST → `CryptomusWebhookController` → verify `sign` header.
2. `PaymentWebhookService.handlePaymentWebhook`:
   - Найти `Payment` по `order_id`.
   - Зафиксировать FX (`lockFundingFx`) → `amountUsdt` в metadata сделки.
   - `createEscrow(dealId)` если ещё нет адреса.
   - `forwardAndFund(escrowAddress, amountUsdt)` — relay переводит USDT в клон эскроу.
   - Перевести сделку в `in_progress`, outbox `deal.payment_received`.
3. Ответ `{ state: 0 }` — Cryptomus не ретраит.

Статусы Cryptomus: `paid`, `processing`, `refunded`, `cancelled`, `expired`.

---

## Release flow (после confirm)

1. Покупатель подтверждает получение → `DealService.confirmReceipt`.
2. Если on-chain escrow funded → сделка `completed`, metadata `escrowReleaseRequired: true`, outbox `deal.release_required` (не `deal.completed` для buyer wallet action).
3. Mini App: `EscrowReleasePanel` — покупатель подключает MetaMask, вызывает `release()` на escrow clone.
4. `POST /deals/:id/escrow/release-sync` — backend проверяет tx, снимает флаг, шлёт `deal.completed`.

---

## Refund

Admin: `POST /api/admin/payments/:id/refund` → `PaymentService.refundPayment` → Cryptomus refund API.

Пользовательский refund до funding — через отмену сделки (FSM), не через Cryptomus напрямую.

---

## Безопасность

- HMAC: `MD5(base64(JSON.stringify(payload)) + CRYPTOMUS_API_KEY)` — сравнение с header `sign`.
- `WebhookRateLimitGuard` на webhook endpoint.
- Webhook и auth routes исключены из JWT middleware (`AuthModule`).
- `BACKEND_URL` должен быть HTTPS и доступен из интернета.

---

## Мониторинг

Логи: `[CryptomusService]`, `[PaymentWebhookService]`, `[ReconciliationService]`.

Admin Mini App → вкладка **Платежи**: список + блок «Застрявший funding».

Метрики: см. `monitoring` module / Prometheus endpoints при включении.

---

## Sandbox testing

См. [PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md).

---

**Cryptomus docs:** https://docs.cryptomus.com
