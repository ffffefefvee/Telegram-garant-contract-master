# Task 06: Backend — связать открытие спора с созданием Dispute-сущности

**Type:** Code Modification
**Status:** ✅ DONE
**Priority:** HIGH (разблокирует Task 03)

## Проблема
`DealService.openDispute` (`POST /deals/:id/dispute`, используется mini-app) только
выставлял `deal.status = DISPUTED` и НЕ создавал `Dispute`-сущность. Полноценный
`DisputeService.openDispute` (создаёт Dispute + чат) висел на эндпоинте
`POST /arbitration/disputes?dealId=`, которым фронт не пользуется. В итоге
`disputeId` для загрузки evidence в основном flow не существовал.

## Решение
- `DisputeService.createDisputeForDeal()` — новый узкий идемпотентный метод:
  создаёт `Dispute` + чат + событие (без изменения deal.status/статистики/outbox,
  чтобы не дублировать side-effects). Если открытый Dispute уже есть — возвращает его.
- `DealService.openDispute()` вызывает его, кладёт `dispute.id` в `deal.metadata.disputeId`
  и в outbox-payload (раньше там ошибочно был `deal.id`).
- DI: `DealModule` ↔ `ArbitrationModule` через взаимные `forwardRef`
  (обратный уже существовал; `DisputeService` инжектится с `@Inject(forwardRef(...))`).

## Проверка
- `npx tsc --noEmit` — без ошибок.
- `nest build` — без ошибок.
- Unit-тесты: **309/309 passing** (304 базовых + 5 monitoring).
- ⚠️ e2e (`app.e2e-spec.ts`) не запускается в этой среде: нет БД + предсуществующий
  `RangeError: Maximum call stack` (воспроизводится и БЕЗ этих изменений — проверено
  через `git stash`). Circular-DI мои forwardRef НЕ вносят.

## Файлы
- `services/user-service/src/modules/arbitration/dispute.service.ts`
- `services/user-service/src/modules/deal/deal.service.ts`
- `services/user-service/src/modules/deal/deal.module.ts`

## Замечание для ревью
`DealService.openDispute` и `DisputeService.openDispute` теперь два пути к одной цели.
Фронт использует первый. Второй (arbitration-эндпоинт) стоит либо удалить, либо
свести на общий код в отдельном рефакторинге, чтобы не было дрейфа логики.
