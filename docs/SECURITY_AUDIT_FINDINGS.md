# Подробный отчёт по ошибкам безопасности Telegram Garant

**Дата:** 2025-03-08  
**Основание:** `docs/SECURITY_EXPERT_PROMPT.md`  
**Область:** Solidity-контракты, NestJS backend, платежи, арбитраж, CI/CD, Docker/nginx, эксплуатационная устойчивость.

> Этот документ не содержит значений секретов. Статус «исправлено» означает наличие изменений и локальной проверки, но не заменяет независимый аудит перед mainnet/production.

## Статусы и приоритет

- **OPEN** — подтверждённая проблема остаётся в коде или эксплуатации.
- **IN PROGRESS** — исправление присутствует в текущем незакоммиченном diff, но полный verification ещё не завершён.
- **FIXED / VERIFY** — исправление и regression-тесты добавлены; требуется независимая проверка/ревью.
- **OPERATIONAL** — закрывается не только кодом, но и настройкой production-инфраструктуры или процедурой.

Порядок исправления: Critical → High → Medium. До закрытия всех открытых Critical/High нельзя запускать реальные денежные потоки.

---

## Краткая сводка

| ID | Severity | Статус | Кратко |
|---|---|---|---|
| SEC-BE-001 | Critical | IN PROGRESS | Гонка webhook допускает двойной forward USDT |
| SEC-BE-002 | Critical | IN PROGRESS | Funding webhook возвращает terminal-сделку в `IN_PROGRESS` |
| SEC-INF-008 | Critical | OPEN | Compose обходит PostgreSQL entrypoint и ломает запуск |
| SEC-BE-003 | High | IN PROGRESS | IDOR к чужим сделкам, чатам и событиям |
| SEC-BE-004 | High | IN PROGRESS | IDOR к evidence и решениям арбитража |
| SEC-BE-005 | High | IN PROGRESS | Гонка принятия invite |
| SEC-SC-001 | High | FIXED / VERIFY | Невиновный продавец терял principal из-за штрафа |
| SEC-SC-002 | High | FIXED / VERIFY | Пустой reserve замораживал resolve |
| SEC-SC-003 | High | FIXED / VERIFY | Stake выводился при открытых спорах |
| SEC-SC-004 | High | FIXED / VERIFY | Single-EOA admin мог управлять treasury/ролями |
| SEC-INF-002 | High | IN PROGRESS | CI не имел блокирующих security gates |
| SEC-INF-004 | High | IN PROGRESS | Root-контейнеры и небезопасная экспозиция DB/Redis |
| SEC-INF-006 | High | OPEN / OPERATIONAL | Relay private key хранится как env-секрет |
| SEC-INF-009 | High | OPEN | Redis entrypoint обходится, сервер запускается root |
| SEC-INF-010 | High | OPEN | Production принимает `replace_me_*` секреты |
| SEC-BE-006 | Medium | OPEN | Evidence upload до AuthZ и без безопасных лимитов |
| SEC-BE-007 | Medium | OPEN | Admin mutation и audit-log неатомарны |
| SEC-INF-001 | Medium | IN PROGRESS | Lint не блокировал merge |
| SEC-INF-003 | Medium | OPEN | Actions и образы не закреплены SHA/digest |
| SEC-INF-005 | Medium | IN PROGRESS | Нет полного TLS/security-header hardening |
| SEC-INF-007 | Medium | IN PROGRESS | DR: нет доказанного encrypted backup/restore drill |
| SEC-ARCH-001 | High | OPEN | Reconciliation I4 не реализован полностью |
| SEC-ARCH-002 | High | OPEN | Нет полноценного double-entry ledger |
| SEC-ARCH-003 | High | OPEN | Outbox не восстанавливает зависшие `IN_FLIGHT` |

---

# 1. Backend и платежи

## [SEC-BE-001] Гонка webhook допускает двойной forward

**Severity:** Critical  
**Статус:** IN PROGRESS  
**Актив:** USDT hot-wallet и escrow  
**Инварианты:** I2, I3  
**Места:**
- `services/user-service/src/modules/payment/payment-webhook.service.ts`
- `services/user-service/src/modules/payment/webhook-idempotency.service.ts`
- `services/user-service/src/modules/payment/entities/processed-webhook-event.entity.ts`
- migration `1716400000000-CreateProcessedWebhookEvents.ts`

### Ошибка

Проверка вида «событие уже обработано?» и запись «событие обработано» разделены денежным side effect. Два одинаковых подписанных webhook могут одновременно увидеть отсутствие записи и оба вызвать перевод USDT. In-memory очередь relay не защищает от двух процессов/реплик backend.

### Эксплуатация

1. Cryptomus или атакующий с валидным replay отправляет два одинаковых `PAID` webhook почти одновременно.
2. Оба запроса проходят проверку подписи.
3. Обе транзакции читают `isProcessed = false`.
4. Каждый поток инициирует forward с hot-wallet.
5. Только после перевода появляется idempotency-запись; деньги уже отправлены дважды.

### Что изменить

1. До любого внешнего денежного эффекта атомарно захватывать событие по уникальному `(provider, eventKey)`.
2. Ввести состояния `PROCESSING`, `COMPLETED`, `FAILED_RETRYABLE` и lease/timeout владельца обработки.
3. Использовать уникальный индекс и `INSERT ... ON CONFLICT DO NOTHING`, либо транзакционный `SELECT ... FOR UPDATE`/advisory lock по payment/deal.
4. Второй обработчик обязан вернуть idempotent success/no-op, не вызывая relay.
5. On-chain/relay операция также должна иметь стабильный business idempotency key и проверять уже известный `tx_hash`/состояние escrow.
6. После crash запись `PROCESSING` должна безопасно переоткрываться по истечении lease только после проверки chain state.

### Тест

- PostgreSQL integration test запускает два параллельных вызова одного webhook.
- Ожидание: `relay.transfer` вызван ровно один раз; одна запись события; оба HTTP-ответа безопасны.
- Повторить тест с двумя экземплярами приложения/двумя DB connections.
- Crash test: процесс падает после claim, но до записи tx hash; recovery не делает второй перевод без chain check.

### Проверка

Запустить специфичные payment/webhook integration tests и полный backend build. Дополнительно проверить под реальным PostgreSQL, а не SQLite/mock repository.

---

## [SEC-BE-002] Terminal-сделку можно вернуть в `IN_PROGRESS`

**Severity:** Critical  
**Статус:** IN PROGRESS  
**Актив:** состояние сделки и средства escrow  
**Инвариант:** I6  
**Место:** `payment-webhook.service.ts`, funding/fallback ветки.

### Ошибка

Fallback-логика после funding могла напрямую присвоить `IN_PROGRESS`, обходя FSM. Поэтому запоздалый или повторный валидный `PAID` webhook для `CANCELLED`, `REFUNDED`, `DISPUTED` или иной terminal-сделки способен «оживить» её.

### Эксплуатация

1. Сделка отменяется, возвращается или переводится в спор.
2. Позже приходит задержанный/повторный валидный webhook оплаты.
3. Обработчик выполняет funding/forward.
4. Fallback напрямую пишет `IN_PROGRESS`.
5. Дальнейшие release/refund/dispute операции работают на неверном состоянии.

### Что изменить

1. Удалить прямой fallback status assignment.
2. Разрешить только атомарный CAS: `UPDATE deals SET status='IN_PROGRESS' WHERE id=? AND status='PENDING_PAYMENT'`.
3. Если affected rows = 0, перечитать состояние и выполнить безопасный no-op либо поднять внутренний алерт.
4. Для terminal/disputed статусов не выполнять forward автоматически; отправлять запись в manual reconciliation queue.
5. Все переходы проводить через единый FSM API.

### Тест

Параметризованный тест для `CANCELLED`, `REFUNDED`, `DISPUTED`, `COMPLETED`, `RESOLVED`: webhook не меняет статус и не создаёт новый денежный side effect. Отдельный race test: cancel и webhook одновременно — допустим ровно один согласованный исход.

---

## [SEC-BE-003] IDOR/BOLA к чужим сделкам, чатам и событиям

**Severity:** High  
**Статус:** IN PROGRESS  
**Актив:** PII, условия сделки, сообщения, evidence metadata  
**Инвариант:** I7  
**Места:** `deal.controller.ts`, `deal.service.ts`.

### Ошибка

Некоторые GET-методы принимали UUID/номер сделки и возвращали relations, сообщения или события любому аутентифицированному пользователю без проверки участия/роли.

### Эксплуатация

1. Пользователь получает обычный JWT.
2. Перебирает/угадывает deal UUID либо получает номер из уведомления.
3. Запрашивает deal, chat или events.
4. Backend возвращает чужие данные, потому что проверена только аутентификация.

### Что изменить

- Каждый метод должен принимать `currentUser.id` из проверенного JWT, а не из query/body.
- В service policy разрешать доступ только buyer, seller, назначенному арбитру и административной роли с audit reason.
- Не загружать чувствительные relations до проверки policy; либо выбирать минимальную запись и затем защищённые данные.
- Возвращать 403 или унифицированный 404, если требуется не раскрывать существование объекта.
- Вынести policy в общий `DealAccessPolicy`, чтобы не дублировать проверки.

### Тест

Для каждой GET-ручки: buyer/seller — 200; outsider — 403/404; неназначенный arbitrator — отказ; назначенный arbitrator — только в разрешённой фазе; admin — доступ с audit trail.

---

## [SEC-BE-004] IDOR к evidence и решениям арбитража

**Severity:** High  
**Статус:** IN PROGRESS  
**Актив:** доказательства, PII, иммутабельность арбитража  
**Инварианты:** I7, I8  
**Места:** `arbitration.controller.ts`, `evidence.service.ts`, `dispute.service.ts`.

### Ошибка

Аутентифицированный outsider мог перечислять или читать evidence/decision чужого спора.

### Что изменить

1. Ввести `DisputeAccessPolicy`.
2. Разрешить участникам только их спор; назначенному арбитру — только после назначения; admin — по RBAC и с audit.
3. Presigned download URL выдавать после policy-check, с коротким TTL и private ACL.
4. Не возвращать внутренние filesystem/S3 keys.

### Тест

Проверить все list/get/download decision/evidence endpoints для outsider, участника, неназначенного и назначенного арбитра.

---

## [SEC-BE-005] Гонка `acceptInvite`

**Severity:** High  
**Статус:** IN PROGRESS  
**Актив:** целостность сделки/FSM  
**Инварианты:** I6, I7  
**Место:** `deal.service.ts`, принятие приглашения.

### Ошибка

Два пользователя могли одновременно прочитать invite как действительный и оба принять его; последний write определял seller, а БД могла сохранить конфликтующие acceptance records.

### Что изменить

- Выполнять принятие в DB-транзакции.
- Блокировать invite/deal через `SELECT ... FOR UPDATE`.
- Использовать conditional update `WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
- Добавить DB unique constraint, запрещающий более одного активного acceptance для invite/deal.
- После affected rows = 0 возвращать conflict, не повторять побочные эффекты.

### Тест

`Promise.all` с двумя разными пользователями: ровно один success, второй 409; seller и event записаны один раз.

---

## [SEC-BE-006] Evidence upload выполняется до авторизации и без hard limits

**Severity:** Medium  
**Статус:** OPEN  
**Актив:** доступность, evidence, хранилище  
**Место:** `arbitration.controller.ts`, `evidence.service.ts`.

### Ошибка

Multer может записать файл до проверки доступа к спору. Нет полного набора transport limits, magic-byte проверки, AV scan и гарантированной очистки orphan-файла. При disk storage обращение к `file.buffer` также ненадёжно.

### Что изменить

1. Проверять dispute access до запуска upload interceptor либо загружать в изолированный quarantine.
2. Настроить `limits`: count ≤ 10, file size ≤ 10 MiB, request/body/field limits.
3. Проверять magic bytes, а не только client MIME/extension.
4. Запретить SVG/HTML или безопасно преобразовывать их.
5. AV scan; случайные server-side имена; path normalization; private object storage.
6. При любой ошибке удалять quarantine object.
7. SHA-256 фиксировать после scan и до публикации evidence.

### Тест

Outsider, oversized file, MIME spoof, SVG-XSS, zip bomb и path traversal не должны оставлять файл. Валидный файл сохраняется с hash и недоступен публично.

---

## [SEC-BE-007] Admin mutation и audit-log неатомарны

**Severity:** Medium  
**Статус:** OPEN  
**Актив:** целостность админских действий  
**Место:** admin controllers и `audit-log.service.ts`.

### Ошибка

Изменение сделки/спора и запись audit выполняются отдельно; ошибка audit может быть проглочена после успешной mutation. Это позволяет критическому admin action остаться без доказуемого следа.

### Что изменить

- Mutation и audit insert выполнять в одной DB-транзакции.
- Альтернатива: transactional outbox, но mutation считается завершённой только при записанном immutable audit event.
- Для security-critical действий использовать fail closed.
- На уровне DB запретить UPDATE/DELETE audit rows обычной роли приложения; применять append-only роль/триггер/WORM export.

### Тест

Fault injection: audit insert падает — mutation откатывается. Проверить actor, reason, before/after hash, correlation ID и UTC timestamp.

---

# 2. Смарт-контракты

## [SEC-SC-001] Штраф уменьшал выплату невиновному продавцу

**Severity:** High  
**Статус:** FIXED / VERIFY  
**Актив:** escrow principal  
**Инварианты:** I1, I5  
**Место:** `EscrowImplementation.sol`, расчёт resolve split.

### Ошибка

При verdict `buyer fault` штраф вычитался из общего escrow balance до распределения. В результате продавец с 100% award получал меньше principal, хотя D15 требует 100% невиновной стороне.

### Внесённое изменение

Principal теперь распределяется отдельно от ancillary buyer-funded суммы. Fine и fee не уменьшают principal невиновного; fine сначала покрывается ancillary, остаток — reserve/deferred механизмом.

### Что ещё проверить

- Conservation для 0/100, 100/0 и split awards.
- Dust rounding.
- Недостаточный ancillary/reserve.
- Fee-on-transfer/non-standard ERC20 assumptions.
- Экономическую модель: кто и когда обязан погашать deferred debt.

### Проверка

Контрактный агент сообщил: `114 passing (16s)`, `exit_code: 0`. Требуется независимый повторный запуск Hardhat suite и ручное ревью формул.

---

## [SEC-SC-002] Недостаток reserve блокировал `resolve`

**Severity:** High  
**Статус:** FIXED / VERIFY  
**Актив:** замороженные escrow-средства  
**Инвариант:** I1  
**Места:** `EscrowImplementation.sol`, `PlatformTreasury.sol`.

### Ошибка

`payArbitrator` ревертил при недостаточном reserve, откатывая весь `resolve`, включая выплаты пользователям и смену статуса.

### Внесённое изменение

Пользовательское settlement больше не зависит от достаточности reserve. Treasury выплачивает доступную часть и записывает остаток в `deferredArbitratorRewards`; claim ограничен текущим reserve.

### Что ещё проверить/изменить

- Accounting invariant должен включать deferred liabilities.
- Нужен лимит/мониторинг накопленного долга.
- Пополнение reserve не должно позволять front-run/нечестный порядок claims; при необходимости применять FIFO/pro-rata.
- Claim должен быть reentrancy-safe и не нарушать reserve accounting.

### Тест

Пустой reserve: пользователь получает principal, escrow становится `RESOLVED`, debt записан. Частичный reserve: paid + deferred = reward. Повторный claim не переплачивает.

---

## [SEC-SC-003] Арбитр мог вывести stake при активном споре

**Severity:** High  
**Статус:** FIXED / VERIFY  
**Актив:** залог арбитра  
**Инвариант:** I9  
**Место:** `ArbitratorRegistry.sol` и lifecycle Escrow.

### Ошибка

Registry не знал количество открытых назначений. Арбитр мог запросить/завершить вывод после cooldown, сохранив активный спор без обеспечения slash.

### Внесённое изменение

Добавлен `activeDisputes`, закрытые ролью `ESCROW_ROLE` функции `beginDispute/endDispute`, проверки при request и withdraw, а pending withdrawal исключает eligibility.

### Что ещё проверить

- Каждый путь назначения вызывает `beginDispute` ровно один раз.
- Каждый terminal-путь вызывает `endDispute` ровно один раз, включая cancel/reassignment/emergency resolution.
- Невозможны permanent counter leaks, блокирующие stake навсегда.
- Только factory-created escrow получает `ESCROW_ROLE`; deploy scripts реально выдают/отзывают роли.

---

## [SEC-SC-004] Single-EOA admin backdoor

**Severity:** High  
**Статус:** FIXED / VERIFY + OPERATIONAL  
**Актив:** treasury, reserve, роли контрактов  
**Места:** constructors контрактов, `contracts/scripts/deploy.ts`.

### Ошибка

Один EOA с admin/default-admin мог вывести main balance, инициировать compensation или выдать роли атакующему. Комментарий о Timelock не обеспечивал контроль технически.

### Внесённое изменение

На non-local chain admin обязан быть contract address; deploy script требует явный governance contract, отличный от deployer. Local Hardhat сохраняет EOA для тестов.

### Что ещё обязательно сделать

1. Governance address должен быть проверенным Safe 2/3 и/или Timelock, а не произвольным вредоносным контрактом.
2. Разделить proposer/executor/canceller роли Timelock.
3. Отозвать роли deployer после инициализации.
4. Добавить deployment assertions всех role holders и delay.
5. Ключи Safe держать у разных людей/устройств.

### Тест

Non-local deployment с EOA обязан revert/fail. Governance contract проходит. После deploy EOA deployer не имеет admin/withdraw ролей; операция выполняется только после timelock delay и требуемых подписей.

---

# 3. CI/CD, Docker, nginx и эксплуатация

## [SEC-INF-001] Lint не блокировал merge

**Severity:** Medium  
**Статус:** IN PROGRESS  
**Место:** `.github/workflows/ci.yml`.

### Ошибка

`continue-on-error: true` делал lint информационным: PR оставался зелёным даже при ошибках.

### Изменение

Флаг удалён, lint сделан blocking. Перед merge нужно убедиться, что команды существуют и не используют `--fix` в CI.

### Тест

В тестовой ветке добавить lint violation: workflow должен завершиться non-zero и заблокировать required status check.

---

## [SEC-INF-002] Отсутствовали блокирующие security gates

**Severity:** High  
**Статус:** IN PROGRESS  
**Место:** `.github/workflows/ci.yml`.

### Ошибка

Build/tests не обнаруживают секреты, vulnerable dependencies и многие Solidity-дефекты.

### Внесённые изменения

В текущем diff добавлены gitleaks, `npm audit --audit-level=high`, Slither и опциональный coverage gate.

### Что изменить дополнительно

- Закрепить scanner image digest.
- Не делать coverage security gate опциональным после стабилизации; установить ≥90% по prompt.
- Добавить Mythril либо обоснованный эквивалент.
- Настроить branch protection: все jobs required, bypass ограничен.
- Добавить artifact/SBOM и Dependabot/Renovate.
- Проверить Slither suppressions: только точечные с rationale.

### Тест

Canary secret, High dependency fixture и Solidity detector fixture должны делать workflow red. После теста fixtures удалить безопасно.

---

## [SEC-INF-003] Actions и container images не закреплены SHA/digest

**Severity:** Medium  
**Статус:** OPEN  
**Актив:** supply chain  
**Места:** `.github/workflows/ci.yml`, Dockerfiles, Compose.

### Ошибка

`actions/checkout@v4`, `setup-node@v4`, `postgres:15-alpine`, `redis:7-alpine`, scanner tag и base images — mutable references. Компрометация upstream/tag может незаметно изменить исполняемый код.

### Что изменить

- GitHub Actions закрепить полным commit SHA с комментарием версии.
- Docker images закрепить `image:tag@sha256:digest`.
- Автообновления выполнять Renovate/Dependabot PR с review.
- Policy-as-code (`zizmor`, Conftest) запрещает tag-only refs.

### Тест

CI policy падает при `uses: ...@vN` без SHA и image без digest.

---

## [SEC-INF-004] Root-контейнеры и экспозиция DB/Redis

**Severity:** High  
**Статус:** IN PROGRESS  
**Актив:** БД, Redis, host/container boundary  
**Места:** Dockerfiles, `docker-compose.yml`.

### Ошибка

При RCE root внутри контейнера увеличивает impact. Публичные host ports DB/Redis с defaults создают удалённый путь к данным/очередям.

### Внесённые изменения

Dockerfiles переведены к non-root; DB/Redis ports bind на `127.0.0.1`. Это лучше для dev, но production должен вообще не публиковать эти ports.

### Что изменить

- Разделить dev/prod Compose override.
- В production удалить `ports` DB/Redis, оставить только internal network/expose.
- Добавить `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, resource limits где совместимо.
- Проверить ownership volumes и runtime UID.
- Не встраивать секреты в image layers.

### Тест

`docker inspect` показывает non-root; внешний socket scan не видит 5432/6379; приложение внутри сети подключается; read-only FS не ломает runtime.

---

## [SEC-INF-005] Недостаточный TLS/security headers hardening

**Severity:** Medium  
**Статус:** IN PROGRESS  
**Места:** `nginx.conf`, `mini-app/nginx.conf`.

### Ошибка

Отсутствовали CSP/HSTS/nosniff/referrer/permissions controls и доказанная TLS termination. Для Telegram Mini App нельзя бездумно ставить `X-Frame-Options: DENY/SAMEORIGIN`, иначе embedding сломается.

### Что изменить

- TLS 1.2/1.3 на внешнем ingress, HTTP→HTTPS redirect.
- HSTS только после подтверждения полного HTTPS.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- CSP с минимальными Telegram/API origins; frame policy через CSP `frame-ancestors` совместимо с Telegram.
- Не использовать wildcard без необходимости.

### Тест

`curl -I`, Mozilla Observatory/OWASP ZAP; открыть Mini App внутри Telegram на supported clients.

---

## [SEC-INF-006] Relay private key хранится как env-секрет

**Severity:** High  
**Статус:** OPEN / OPERATIONAL  
**Актив:** hot-wallet  
**Место:** `.env.example`, blockchain signer configuration.

### Ошибка

Exportable private key в env может попасть в process dump, orchestrator metadata, diagnostic bundle, shell history или скомпрометированный host. Кража ключа позволяет двигать USDT hot-wallet.

### Что изменить

1. Использовать non-exportable KMS/HSM/Vault Transit signer.
2. Backend передаёт digest/typed transaction на signing API, ключ никогда не покидает KMS.
3. Ограничить IAM signer permission конкретным workload identity.
4. Ввести destination/amount/rate policy, two-person break-glass, rotation.
5. Удалить runtime поддержку plaintext key из production profile.

### Тест

Production стартует без `BLOCKCHAIN_PRIVATE_KEY`; signing работает только через KMS. Отзыв IAM блокирует tx и создаёт алерт, не вызывает бесконечный duplicate retry.

---

## [SEC-INF-007] DR не доказан и backups не гарантированно encrypted

**Severity:** Medium  
**Статус:** IN PROGRESS / OPERATIONAL  
**Места:** backup scripts, deployment/security runbooks.

### Ошибка

Checksum/off-site backup недостаточны: не было доказанного client-side encryption, определённых RPO/RTO и журнала restore drill.

### Внесённое изменение

Создан `docs/SECURITY_INCIDENT_RUNBOOK.md` с RPO 5 минут, RTO, encrypted backup и monthly restore guidance.

### Что ещё сделать

- Реализовать encryption в backup script до upload.
- KMS key отделить от storage credentials.
- Object lock/immutable retention.
- Автоматизированный isolated restore drill с reconciliation.
- Хранить evidence достигнутых RPO/RTO.

---

## [SEC-INF-008] Compose обходит PostgreSQL entrypoint

**Severity:** Critical  
**Статус:** OPEN — внесённая security-регрессия  
**Место:** `docker-compose.yml`, service `postgres`, `command: sh -ec ...`.

### Ошибка

Официальный `postgres:15-alpine` entrypoint выполняет initdb, обработку env и понижение привилегий, когда получает первым аргументом `postgres`. Замена command на `sh` обходит эту логику; затем `exec postgres` выполняется от root, а PostgreSQL запрещает такой запуск. Контейнер может не стартовать и не инициализироваться.

### Что изменить

Предпочтительно создать небольшой wrapper-entrypoint:

1. Wrapper проверяет production placeholders.
2. Затем делает `exec /usr/local/bin/docker-entrypoint.sh postgres`.
3. Wrapper монтируется read-only или включается в производный image.
4. Не дублировать внутреннюю логику официального entrypoint.

Альтернатива — вынести fail-closed проверку в user-service startup и оставить PostgreSQL command штатным, но тогда отдельно обеспечить секреты через orchestrator.

### Тест

- Fresh empty volume: DB инициализируется и healthy.
- Existing volume: DB стартует без повторной инициализации.
- Production placeholder: startup fail closed до обслуживания запросов.
- Процесс postgres работает не от root.

---

## [SEC-INF-009] Compose обходит Redis entrypoint и запускает Redis root

**Severity:** High  
**Статус:** OPEN — внесённая security-регрессия  
**Место:** `docker-compose.yml`, service `redis`, `command: sh -ec ...`.

### Ошибка

При `sh` штатный Redis entrypoint не выполняет переход на пользователя `redis`; `exec redis-server` запускается root. Это противоречит цели hardening и увеличивает impact RCE.

### Что изменить

- Wrapper после проверки должен вызывать штатный entrypoint с `redis-server --requirepass ...`.
- Либо явно `user: redis` после проверки прав `/data`, но предпочтительнее сохранить upstream entrypoint.
- Пароль передавать через secret file/ACL, если поддерживает deployment environment.

### Тест

Redis healthy, persistence работает, UID процесса не 0, неправильный production secret блокирует startup.

---

## [SEC-INF-010] Production допускает placeholders из `.env.example`

**Severity:** High  
**Статус:** OPEN  
**Место:** `docker-compose.yml` production checks и `.env.example`.

### Ошибка

Проверки отклоняют только `dev-only-*`, но документированный сценарий копирования `.env.example` даёт значения `replace_me_*`. Они проходят production checks, хотя реальными секретами не являются.

### Что изменить

- Отклонять пустые, `dev-only-*`, `replace_me_*`, известные test values.
- JWT: проверять достаточную случайную длину/entropy policy, не логируя значение.
- Bot token: проверять базовый формат, но формат не считать доказательством валидности.
- DB/Redis passwords: минимальная длина и запрет common/default values.
- Лучше получать secrets через Docker/Kubernetes secrets/Vault и требовать `_FILE`/secret mount.
- Единую validation функцию использовать в startup backend, а не сложный shell, склонный к расхождениям.

### Тест

Production config с каждым placeholder должен завершаться non-zero. С валидными injected secrets — стартовать. В логах только имя отсутствующего секрета, не значение.

---

# 4. Архитектурные денежные пробелы

## [SEC-ARCH-001] Reconciliation-инвариант I4 не реализован полностью

**Severity:** High  
**Статус:** OPEN  
**Актив:** все средства  
**Место:** `reconciliation.service.ts`.

### Ошибка

Текущий reconciliation преимущественно повторяет funding/recovery, но не доказывает:

`sum(funded liabilities) == hot-wallet finalized balance + sum(active escrow finalized balances)`.

Нет гарантированного автоматического stop-payout при расхождении.

### Что изменить

- Считать обе стороны инварианта на одном finalized block.
- Включить pending/deferred/fee/reserve liabilities явно.
- При ненулевой дельте атомарно включать глобальный payout/forward circuit breaker.
- Отправлять high-severity alert с агрегатами без PII/secrets.
- Возобновление — только вручную двумя ролями после compensating ledger entry.

### Тест

Искусственно изменить одну сторону на минимальную единицу: reconciliation красный, auto payouts остановлены, alert создан. После корректировки — controlled resume.

---

## [SEC-ARCH-002] Нет полноценного double-entry ledger

**Severity:** High  
**Статус:** OPEN  
**Актив:** денежный учёт  
**Инварианты:** I1, I4  

### Ошибка

Payment/deal statuses и tx hashes не заменяют бухгалтерский ledger. Без debit/credit entries трудно доказать conservation и обнаружить скрытые расхождения.

### Что изменить

- Append-only journal entry + postings, где сумма debit = сумма credit.
- Счета: provider receivable, hot-wallet, escrow, user liability, treasury main/reserve, deferred arb rewards.
- Каждый provider ID/tx hash/business operation связан с единственным journal transaction.
- DB constraints запрещают несбалансированную проводку.

### Тест

Любая несбалансированная запись отклоняется; duplicate business key не создаёт вторую проводку; reconciliation ledger↔chain/provider сходится.

---

## [SEC-ARCH-003] Outbox не восстанавливает зависшие `IN_FLIGHT`

**Severity:** High  
**Статус:** OPEN  
**Инвариант:** I3  
**Место:** `outbox.service.ts`.

### Ошибка

Если worker падает после перевода события в `IN_FLIGHT`, запись может не вернуться в retry. Это создаёт permanent stuck forward или ручные небезопасные повторы.

### Что изменить

- Lease fields: `locked_at`, `locked_by`, `lease_until`.
- Claim через `FOR UPDATE SKIP LOCKED`.
- Sweeper возвращает expired lease в retry только после проверки side effect state.
- Stable idempotency key и bounded attempts; после 5 fails — quarantine/manual review.

### Тест

Kill worker после claim; второй worker после lease подбирает событие, но side effect выполняется максимум один раз.

---

# 5. Дополнительные доказанные защиты

Следующие элементы присутствовали и должны сохраняться при рефакторинге:

- Telegram initData: HMAC-SHA256, constant-time compare, TTL.
- Cryptomus signature: fail closed и constant-time compare.
- Global DTO whitelist/reject unknown fields.
- Solidity settlement: `nonReentrant`, status-before-transfer, role guards.
- SafeERC20 используется в проектных контрактах.
- Clone initialization выполняется атомарно factory; implementation initialization locked.

Это не закрывает replay initData внутри TTL. Для особо чувствительных мутаций рекомендуется хранить `query_id`/nonce и запрещать повторное использование.

---

# 6. Рекомендуемый порядок работ

## Этап 0 — немедленно

1. Исправить SEC-INF-008 и SEC-INF-009, потому что текущий Compose hardening создал регрессии запуска/root.
2. Исправить SEC-INF-010.
3. Завершить и независимо проверить SEC-BE-001 и SEC-BE-002.
4. Не включать реальные forwards/payouts до green race tests и reconciliation stop-switch.

## Этап 1 — до закрытой beta

1. Закрыть IDOR SEC-BE-003/004 и invite race SEC-BE-005.
2. Реализовать SEC-ARCH-001/002/003.
3. Закрыть evidence upload и atomic admin audit.
4. Перевести relay signer в KMS/Vault.
5. Сделать security CI gates обязательными.

## Этап 2 — до mainnet

1. Независимый аудит Solidity и backend payment flow.
2. Coverage ≥90%, Slither/Mythril без High.
3. Проверенный Safe 2/3 + Timelock и role assertions.
4. Полный restore drill с доказанным RPO/RTO.
5. Incident tabletop exercise и bug bounty/reporting channel.

---

# 7. Приёмочный checklist

- [ ] Нет открытых Critical/High.
- [ ] Parallel duplicate webhook вызывает ровно один forward.
- [ ] Terminal FSM нельзя вернуть в активное состояние.
- [ ] Outsider не читает deal/chat/events/evidence/decision.
- [ ] Invite принимает только один пользователь под гонкой.
- [ ] Reconciliation mismatch автоматически останавливает деньги.
- [ ] Double-entry ledger и chain/provider reconciliation зелёные.
- [ ] Outbox восстанавливается после crash без duplicate side effect.
- [ ] Evidence upload проходит AuthZ, limits, magic-byte и AV проверки.
- [ ] Admin mutation невозможна без атомарного audit event.
- [ ] Contract tests повторно показывают не менее `114 passing` после независимого запуска.
- [ ] Hardhat coverage ≥90%, Slither/Mythril без High.
- [ ] Production governance — проверенный Safe/Timelock; deployer roles отозваны.
- [ ] PostgreSQL/Redis используют штатные entrypoints и non-root UID.
- [ ] Production не принимает dev/test/`replace_me_*` secrets.
- [ ] DB/Redis не опубликованы наружу production-сети.
- [ ] Relay key non-exportable в KMS/Vault.
- [ ] CI блокирует secret/dependency/Solidity High/Critical.
- [ ] Encrypted backup восстановлен в isolated drill, RPO/RTO подтверждены.

---

## Итоговый риск

Проект пока **не соответствует критериям «идеальной версии»** из `SECURITY_EXPERT_PROMPT.md`: остаются открытые денежные архитектурные High, operational KMS gap и три подтверждённые Compose-проблемы, одна из которых Critical. Контрактные High получили исправления и regression tests, но требуют независимой проверки формул, ролей и deployment configuration. До production необходимо закрыть все пункты Critical/High и повторно выполнить полный security verification.
