# Task 03: mini-app — Загрузка evidence при открытии спора

**Type:** Code Modification
**Status:** ✅ DONE (блокер устранён в task-06)
**Priority:** MEDIUM

## Результат
- `DealChatPage.handleDispute` после `openDispute` берёт `metadata.disputeId` и
  загружает файлы через `arbitrationApi.uploadEvidence` (`Promise.allSettled`,
  частичные ошибки → toast).
- `TODO` в `DisputeFormSheet.tsx` убран.
- `Deal.metadata.disputeId` добавлен в типы mini-app.
- Сборка mini-app: `✓ built in 9.44s`.

## ⛔ Блокер (обнаружен при реализации)
Загрузка evidence невозможна только на фронте:
- Mini-app открывает спор через `dealsApi.openDispute` → `POST /deals/:id/dispute` →
  `DealService.openDispute`, который **только выставляет `deal.status = DISPUTED`** и
  НЕ создаёт `Dispute`-сущность.
- Эндпоинт `POST /arbitration/disputes/:id/evidence/upload` требует реальный
  `dispute.id` (`EvidenceService.submitEvidence` делает `disputeRepository.findOne`).
- Полноценный `DisputeService.openDispute` (создаёт Dispute + чат + evidenceDueAt)
  **не подключён ни к одному эндпоинту** (осиротевший код).

Следствие: `disputeId` для загрузки evidence в текущем flow не существует.
Нужно бизнес/архитектурное решение (область O4 по OPUS_HANDOFF):
какой путь открытия спора каноничен, и связать `DealService.openDispute` с
созданием `Dispute` (вкл. `forwardRef` между DealModule ↔ ArbitrationModule).
См. отдельную задачу task-06.

## Goal
Убрать `TODO` в `DisputeFormSheet.tsx`: выбранные пользователем файлы (скриншоты/PDF)
должны реально загружаться как evidence через существующий backend-endpoint
`POST /api/arbitration/disputes/:id/evidence/upload`.

## Context
- Сейчас в `mini-app/src/components/deal-room/DisputeFormSheet.tsx` (строка ~77) стоит:
  `{/* TODO: POST /deals/:id/dispute/evidence when backend ready */}`.
- Форма уже собирает `reason` и `files` и превью, вызывает `onSubmit(reason, files)`.
- Backend endpoint УЖЕ существует: `POST /api/arbitration/disputes/:id/evidence/upload`
  (см. `docs/SONNET_HANDOFF.md` — таблица готовых endpoints).
- Эталоны: `mini-app/src/api/index.ts` → `disputesApi`, `adminApi`; форма в bottom sheet —
  сам `DisputeFormSheet.tsx`.

## What to Do
- Изучить, как `onSubmit(reason, files)` используется в родителе (страница deal-room),
  и как устроен `disputesApi` в `mini-app/src/api/index.ts`.
- Реализовать загрузку файлов: после создания/открытия спора — вызвать endpoint загрузки
  evidence для каждого файла (или batch), с индикатором загрузки и обработкой ошибок.
- Убрать комментарий `TODO: POST /deals/:id/dispute/evidence when backend ready`.
- Показать состояния: загрузка, успех, ошибка (в стиле существующих компонентов).

## Files/Areas
- `mini-app/src/components/deal-room/DisputeFormSheet.tsx` — убрать TODO, прокинуть файлы.
- Родительский компонент/страница, вызывающая `DisputeFormSheet` (найти через usages).
- `mini-app/src/api/index.ts` — метод загрузки evidence (использовать существующий или добавить, если отсутствует).

## Key Points / Constraints
- Endpoint уже существует: `POST /api/arbitration/disputes/:id/evidence/upload`.
- Моки оставить ТОЛЬКО как fallback (`USE_UI_MOCKS`), не единственный путь.
- Не ломать существующий контракт `onSubmit(reason, files)`; связать загрузку с id уже открытого спора.

## Done When
- [ ] `TODO` в `DisputeFormSheet.tsx` удалён, файлы реально уходят на backend.
- [ ] Есть индикатор загрузки и обработка ошибок загрузки evidence.
- [ ] Моки работают только как fallback, не подменяют реальный вызов.
- [ ] `cd mini-app && npm run build` — успех.
