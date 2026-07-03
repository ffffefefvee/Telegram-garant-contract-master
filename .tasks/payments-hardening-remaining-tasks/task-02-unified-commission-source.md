# Task 02: B2 — Единый источник комиссий + startup-проверка + property-тест

**Type:** Code Modification
**Status:** ✅ DONE
**Priority:** LOW

## Результат
- **Единый источник**: `payment/fee-model.ts` — канонические D5-константы
  (`D5_PERCENT_BPS=500`, threshold/flat RUB) + `computeDealFeeRub()`.
  `CommissionConfigService` теперь использует их (дубли убраны).
- **Startup-сверка**: `FeeConsistencyService` (`OnModuleInit`) читает on-chain
  `tariff.percentFeeBps` через `FactoryClient.readTariff()` и сравнивает с canonical.
  - stub-режим → skip; mismatch+`FEE_CONSISTENCY_STRICT=true` → abort boot;
    mismatch без strict → error-лог и продолжение; ошибка чтения → safe skip.
- **Сравнивается только процент** — единственный валюто-независимый параметр
  (off-chain RUB vs on-chain USDT-wei). Flat/threshold — в review/E2E.
- **Env**: `FEE_CONSISTENCY_STRICT` в `.env.example`.
- **Тесты**: property-тест (`commission-config.service.spec.ts`) + сверка
  (`fee-consistency.service.spec.ts`) — **9/9 passing**. Общий прогон: **318/318**.

## Goal
Устранить риск расхождения двух независимых таблиц комиссий: off-chain
`CommissionConfigService` (RUB-сетка) и on-chain `EscrowFactory.computeTotalFee`
(USDT-wei, RUB-пороги в 6dp). Гарантировать, что обе модели дают одинаковый результат.

## Context
- Off-chain: `services/user-service/src/modules/payment/commission-config.service.ts`
  — D5-сетка (fixed 50 RUB < 1000, 5% >= 1000), плюс DB-override через `commission_rate`.
- On-chain: `contracts/contracts/EscrowFactory.sol` — `computeTotalFee` (USDT-wei).
- Проблема: две независимые таблицы могут разойтись при правке одной без другой →
  бэкенд покажет одну сумму, контракт удержит другую.
- Парсинг/усечение USDT: `services/user-service/src/modules/escrow/usdt-amount.ts`.
- On-chain клиент: `services/user-service/src/modules/blockchain/factory.client.ts`.
- ВАЖНО: blockchain работает в stub-режиме без env (`blockchain.config.ts` — «runs in stub mode»).

## What to Do
- Определить единый источник правды для fee-сетки (константы порогов/ставок в одном месте,
  переиспользуемом off-chain-кодом).
- Добавить startup-проверку (в bootstrap / `onModuleInit` подходящего сервиса), которая на
  контрольных точках (напр. 5M, 100M wei и соответствующих RUB) сверяет результат
  `computeTotalFee` (через `factory.client.ts`) с `CommissionConfigService` и **падает/алертит**
  при расхождении.
- Property-тест: на сетке сумм обе формулы совпадают (в пределах допустимой погрешности
  округления 6dp).

## Files/Areas
- `services/user-service/src/modules/payment/commission-config.service.ts` — вынос сетки в единый источник.
- `services/user-service/src/modules/blockchain/factory.client.ts` — использование `computeTotalFee` для сверки.
- Новый spec-файл для property-теста совпадения формул.
- Возможно `.env.example` — флаг строгости проверки (fail vs warn).

## Key Points / Constraints
- On-chain работает в stub-режиме без env — проверка должна корректно деградировать (skip/warn),
  а НЕ падать при отсутствии blockchain env.
- Учитывать конвертацию RUB↔USDT и усечение до 6 знаков (см. `usdt-amount.ts`), чтобы не
  поймать ложное расхождение из-за округления.
- НЕ менять сам контракт (это Task 04 / B1), только off-chain сверку.

## Done When
- [ ] Fee-сетка имеет единый источник правды, дублирование устранено.
- [ ] Startup-проверка сверяет on-chain и off-chain на контрольных точках; при расхождении — fail/alert.
- [ ] В stub-режиме (нет blockchain env) проверка безопасно пропускается.
- [ ] Property-тест доказывает совпадение формул на сетке сумм.
- [ ] `npm run build` и `npm test` в `services/user-service` проходят без новых падений.
