# Task 01: B3 — Cron-алертинг застрявших платежей

**Type:** Code Modification
**Status:** ✅ DONE
**Priority:** MEDIUM

## Результат
- `MonitoringService.checkStuckFunding()` добавлен + зарегистрирован интервал в `startMonitoring()`.
- Дедуп через `createAlertOnce` (тип+заголовок, до resolve) — не спамит.
- Telegram-пуш админам автоматически (ERROR-severity → `pushAlertToOpsChat`).
- Env `STUCK_FUNDING_ALERT_THRESHOLD`, `STUCK_FUNDING_CHECK_INTERVAL_MS` → `.env.example`.
- Тесты: `monitoring.service.spec.ts` — **5/5 passing** (алерт, антиспам, порог, молчание, swallow-ошибок).

## Goal
Сделать так, чтобы limbo-платежи (USDT пришли, escrow не профондирован) обнаруживались
автоматически: периодическая проверка `findStuckFunding()` создаёт `SystemAlert` и шлёт
Telegram-нотификацию админам, без спама при повторных тиках.

## Context
- `PaymentService.findStuckFunding()` уже реализован (`payment.service.ts:388`) — не дублировать логику поиска.
- `ReconciliationService.buildDailyReport()` тоже есть, но всё это вызывается только вручную через admin-контроллеры.
- В `MonitoringService.onModuleInit()` уже есть паттерн периодических задач:
  `setInterval(() => this.checkPendingPayments(), 120000)` (строки ~91, метод ~257).
- Доступные зависимости в `MonitoringService`: `alertRepository` (SystemAlert),
  `paymentService`, `outbox`, `telegramBot`, `config`, `redis`.
- Enum'ы: `AlertSeverity`, `AlertType` из `./entities/monitoring.entity`.

## What to Do
- Добавить метод `checkStuckFunding()` в `MonitoringService` рядом с `checkPendingPayments()`.
- Зарегистрировать периодический вызов в `onModuleInit` (паттерн `setInterval`, интервал из env).
- Логика метода:
  - вызвать `paymentService.findStuckFunding()`;
  - если `result.length > threshold` — создать `SystemAlert` (severity/type из `monitoring.entity`)
    и отправить нотификацию админам через `outbox` + `telegramBot`.
- Антиспам: не плодить дубль-алерты на каждый тик — проверять наличие уже открытого алерта
  того же типа (по аналогии с существующей логикой в сервисе) **или** ставить дедуп-флаг
  в Redis с TTL.
- Порог и интервал вынести в env через `ConfigService`
  (например `STUCK_FUNDING_ALERT_THRESHOLD`, `STUCK_FUNDING_CHECK_INTERVAL_MS`),
  задокументировать в `.env.example`.

## Files/Areas
- `services/user-service/src/modules/monitoring/monitoring.service.ts` — новый метод + регистрация интервала в `onModuleInit`.
- `services/user-service/src/modules/monitoring/monitoring.service.spec.ts` (создать, если нет) — тесты.
- `.env.example` — новые env-переменные с описанием.

## Key Points / Constraints
- `findStuckFunding()` уже реализован — НЕ дублировать логику поиска.
- НЕ менять payment-webhook и blockchain config (запрет из handoff-чеклиста).
- Дедуп обязателен: тест должен доказать «ровно один алерт при повторных тиках».
- Никаких секретов в коде; env только через `.env.example` без реальных значений.

## Done When
- [ ] `MonitoringService` регистрирует периодическую проверку stuck funding в `onModuleInit`.
- [ ] При `findStuckFunding().length > threshold` создаётся ровно один `SystemAlert` + отправляется нотификация админам.
- [ ] Повторные тики при том же состоянии НЕ создают новых алертов (доказано тестом).
- [ ] Порог и интервал читаются из env; значения добавлены в `.env.example`.
- [ ] `npm run build` и `npm test` в `services/user-service` проходят без новых падений.
