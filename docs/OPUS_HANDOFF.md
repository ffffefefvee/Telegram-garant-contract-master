# Plan-prompt для Claude Opus 4.6 — Telegram Garant

Скопируйте блок **«Промпт для агента»** в новый чат Opus вместе с репозиторием.  
Цель: **деньги, on-chain, арбитраж core, надёжность** — всё, что Sonnet не должен трогать ([SONNET_HANDOFF.md](./SONNET_HANDOFF.md)).

**Порядок в команде:** сначала Sonnet (Пакеты A–C) → затем Opus (ниже) → человек (E2E с ключами, mainnet, legal).

---

## Промпт для агента (скопировать целиком)

```
Ты — senior-разработчик в репозитории Telegram Garant (P2P escrow: NestJS + PostgreSQL + Polygon USDT + Cryptomus).

## Сначала прочитай (обязательно, до любого кода)

1. docs/OPUS_HANDOFF.md — этот файл: scope, пакеты, границы с Sonnet.
2. docs/PRODUCT_PLAN.md — полностью §2 (решения D1–D17), §3 (happy path), §4 (контракты), §5.2 (outbox/reconcile), §6 (арбитраж), §10 (безопасность).
3. docs/PAYMENTS_E2E_CHECKLIST.md — целевое поведение платежей; §8 failure scenarios — обязательны в тестах.
4. docs/CRYPTOMUS_INTEGRATION.md — webhook, подпись, sandbox.
5. services/user-service/src/modules/deal/fsm/deal-state-machine.ts — любое изменение статуса сделки только через FSM.
6. services/user-service/src/modules/blockchain/blockchain.config.ts — stub vs enabled.

Не дублируй работу Sonnet (docs/SONNET_HANDOFF.md): mini-app wiring, reviewsApi, админ-вкладки read-only, users/search UI, evidence upload UI без S3.

## Жёсткие ограничения

НЕ делай в одном PR:
- mainnet deploy и реальные private keys в репозитории
- git filter-repo / отзыв bot token (инструкция человеку — можно документировать)
- удаление store/ и /bots без отдельного продуктового решения
- полный UI кабинета арбитра (это Sonnet Пакет C) — Opus только backend + on-chain enforce

НЕ коммить .env с секретами. Не ослабляй webhook signature verification.

Definition of done на каждый PR Opus:
- npm run build в services/user-service и/или contracts
- npm test -- <релевантные spec> — зелёные; для payment — обязательно payment-webhook.service.spec.ts
- для контрактов: npm test в contracts/
- краткий markdown в PR: сценарии из PAYMENTS_E2E_CHECKLIST / PRODUCT_PLAN которые покрыты
- явно перечисли stub-mode поведение если env не задан

Человек после твоего PR: ngrok + Cryptomus sandbox + Amoy RPC — ты описываешь шаги, не подставляешь ключи.

## Пакеты (отдельный PR на пакет, строго по порядку O1 → O5)

### O1 — Платежи: webhook, идемпотентность, reconcile (backend only)

Цель: PAID webhook надёжно доводит сделку до in_progress; дубликаты и partial cases безопасны.

Файлы (читать целиком перед правками):
- services/user-service/src/modules/payment/payment-webhook.service.ts
- services/user-service/src/modules/payment/payment-webhook.service.spec.ts
- services/user-service/src/modules/payment/cryptomus-webhook.controller.ts
- services/user-service/src/modules/ops/outbox.service.ts
- services/user-service/src/modules/ops/reconciliation.service.ts
- services/user-service/src/modules/ops/reconciliation.service.spec.ts

Задачи:
- Идемпотентность duplicate PAID (§8 checklist).
- Partial: seller без wallet — payment completed, deal note + путь reconcile после attach wallet.
- Stuck funding: согласовать с GET /admin/payments/stuck/funding.
- Outbox: webhook → enqueue → worker; не терять события при retry Cryptomus.
- Admin refund: POST /admin/payments/:id/refund — не ломать FSM.

DoD: все сценарии §8 PAYMENTS_E2E_CHECKLIST отражены в unit-тестах или документированы как manual; build green.

OUT OF SCOPE O1: изменение mini-app; mainnet.

---

### O2 — Blockchain live path (после O1)

Цель: при заполненных env (blockchain.config.ts enabled=true) forward USDT в escrow и notifyFunded работают; stub остаётся для dev.

Файлы:
- services/user-service/src/modules/blockchain/* (factory.client, escrow.client, blockchain.provider)
- services/user-service/src/modules/escrow/escrow.service.ts
- services/user-service/src/modules/escrow/escrow.service.spec.ts
- services/user-service/src/modules/blockchain/blockchain.spec.ts
- contracts/contracts/EscrowImplementation.sol, EscrowFactory.sol, PlatformTreasury.sol

Задачи:
- Согласовать payment-webhook → escrow create/deploy → forwardAndFund → deal PAYMENT_RECEIVED / in_progress.
- metadata: amountUsdt, escrow_address, escrowReleaseRequired после confirm.
- release-sync endpoint и buyer-initiated release flow с PRODUCT_PLAN §3 [9a].
- Документ BLOCKCHAIN_*.env в комментарии или docs/BLOCKCHAIN_ENV.md (без секретов): Amoy deploy addresses placeholder.

DoD: escrow.service.spec + blockchain.spec green; ручной чеклист «как включить live» для человека.

OUT OF SCOPE O2: ArbitratorRegistry stake UI; mainnet.

---

### O3 — Смарт-контракты: hardening + тесты

Цель: контракты соответствуют PRODUCT_PLAN §4.2 (release buyer-only, refund seller-only, resolve arbitrator, ReentrancyGuard).

Файлы:
- contracts/contracts/EscrowImplementation.sol
- contracts/contracts/EscrowFactory.sol (тарифная сетка D5)
- contracts/test/*.test.ts
- contracts/hardhat.config.ts

Задачи:
- Закрыть расхождения с §4.2 «Жёсткие правила».
- Покрытие критических path в Hardhat; зафиксировать % в PR description.
- Подготовить slither в CI (workflow step, continue-on-error допустим на первом PR).

DoD: npm test в contracts/ green; список оставшихся audit items для внешнего аудитора.

---

### O4 — Арбитраж backend: FSM, назначение, decision, on-chain enforce

Цель: спор от open → evidence → assign → decision → (optional) on-chain resolve без поломки deal FSM.

Файлы:
- services/user-service/src/modules/arbitration/dispute.service.ts
- services/user-service/src/modules/arbitration/arbitrator-selection.service.ts
- services/user-service/src/modules/arbitration/dispute-blockchain.service.ts
- services/user-service/src/modules/arbitration/dispute-blockchain.service.spec.ts
- services/user-service/src/modules/arbitration/arbitration.controller.ts (POST decisions, enforce)
- entities: dispute.entity.ts, arbitration-decision.entity.ts

Задачи:
- Назначение: round-robin + conflict filter (§6.2.4) — минимально рабочий MVP.
- POST disputes/:id/decision → БД; отдельный шаг enforce on-chain (DisputeBlockchainService).
- Переходы deal DISPUTED → DISPUTE_RESOLVED → COMPLETED/REFUNDED через deal-state-machine.
- SLA cron (evidence 48h, decision 72h) — один scheduler, тесты на guard transitions.
- Appeal: только если entity/API уже есть — не изобретать Phase 3.

DoD: arbitrator-selection.service.spec + dispute-blockchain.service.spec green; без вызова enforce из mini-app (Sonnet read-only UI).

OUT OF SCOPE O4: экономика штрафов D15 в Treasury on-chain; Merkle chat snapshot; S3 evidence.

---

### O5 — Архитектура и ops (по согласованию, один под-пакет за PR)

Выбери ОДИН под-пункт за PR:

O5a. Evidence storage abstraction (interface Local/S3), реализация S3 опционально через env; миграция путей; API контракт для mini-app не ломать.

O5b. Deal timeouts: PAYMENT_EXPIRED (7d), seller inactivity → dispute (14d) — только через DealStateMachine + cron + tests.

O5c. Ledger module sketch или audit log расширение для движения средств (если ledger не создавать — документировать почему и что есть в treasury_ledger / payment rows).

O5d. Idempotency keys middleware на мутирующие POST (deals, payments).

DoD: design note в docs/ + tests; не ломать O1–O4.

---

## Как работать

- Перед правкой: нарисуй sequence diagram (mermaid) в комментарии PR для O1/O2/O4.
- Минимальный diff; не рефакторить unrelated modules.
- Любое изменение deal.status — через DealService + state machine, не прямой save.
- После O1 человек прогоняет PAYMENTS_E2E_CHECKLIST в sandbox — ты даёшь «Expected logs» секцию.

Начни с O1. Отчёт: файлы, тесты, что проверить человеку с ngrok.
```

---

## Разделение Sonnet vs Opus vs человек

| Область | Sonnet ([SONNET_HANDOFF](./SONNET_HANDOFF.md)) | Opus (этот файл) | Человек |
|---------|-----------------------------------------------|------------------|---------|
| Reviews, админ UI, search UI | Да | Нет | — |
| payment-webhook, reconcile | Нет | **O1** | E2E sandbox |
| forwardAndFund, escrow live | Нет | **O2** | RPC, relay wallet |
| Контракты Solidity | Нет | **O3** | Внешний аудит |
| Dispute enforce, assign, SLA cron | Нет | **O4** | Найм арбитров |
| S3, ledger, idempotency middleware | Нет | **O5** | Infra credentials |
| Bot token revoke, mainnet, legal | Нет | Нет | **Да** |

---

## Карта чтения для Opus

| Приоритет | Файл / документ | Зачем |
|-----------|-----------------|--------|
| P0 | [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) | D1–D17, §3–6, §4 контракты |
| P0 | [PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md) | Acceptance платежей |
| P0 | [CRYPTOMUS_INTEGRATION.md](./CRYPTOMUS_INTEGRATION.md) | Webhook, sandbox |
| P0 | [payment-webhook.service.ts](../services/user-service/src/modules/payment/payment-webhook.service.ts) | Ядро O1 |
| P0 | [deal-state-machine.ts](../services/user-service/src/modules/deal/fsm/deal-state-machine.ts) | Инварианты статусов |
| P0 | [blockchain.config.ts](../services/user-service/src/modules/blockchain/blockchain.config.ts) | Stub vs live |
| P1 | [reconciliation.service.ts](../services/user-service/src/modules/ops/reconciliation.service.ts) | O1 |
| P1 | [outbox.service.ts](../services/user-service/src/modules/ops/outbox.service.ts) | At-least-once |
| P1 | [escrow.service.ts](../services/user-service/src/modules/escrow/escrow.service.ts) | O2 |
| P1 | [dispute-blockchain.service.ts](../services/user-service/src/modules/arbitration/dispute-blockchain.service.ts) | O4 |
| P1 | [arbitrator-selection.service.ts](../services/user-service/src/modules/arbitration/arbitrator-selection.service.ts) | O4 |
| P2 | [EscrowImplementation.sol](../contracts/contracts/EscrowImplementation.sol) | O3 |
| P2 | [EscrowFactory.sol](../contracts/contracts/EscrowFactory.sol) | D5 fee grid |
| P2 | [ArbitratorRegistry.sol](../contracts/contracts/ArbitratorRegistry.sol) | Phase 2+, не блокирует MVP |
| P2 | [commission-config.service.ts](../services/user-service/src/modules/payment/commission-config.service.ts) | D5/D6 |
| P3 | [SONNET_HANDOFF.md](./SONNET_HANDOFF.md) | Не пересекаться |

---

## Ключевые spec-файлы (запускать после каждого пакета)

```bash
cd services/user-service

# O1
npm test -- payment-webhook.service.spec.ts
npm test -- reconciliation.service.spec.ts
npm test -- outbox.service.spec.ts

# O2
npm test -- escrow.service.spec.ts
npm test -- blockchain.spec.ts

# O4
npm test -- dispute-blockchain.service.spec.ts
npm test -- arbitrator-selection.service.spec.ts

# contracts O3
cd contracts && npm test
```

Полный прогон перед merge в develop:

```bash
cd services/user-service && npm run build && npm test -- --passWithNoTests --forceExit
cd contracts && npm run compile && npm test
```

---

## Env-переменные (человек заполняет, Opus только документирует)

| Группа | Переменные | Пакет |
|--------|------------|--------|
| Cryptomus | `CRYPTOMUS_*`, `BACKEND_URL`, sandbox flag | O1 + human E2E |
| Blockchain | `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, `BLOCKCHAIN_CHAIN_ID`, `ESCROW_FACTORY_ADDRESS`, `PLATFORM_TREASURY_ADDRESS`, `ARBITRATOR_REGISTRY_ADDRESS`, `USDT_CONTRACT_ADDRESS` | O2 |
| Relay | Hot wallet MATIC refill (описать в runbook) | O2 |

Шаблон без значений — в `.env.example` (не перезаписывать реальными ключами).

---

## Чеклист приёмки Opus-PR (reviewer)

- [ ] Нет прямого `deal.status = ...` в обход FSM
- [ ] Webhook: invalid sign → 401/403, duplicate → idempotent
- [ ] Stub mode: сервис стартует без blockchain env
- [ ] Live mode: описан порядок включения и риски
- [ ] Тесты на §8 PAYMENTS_E2E (O1) или явный gap list
- [ ] Sonnet-файлы (mini-app AdminPage, ReviewList) не изменены без причины
- [ ] Нет секретов в diff

---

## E2E после Opus (только человек)

1. [PAYMENTS_E2E_CHECKLIST.md](./PAYMENTS_E2E_CHECKLIST.md) — пункты 0–9.
2. Polygonscan Amoy — escrow funded, release tx.
3. Admin → платежи, stuck funding пуст или разобран.
4. Один тестовый спор: open → evidence → assign → decision → (если enabled) on-chain resolve.

---

## Риски — что Opus должен явно писать в PR

| Риск | Где проявляется | Что указать в PR |
|------|-----------------|------------------|
| Двойной PAID | payment-webhook | Idempotency key / DB unique |
| USDT на hot wallet, не в escrow | O1+O2 | Reconcile job + alert |
| Release не buyer | EscrowImplementation | Тест + §4.2 |
| Enforce без decision в БД | O4 | Порядок: DB commit → chain tx |
| CoI не проверен | assign | Limitation list в PR |

---

## Связанные документы

- [SONNET_HANDOFF.md](./SONNET_HANDOFF.md) — UI и wiring (делать раньше)
- [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) — продуктовая правда
- [SECURITY.md](../SECURITY.md) — если меняется auth/admin force actions

---

*Документ для делегирования Claude Opus 4.6. Не заменяет PRODUCT_PLAN и не дублирует SONNET_HANDOFF.*
