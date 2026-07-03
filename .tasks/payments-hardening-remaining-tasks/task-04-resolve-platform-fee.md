# Task 04: B1 — Удержание уменьшенной платформенной комиссии в `resolve()`

**Type:** Code Modification (Solidity)
**Status:** ✅ DONE (требуется редеплой контракта — человек)
**Priority:** MEDIUM

## Бизнес-решение (зафиксировано USER)
Принцип: **невиновная сторона не страдает от комиссии только потому, что в сделке есть скамер.**
Платформа берёт комиссию при арбитраже по УМЕНЬШЕННОЙ ставке и УДЕРЖИВАЕТ её
ТОЛЬКО из доли ВИНОВНОЙ стороны.

### Реализованная модель
- `DISPUTE_FEE_BPS = 5000` — уменьшенная комиссия = **50%** от штатной `buyerFee + sellerFee`.
- Вина покупателя = `sellerSharePct`, вина продавца = `buyerSharePct`.
- `feeFromBuyer = disputeFee * sellerSharePct/100` (capped долей покупателя);
  `feeFromSeller = disputeFee * buyerSharePct/100` (capped долей продавца).
- Комиссия вычитается из СОБСТВЕННОЙ доли каждого, не из чужой.
- Следствие: при 100/0 и 0/100 победитель платит 0 комиссии; при долях — каждый
  платит пропорционально своей вине.

## Goal
В `release()` комиссия (`buyerFee + sellerFee`) уходит в Treasury (`treasury.depositFee`),
а в `resolve()` весь `escrowBalance` (за вычетом штрафа) делится между buyer/seller —
платформа не получает комиссию по спорным сделкам, хотя `buyerFee` был включён в фондирование.
Устранить это расхождение: удерживать уменьшенную комиссию в `resolve()`.

## Context
- `contracts/contracts/EscrowImplementation.sol`:
  - `release()` — стр. ~247: `totalFee = buyerFee + sellerFee` → `treasury.depositFee`.
  - `resolve()` — стр. ~285: весь `escrowBalance` (за вычетом штрафа) делится buyer/seller.
- Связано с Task 02 (единый источник fee): ставку резолва согласовать с общей fee-моделью.
- PRODUCT_PLAN §6.5 (D15) — экономика арбитра, штрафы (fine), Treasury Reserve.

## What to Do
- В `resolve()` удержать уменьшенную комиссию из `remaining` ДО раздела buyer/seller,
  затем вызвать `treasury.depositFee`.
- Добавить поле в `Resolved`-event (сумма удержанной комиссии).
- Тесты в `contracts/test/EscrowImplementation.test.ts`:
  - баланс Treasury растёт ровно на уменьшенную комиссию;
  - инвариант `sum(payouts) + fine + fee == escrowBalance`;
  - граничные случаи (нулевой остаток, доли 70/30 и т.п.).

## Files/Areas
- `contracts/contracts/EscrowImplementation.sol` — `resolve()` + событие.
- `contracts/test/EscrowImplementation.test.ts` — новые тесты.
- Off-chain: синхронизация ставки с Task 02 (единый источник fee), если нужно.

## Key Points / Constraints
- Трогает контракт → новая версия / **редеплой выполняет ЧЕЛОВЕК** (вне scope агента).
- Инвариант сумм обязателен в тестах.
- Согласовать ставку со стратегией fee из Task 02, чтобы off-chain и on-chain не разошлись.
- НЕ начинать код, пока не подтверждён точный % уменьшенной ставки.

## Done When
- [x] Точный % уменьшенной ставки подтверждён и записан здесь (50%, `DISPUTE_FEE_BPS=5000`).
- [x] `resolve()` удерживает уменьшенную комиссию только с виновного и вызывает `treasury.depositFee`.
- [x] `Resolved`-event содержит сумму комиссии (`feeToTreasury`).
- [x] Тесты доказывают рост баланса Treasury, нулевую комиссию невиновного и инвариант сумм.
- [x] `cd contracts && npm test` — **114 passing** (было 111 + 3 новых).
- [x] ABI бэкенда (`services/.../abi/EscrowImplementation.json`) синхронизирован.
- [ ] ⚠️ Требуется редеплой контракта (человек) — изменён EscrowImplementation.
