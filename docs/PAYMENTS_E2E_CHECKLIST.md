# Payments E2E Checklist (Cryptomus Sandbox)

Пошаговая проверка платёжного контура в sandbox. Требуется: backend, PostgreSQL, relay wallet с USDT на Amoy, `CRYPTOMUS_SANDBOX=true`.

---

## 0. Подготовка

- [ ] `.env` скопирован из `.env.example`, заполнены `CRYPTOMUS_*`, `BACKEND_URL`, `MINI_APP_URL`, blockchain vars
- [ ] `BACKEND_URL` доступен из интернета (ngrok / staging)
- [ ] В Cryptomus Merchant Panel callback = `{BACKEND_URL}/api/webhook/cryptomus`
- [ ] `user-service` запущен, миграции применены
- [ ] Mini App: `VITE_API_URL` указывает на backend

---

## 1. Создание сделки

- [ ] Покупатель создаёт сделку в Mini App или боте
- [ ] Продавец принимает invite, привязан `walletAddress`
- [ ] Статус сделки → `pending_payment`
- [ ] CREATE2 адрес escrow виден (metadata / API)

---

## 2. Создание платежа

- [ ] Покупатель нажимает «Оплатить (Cryptomus)»
- [ ] `POST /api/payments` → 200, есть `paymentUrl`
- [ ] Запись в `payments` со статусом `pending`

---

## 3. Sandbox оплата

- [ ] Открыть `paymentUrl`, завершить тестовую оплату в Cryptomus sandbox
- [ ] В логах backend: `Webhook received: order=DEAL_... status=paid`
- [ ] `PaymentWebhookService`: FX locked, escrow created, forwardAndFund (или note в partial case)

---

## 4. Post-payment state

- [ ] `payments.status` = `completed`, `paidAt` заполнен
- [ ] `deals.status` = `in_progress`
- [ ] `deals.metadata.amountUsdt` зафиксирован
- [ ] On-chain: escrow clone funded (Polygonscan Amoy)
- [ ] Уведомление `deal.payment_received` доставлено (outbox → Telegram)

---

## 5. Confirm + release

- [ ] Продавец выполняет обязательства, покупатель «Подтвердить получение»
- [ ] Сделка `completed`, `metadata.escrowReleaseRequired = true`
- [ ] Уведомление `deal.release_required`
- [ ] Mini App: `EscrowReleasePanel` виден на странице сделки
- [ ] Покупатель подключает кошелёк, `release()` успешен
- [ ] `POST /deals/:id/escrow/release-sync` → флаг снят, `deal.completed` notification

---

## 6. Admin checks

- [ ] Admin Mini App → **Платежи**: платёж в списке, статус «Оплачен»
- [ ] `GET /api/admin/payments/stuck/funding` пуст (или разобран stuck case)
- [ ] `GET /api/admin/payments/stats/summary` — счётчики растут

---

## 7. Refund (optional)

- [ ] Создать вторую сделку, оплатить, не переводить в in_progress
- [ ] Admin `POST /api/admin/payments/:id/refund` с reason
- [ ] `payments.status` = `refunded`

---

## 8. Failure scenarios

| Сценарий | Ожидание |
|----------|----------|
| Неверный webhook sign | 401/403, Cryptomus retry |
| Duplicate PAID webhook | Idempotent skip, `state: 0` |
| Relay OOG / RPC down | Payment completed, deal stuck → stuck/funding admin + reconciliation cron |
| Seller без wallet на PAID | Partial note, reconcile после attach wallet |

---

## 9. Regression

- [ ] `npm run build` в `services/user-service`
- [ ] `npm run build` в `mini-app`
- [ ] `npm test -- payment-webhook.service.spec.ts` (user-service)

---

См. [CRYPTOMUS_INTEGRATION.md](./CRYPTOMUS_INTEGRATION.md) и [PRODUCT_PLAN.md](./PRODUCT_PLAN.md).
