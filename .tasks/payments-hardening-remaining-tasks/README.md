# План: реализация оставшихся задач Payments Hardening (то, что выполнимо кодом)

Основано на `docs/PAYMENTS_HARDENING_PLAN.md` (бэклог B1–B3) и найденных TODO.
Сюда включено ТОЛЬКО то, что реально делается кодом агентом — без инфраструктуры и участия человека.

## Задачи

| # | Файл | Область | Приоритет | Статус |
|---|------|---------|-----------|--------|
| 04 | `task-04-resolve-platform-fee.md` | Contracts (B1) | MEDIUM | ✅ DONE (нужен редеплой) |
| 01 | `task-01-stuck-funding-cron-alert.md` | Backend / monitoring (B3) | MEDIUM | ✅ DONE |
| 02 | `task-02-unified-commission-source.md` | Backend / payment+blockchain (B2) | LOW | ✅ DONE |
| 03 | `task-03-miniapp-dispute-evidence-upload.md` | Mini App + Backend | MEDIUM | ✅ DONE |
| 06 | `task-06-link-dispute-entity.md` | Backend (разблокировал Task 03) | HIGH | ✅ DONE |
| 05 | `task-05-verification.md` | Верификация | HIGH | частично |

## Текущий статус (пауза)

**Сделано:**
- **Task 04** — справедливая комиссия в `resolve()`: невиновный не платит,
  комиссия только с виновного (`DISPUTE_FEE_BPS=5000`). Контракты: **114/114** тестов.
  ABI бэкенда синхронизирован. ⚠️ Требует редеплоя контракта (человек).
- **Task 01** — cron-алерт застрявших платежей. Тесты: **5/5**. Env в `.env.example`.

**Заблокировано:**
- **Task 03** — архитектурный разрыв: `DealService.openDispute` не создаёт
  `Dispute`-сущность, поэтому `disputeId` для evidence-upload не существует.
  Требует бэкенд-фикса (см. task-06 ниже). Подробности в файле task-03.

**Осталось (когда вернёмся):**
- **Task 02** — единый источник комиссий (сложность: off-chain в RUB, on-chain в USDT-wei).
- **task-06 (новая)** — связать открытие спора с созданием `Dispute`-сущности (разблокирует Task 03).

## Порядок выполнения
1. Task 02 (единый источник fee) — желательно до Task 04, чтобы согласовать ставку.
2. Task 01 и Task 03 — независимы, можно параллельно.
3. Task 04 — только после подтверждения точного % уменьшенной ставки.
4. Task 05 — финальный прогон сборок/тестов.

## ВНЕ scope агента (делает человек / инфраструктура)
- HIGH: вынос relay-ключа `BLOCKCHAIN_PRIVATE_KEY` в KMS/Vault (см. `docs/RELAY_KMS_SIGNER_CHECKLIST.md`).
- Реальный E2E платежей в Cryptomus sandbox (`docs/PAYMENTS_E2E_CHECKLIST.md`).
- Деплой контрактов (Amoy/mainnet), редеплой после Task 04.
- Внешний аудит контрактов, юрлицо, KYC-процесс, найм арбитров.
- Отзыв утёкшего bot-токена, чистка git history.

## Бизнес-решения (зафиксировано)
- Task 04: платформа берёт комиссию при арбитраже по **уменьшенной ставке** (точный % — подтвердить).
