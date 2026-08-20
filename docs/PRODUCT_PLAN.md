# Telegram Garant — Product Plan (v0.3: TON-focused multichain)

> Единый источник правды по продукту и архитектуре. Детальный порядок работ и release gates: [MULTICHAIN_PUBLIC_LAUNCH_PLAN.md](./MULTICHAIN_PUBLIC_LAUNCH_PLAN.md). Техническая декомпозиция: [MULTICHAIN_IMPLEMENTATION_SPEC.md](./MULTICHAIN_IMPLEMENTATION_SPEC.md).
>
> Статус: **подтверждённое продуктовое направление; реализация к публичному запуску не завершена**. TON является основным Telegram-направлением, Polygon сохраняется как полноценный выбор пользователя. Реальные деньги запрещены до прохождения policy/legal, security, reconciliation, audit и closed-beta gates для каждой включённой сети.

### Правило приоритета v0.3

Версия v0.3 отменяет как Polygon-only, так и TON-only трактовку. **TON и Polygon остаются в продукте**, а стороны выбирают сеть сделки до funding. Одна сделка никогда не скрывает переход между сетями: funding, escrow, release/refund и reconciliation выполняются в выбранной сети. При любом конфликте приоритет имеют решения D1–D22 этой версии, [multichain launch plan](./MULTICHAIN_PUBLIC_LAUNCH_PLAN.md) и [implementation spec](./MULTICHAIN_IMPLEMENTATION_SPEC.md).

---

## 1. Что мы делаем

**Telegram Garant** — anti-scam P2P escrow с Telegram Mini App и полноценным сайтом на одном ядре. Покупатель и продавец фиксируют условия и выбирают сеть сделки, после чего покупатель переводит средства непосредственно в TON- или Polygon-эскроу. При споре уполномоченный арбитр распределяет средства в той же сети по опубликованным правилам.

**Целевая аудитория MVP:** русскоязычные P2P-пользователи в явно разрешённых странах. Категории цифровых товаров/доступов/услуг внутри Mini App включаются только после письменного подтверждения допустимой Telegram payment-policy модели; сайт может иметь отдельный разрешённый scope.

**Чего точно нет в MVP** (явно, чтобы не было разночтений):
- Конструктор ботов с self-host у продавца (Phase 3+).
- Гарантии «вывод на любую карту/в любой стране». В MVP гарантируется direct payout в активе сделки на TON-кошелёк; fiat/card/SBP включается отдельно по стране через разрешённого партнёра.
- Физические товары с доставкой, аренда, сложные multi-stage сделки (Phase 2+).
- Decentralized арбитраж со стейкингом (Phase 3+).
- Внешняя проверка скам-историй (Phase 2, и только как ручная модерация).
- Реферальная программа (Phase 2).
- BSC/TRON и cross-chain settlement внутри одной сделки. TON и Polygon входят в целевую модель; другие сети добавляются только через тот же adapter/audit process.

---

## 2. Решения v0.3 и пункты, требующие freeze

Подтверждённое направление: TON-focused, Polygon retained, выбор сети сторонами, выгода обеим сторонам, низкие прозрачные комиссии, Mini App + сайт и security-first release gates. Численные targets и архитектурные варианты, отмеченные как proposed/ADR/legal, являются рекомендацией этого плана и становятся фиксированным решением только после соответствующего sign-off.

| # | Решение | Значение | Обоснование |
|---|---------|----------|-------------|
| D1 | Custody | Direct buyer funding в escrow выбранной сети; direct same-chain/same-asset payout продавцу | Основной путь не проводит TON через Polygon float или наоборот. Любой conversion/fiat rail — отдельная явно котируемая услуга партнёра. |
| D2 | Сеть и актив в эскроу (MVP) | **TON и Polygon**. TON: официальный USDT-TON, TONCOIN после lifecycle-тестирования. Polygon: allowlisted USDT deployment. RUB может быть валютой отображения. | Стороны выбирают сеть до funding и подтверждают её в terms hash. Mini App исполняет TON; Polygon исполняется на сайте, если Telegram не даст письменное разрешение на иной flow. |
| D3 | Тип сделки (MVP) | Технически поддерживаем 5 digital-подкатегорий, но их доступность по каналу и стране определяется policy/legal allowlist | Telegram отдельно регулирует оплату digital goods/services. Публичный scope нельзя считать разрешённым без письменного решения; контракт/FSM могут быть общими для разрешённых категорий. |
| D4 | Распределение комиссии | Дефолт 50/50, при создании сделки можно выбрать 100/0 (на покупателе) или 0/100 (на продавце) | Скамят чаще продавцы, безопасность нужна обеим сторонам. Перенос — только до funding'а, не во время спора. |
| D5 | Тариф комиссии | Точный тариф утверждается после unit economics. **Proposed launch target:** all-in cost ≤ 3% минимум для 90% целевого объёма; small-deal exceptions раскрываются заранее. Один versioned quote задаёт buyer total и seller net во всех слоях. | Старый тариф 50 ₽/5% не является целевым: на минимальной сделке он доходил до 16,7% и не доказывал низкую комиссию. |
| D6 | Минимальная сумма | Определяется по ticket-band unit economics для конкретного asset/rail; прежние 300 ₽ не зафиксированы. | Минимум должен одновременно сохранять низкий all-in процент и не создавать отрицательную маржу после газа, поддержки, risk reserve и ожидаемого арбитража. |
| D7 | Арбитраж (MVP) | Централизованный пул, 1 арбитр на спор, апелляция → второй арбитр | Decentralized — Phase 3+. На старте арбитров нанимаем (см. §11). |
| D8 | Юрисдикции | Launch-country allowlist и отдельный legal/provider sign-off по каждой стране; Россия оценивается первой, но не считается автоматически разрешённой | Блокирует любые реальные деньги, включая closed beta. «СНГ» не является одной регуляторной зоной. |
| D9 | Контрактный паттерн | Две независимые реализации за общим domain interface: TON isolated escrow по TON ADR и Polygon `EscrowFactory`/isolated clone после hardening | Chain-specific безопасность не абстрагируется. Общими остаются terms/quote, FSM, ledger semantics и acceptance tests. |
| D10 | Auth и wallet proof | Telegram WebApp `initData` с replay protection + TON Connect/`ton_proof` для подтверждения кошелька | Telegram identity и владение кошельком — разные доказательства; ни одно не должно подменять другое. |
| D11 | Стек | NestJS/PostgreSQL/Redis/BullMQ/Telegraf/React-Vite + ethers для Polygon + TON SDK/contract toolchain для TON; chain adapters за typed interface | Одна сеть не должна загрязнять код и инварианты другой, но обе используют единое продуктовое ядро. |
| D12 | UX-парадигма | **Button-driven**: все действия через inline-кнопки в боте и кнопки в Mini App. Текстовые команды — только `/start`, `/help`, `/support` как deep-link fallback. | Снижает порог входа, исключает ошибки ввода, нативно для Telegram. |
| D13 | Дизайн-система | Общий UI Kit для Mini App и сайта; Mini App адаптируется к `Telegram.WebApp.themeParams`, сайт имеет собственную responsive оболочку. Skeleton loaders, clear states, accessibility и haptic там, где он доступен. | UX моделируется параллельно с interaction contracts; финальный visual pass выполняется после стабилизации money flow. |
| D14 | Админ-панели | **Две панели в MVP**: (a) Arbitrator workspace; (b) Admin/support workspace. Для production они могут жить на отдельном защищённом web origin с MFA/step-up auth, а не внутри пользовательского Mini App | Money-moving и evidence-доступ требуют более сильной операторской защиты, чем обычный Telegram session. |
| D15 | Оплата арбитра | Сохраняем принцип отдельного финансирования арбитража и защиты невиновной стороны, но точные 10%/100–1000 ₽/20% reserve считаются гипотезой до legal и unit-economics sign-off | Нельзя одновременно обещать низкую комиссию и неограниченную компенсацию без доказанной резервной модели. |
| D16 | Залог арбитра | Механизм stake/slashing сохраняется как продуктовая гипотеза; asset/network/custody и legal treatment утверждаются отдельно | Существующий `ArbitratorRegistry.sol` может обслуживать Polygon, но не считается общим реестром TON без отдельного ADR. |
| D17 | Vacation & capacity | Арбитр сам управляет статусом: ACTIVE / VACATION / CAPACITY_LIMITED. Vacation — auto-resume по дате, нельзя если есть открытые споры (надо сдать head_arbitrator'у). Лимит отпуска — 30 дней / год. Capacity — max active disputes (по умолчанию 5). | Минимизирует burnout арбитров и даёт прозрачную загрузку. |
| D18 | Взаимная выгода | До funding показываем buyer total, seller net, fee/rail/FX, сроки и refund outcome; условия подписываются обеими сторонами | Гарантия ценна только тогда, когда обе стороны понимают цену и получают защиту от бездействия контрагента. |
| D19 | Payout truth | В MVP гарантируем same-chain/same-asset payout: TON deal → TON wallet; Polygon deal → Polygon wallet. Card/SBP/fiat показывается только eligible пользователю после country/provider check | Визуальный выбор сети/валюты без реального исполнения запрещён. |
| D20 | Security release gate | Ноль unresolved Critical/High, семь дней zero reconciliation delta, внешний аудит и capped closed beta до public funds | Абсолютной гарантии безопасности не существует; готовность доказывается тестами, аудитом, лимитами и recovery. |
| D21 | Два клиента | Mini App и полноценный сайт используют одно ядро, design system, API schemas и финансовую терминологию | UI проектируется совместно, но правила сделки и расчёты не должны расходиться между каналами. |
| D22 | Network choice | Сеть является обязательной версионированной частью terms; обе стороны подтверждают её до funding, после funding изменить нельзя | Пользователь выбирает выгоду TON или Polygon сам; платформа показывает сравнение fee/speed/wallet/payout и не делает скрытый bridge. |

---

## 3. Поток одной сделки (happy path)

```
[1] Покупатель в Mini App или на сайте создаёт сделку
    → выбирает разрешённую категорию, цену, сеть и актив
    → Mini App предлагает TON; сайт предлагает TON и Polygon по availability matrix
    → выбирает распределение platform fee
    → backend формирует chain-specific versioned quote: buyer total, seller net, network/rail fees, сроки, refund outcome

[2] Backend генерирует invite-ссылку с deal_id и canonical terms version
    → выбранный chain adapter создаёт/вычисляет адрес изолированного escrow
    → deal: status=PENDING_SELLER

[3] Покупатель отправляет ссылку продавцу

[4] Продавец открывает ссылку, подключает кошелёк выбранной сети и проверяет условия
    → при изменениях создаётся новая terms version; funding старой версии запрещён
    → network, chain id, token contract/master, payout address и seller net фиксируются в terms hash
    → обе стороны подтверждают одну версию
    → deal: status=AWAITING_FUNDING

[5] Покупатель нажимает «Оплатить»
    → TON: TON Connect в Mini App/website
    → Polygon: EIP-1193/WalletConnect на website
    → клиент формирует точную транзакцию в escrow выбранной сети
    → ручной ввод address/network/amount не нужен; кошелёк явно показывает сеть и актив

[6] Backend индексирует finalized транзакцию
    → chain adapter проверяет allowlisted token, sender, amount, deal id, finality и idempotency
    → пишет balanced ledger postings и сверяет on-chain escrow balance
    → deal: status=FUNDED
    → уведомляет обе стороны

[7] Оба клиента показывают: «Средства заблокированы»
    → адрес контракта, asset, сумма, final tx и terms hash доступны для проверки

[8a] Happy path:
    → продавец передаёт цифровой товар через чат сделки
    → покупатель жмёт "Подтвердить получение"
    → escrow выбранной сети исполняет release: seller net → seller wallet той же сети, fee → chain-specific treasury/reserve по quote
    → backend индексирует payout, завершает ledger/reconciliation
    → deal: status=COMPLETED → request reviews от обеих сторон

[8b] Timeout buyer:
    → опубликованное окно подтверждения истекло
    → контракт делает auto-release либо переводит сделку в гарантированный dispute flow по правилам категории
    → продавец не зависит бессрочно от подписи покупателя

[8c] Sad path (любая сторона жмёт "Открыть спор"):
    → deal: status=DISPUTED
    → 48h evidence period: обе стороны загружают доказательства (скриншоты, чек-логи, файлы)
    → файлы хэшируются, хэши immutable в БД; снапшот чата фиксируется (хэш-цепочка сообщений)
    → backend случайно назначает свободного арбитра (round-robin с фильтром "конфликт интересов")
    → арбитр читает чат + evidence, может задать уточняющие вопросы в "арбитражном чате"
    → 72h на решение → chain adapter вызывает escrow resolve(buyer_share_bps, seller_share_bps)
    → если кто-то из сторон запросил апелляцию в течение 24h → новый арбитр (или панель из 3 для крупных сумм)
    → итоговое решение исполняется on-chain
    → deal: status=RESOLVED

[9] После closure (любого):
    → reviews от обеих сторон (двойная)
    → reputation update
    → решения арбитра анонимизированно публикуются в "прецедентную базу" (опционально)
```

### Граничные случаи (обязательны в MVP)

- **Cancel до funding**: любая сторона жмёт "отменить", deal: status=CANCELLED, без последствий.
- **Timeout funding**: 7 дней без оплаты → deal: status=EXPIRED.
- **Timeout seller after funding**: 14 дней без активности продавца после funding → автоматически открывается спор в пользу покупателя.
- **Partial release**: только через consent обеих сторон ИЛИ через арбитра в диспуте.
- **Indexer повторил/пропустил событие**: cursor + backfill + unique event/action key + независимая сверка; credit строго idempotent.
- **Контракт не задеплоился**: funding request не показывается как готовый; retry/alert без ручного перенаправления пользовательских средств.
- **Fake jetton / неверная сумма / underpayment**: не credit; отдельный recovery state и support runbook.
- **Wrong EVM chain/token или неподдерживаемый contract address**: не credit; UI не предлагает импорт/переключение без повторной проверки chain-specific quote.
- **Стороны хотят разные сети**: переговоры создают новую terms version; до взаимного подтверждения funding запрещён.
- **Reconciliation mismatch**: автоматическая остановка новых funding requests и egress до dual-authorized recovery.

---

## 4. Контракты: TON и Polygon

> **Важно:** TON и Polygon — независимые settlement implementations. Их объединяет typed backend interface и одинаковые business invariants, но аудит, токены, finality, wallet UX и deployment manifests отдельны. Ни одна сеть не считается production-ready только потому, что готова другая.

### 4.P1 Polygon contracts (retained, requires hardening)

| Контракт | Назначение | Изменяемость |
|----------|-----------|--------------|
| `EscrowImplementation.sol` | Логика одного эскроу (за которым клонится множество proxy) | Immutable, новая версия = новый адрес |
| `EscrowFactory.sol` | Деплой клонов через `Clones.cloneDeterministic`, конфиг **тарифной сетки** (порог + ставки + флэт), регистр арбитров | Owner-controlled, через TimelockController |
| `PlatformTreasury.sol` | Аккумулирует комиссии и Treasury Reserve (20% отчислений), multisig withdrawal | 2/3 multisig |
| `ArbitratorRegistry.sol` | On-chain реестр арбитров: stake, level, status, slashing (D16) | Owner-controlled через TimelockController |

### 4.P2 Polygon `EscrowImplementation`

```solidity
// State
enum Status { CREATED, FUNDED, RELEASED, REFUNDED, DISPUTED, RESOLVED, CANCELLED, EXPIRED }
Status public status;
address public buyer;
address public seller;
bytes32 public dealId;
uint256 public amount;
uint256 public buyerFee;      // абсолютная сумма в USDT-wei, рассчитана фабрикой по тарифной сетке (D5)
uint256 public sellerFee;     // абсолютная сумма в USDT-wei
// Примечание: для < $11 экв. — фикс ~$0.55, иначе 5% от amount; распределение между buyer/seller — по D4.
uint64  public fundingDeadline;

// Lifecycle (called by factory or relay only)
function initialize(address buyer, address seller, bytes32 dealId, uint256 amount, uint256 buyerFee, uint256 sellerFee, uint64 fundingDeadline) external;
function notifyFunded() external;       // called by relay after USDT transfer in
function cancel() external;              // before FUNDED, by buyer or seller

// Resolution
function release() external;            // BUYER ONLY when FUNDED
function refund() external;              // SELLER ONLY when FUNDED (he gives up)
function dispute() external;            // any party when FUNDED
function resolve(uint16 buyerSharePct, uint16 sellerSharePct) external; // arbitrator only when DISPUTED

// View
function getBalance() external view returns (uint256);
```

**Жёсткие правила (фикс багов из текущего `Escrow.sol`):**
- `release()` — только покупатель. Не "любая сторона".
- `refund()` — только продавец (отказался от сделки). Арбитр делает refund через `resolve(100, 0)`.
- ReentrancyGuard на `release` / `refund` / `resolve`.
- Комиссия извлекается из `amount` и переводится в `PlatformTreasury` тем же вызовом, что отправляет деньги стороне. Никаких "застрявших на контракте" денег.

### 4.P3 Polygon gas strategy

Все вызовы (release, refund, dispute, resolve, notifyFunded) — **через relay-кошелёк платформы**. Пользователи никогда не платят газ напрямую. Газ компенсируется из комиссии. У relay'я отдельный bot-кошелёк с минимальным балансом MATIC (рефиллится из treasury).

### 4.P4 Per-chain tests и аудит

- Hardhat coverage ≥ 90% на финальных версиях контрактов (Foundry опционально).
- Slither + Mythril в CI.
- Polygon: property/fuzz/invariant tests, allowlisted token/chain assertions, verified deployment manifest и независимый audit.
- TON: property/fuzz tests, canonical jetton/finality assertions, verified deployment manifest и независимый audit.
- Общий conformance suite запускается для обоих adapters, но не заменяет chain-specific security tests.
- **До любых реальных денег, включая closed beta** — ноль нерешённых Critical/High и независимый retest исправлений.

---

## 5. Backend (NestJS)

> Сохраняем модульную продуктовую основу и выделяем chain-neutral orchestration поверх отдельных TON и Polygon adapters. Текущий TON→Polygon relay остаётся migration path только до нативного TON escrow и не является целевой схемой.

### 5.1 Модули

```
src/modules/
├── auth/              # Telegram WebApp initData валидация, JWT для веба
├── user/              # Профили, settings, payout-адреса
├── deal/              # Сделки, FSM, чат, snapshot чата
├── arbitration/       # Споры, evidence, decisions, апелляции, назначение арбитров
├── payment/           # TON Connect requests, TON/jetton ingestion, optional provider rails
├── escrow/            # TON contracts, finalized event indexer, release/refund/resolve
├── ledger/            # Полная двойная запись, liabilities, fees/reserve/payout и reconciliation
├── notification/      # Telegram-пуши, email-fallback на критичные события
├── review/            # Двойные отзывы, репутация, trust score
├── admin/             # Internal API для арбитров и саппорта (auth по роли)
├── moderation/        # Фильтры запрещённых тематик, жалобы
└── i18n/              # ru на MVP, en/es позже
```

### 5.2 Инфраструктурные паттерны

- **Outbox/inbox pattern** для всех внешних событий (TON indexer, provider webhook, notifications). Приём → durable insert → BullMQ worker → side-effect → mark processed. Гарантия at-least-once + idempotency.
- **Idempotency keys** на все мутирующие endpoint-ы.
- **Reconciliation** по finalized snapshot доказывает `on-chain assets = user liabilities + fees + reserves + deferred payouts`. Необъяснённое расхождение включает circuit breaker, а не только alert.
- **State machine** на сделке как явный код (XState или собственный enum-FSM с гардами), не как if/else в сервисах.

### 5.3 Стратегия миграции текущего кода

- Переиспользуем работающие deal/chat/arbitration/admin/reputation модули после contract/integration tests.
- Polygon contracts и EVM wallet flow сохраняем, harden и помещаем за `PolygonEscrowAdapter`.
- TON→Polygon relay/float маркируем transitional и удаляем после native TON E2E parity; он не должен становиться третьей скрытой settlement-моделью.
- Общий код выделяем только на уровне domain FSM, quote, ledger и adapter contracts; chain-specific проверку не смешиваем.
- Сначала исправляем подтверждённые API/FSM gaps: `subcategory`, fee payer, RUB/payment DTO, TONCOIN completion, durable TON tx IDs, on-chain refund и auto-release.
- Документы со статусом «complete» не используются как доказательство; source of truth — этот план, код, CI evidence и release reports.

---

## 6. Арбитраж — детальная спецификация

> Workflow, evidence и appeal сохраняются как продуктовая основа. Экономика, stake и on-chain registry из v0.1 пересмотрены решениями D5/D15/D16: они не считаются финальными до legal, incentive и unit-economics review.

### 6.1 Модель MVP

**Централизованный пул** (см. D7). Арбитры — нанятые/верифицированные платформой люди.

### 6.2 Шесть обязательных элементов (без них модель развалится)

1. **SLA по фазам:**
   - Evidence period: 48h после открытия спора.
   - Arbitrator decision: 72h после окончания evidence.
   - Appeal window: 24h после решения.
   - Appeal decision: 72h.
   - Тотальный SLA на разрешение спора: ≤ 8 дней.
   - Превышение SLA → автоматическая эскалация старшему арбитру + штраф арбитру.

2. **Structured evidence:** не "приложи файл", а форма со слотами:
   - "Описание проблемы" (text, ≤ 2000 символов)
   - "Доказательства передачи/непередачи товара" (файлы, до 10 шт, ≤ 10 MB)
   - "Скриншоты переписки вне платформы" (опционально)
   - "Ссылки на внешние подтверждения"
   - Каждый безопасно принятый файл хэшируется (SHA-256); hash и audit metadata неизменяемы. Файлы — в private object storage с quarantine/AV и сроком хранения, утверждённым legal/privacy policy.

3. **Снапшот чата:** при открытии спора — генерируется JSON со всеми сообщениями + Merkle-root, хэш сохраняется в БД и в `Escrow.disputeSnapshot` on-chain. Стороны не могут "дописать" историю задним числом.

4. **Конфликт интересов:** арбитр не может быть назначен на спор где:
   - Он сам участник.
   - Любая из сторон — в его "linked accounts" (определяется по IP, telegram_id, payout-адресу за последние 90 дней).
   - Он уже арбитрировал ≥ 3 спора с любым из участников за последние 30 дней (анти-сговор).

5. **Прозрачность решений:** после закрытия спора — текст решения публикуется в анонимизированной форме (юзеры → "Buyer A" / "Seller B", суммы → диапазоны) в публичной "прецедентной базе". Стороны видят свои решения полностью.

6. **Misconduct процесс:**
   - Жалоба на арбитра → ticket в admin.
   - Расследование старшим арбитром (head arbitrator).
   - Действия: warning / 30-day suspension / removal / financial penalty.
   - На beta минимум два обученных исполнителя плюс escalation owner; founder может быть head arbitrator, но не единственной точкой отказа.

### 6.3 Назначение арбитра

```
1. Спор открыт → backend получает список свободных арбитров (онлайн в последние 24h, не в отпуске).
2. Применяется фильтр "конфликт интересов" (см. §6.2.4).
3. Из оставшихся — round-robin (тот, кто давно не получал спор).
4. Арбитр получает уведомление, у него 4h принять или отказаться.
5. Если отказ или таймаут — следующий из списка.
6. Если все отказались — head arbitrator берёт лично или назначает вручную.
```

### 6.4 Роли в арбитраже

- **Junior arbitrator** — споры до $500.
- **Senior arbitrator** — споры до $5000 + апелляции.
- **Head arbitrator (founder/COO)** — крупнее $5000, misconduct, эскалации.

На старте: head arbitrator (ты), 1-2 junior. По мере роста — найм.

### 6.5 Экономика арбитра (D15; требуется freeze)

Модель v0.1 «10% с проигравшего, минимум 100 ₽» отменена как подтверждённая: на маленькой сделке она могла создавать 33% спорный штраф и конфликтовала с принципом доступной гарантии.

Финальная модель должна одновременно:

- показывать до funding максимальные последствия normal completion, refund и dispute;
- не уменьшать обещанный innocent-party outcome скрытой комиссией;
- компенсировать арбитру время независимо от того, какая сторона победила;
- не создавать арбитру стимула выбрать исход с большей выплатой;
- иметь резерв, подтверждённый loss/dispute-rate моделированием и beta-данными;
- сохранять non-negative platform margin без нарушения low-fee gate.

Рабочий вариант для моделирования: часть обычной platform fee направляется в прозрачный arbitration reserve; для злоупотребления может существовать отдельный заранее раскрытый misconduct charge, но его размер, источник и legal treatment утверждаются до Quote API freeze. Ранги и лимиты споров сохраняются; бонус не зависит напрямую от присуждённой стороне суммы.

**Защита от «продажи решения»:** так как штраф — прямой процент от сделки, теоретически арбитру выгоднее судить «в пользу той стороны, у которой больше денег вне платформы». Контрмеры:
- Доли решений (50/50 / 70/30 / 30/70) — арбитр выбирает соотношение, не «победителя», что усложняет коррупцию.
- Random round-robin назначение (нет права выбрать спор).
- Публикация решений в анонимной прецедентной базе.
- Апелляции с переворотом решения → форфейт залога (см. §6.7).
- Ratio overturn-rate в KPI; >15% → автосуспенд + расследование.

### 6.6 Залог арбитра и реестр (D16; требуется multichain/legal ADR)

Существующий Solidity `ArbitratorRegistry` остаётся Polygon-specific компонентом. Отдельно подтверждаем, нужен ли параллельный TON on-chain stake либо достаточно договорной ответственности, общего backend role registry и страхового/операционного резерва.

Если stake сохраняется, ADR фиксирует asset/network, custody, cooldown, due process, limits on slashing, compensation destination и multisig/timelock governance. Hire/promotion/capacity и performance history продолжают жить в backend как auditable operational state; перевод денег не может выполняться одиночным администратором.

### 6.7 Санкции и форфейт залога

Проценты ниже — **черновая policy matrix**, а не активная финансовая конфигурация. Она требует legal review, уведомления арбитра, доказательств, appeal/due process и per-chain implementation review.

Каждое решение арбитра обжалуемо в течение 24 часов (см. §6.2). Если апелляционный арбитр **переворачивает** решение, оригинальный получает санкцию.

| Проступок | Slash | Эффект на статус |
|---|---|---|
| 1-я отмена решения за 30 дней | -10% залога | Warning в audit log |
| 2-я отмена за 30 дней | -25% залога | PROBATION 14 дней (только до $50) |
| 3-я отмена за 90 дней | -50% залога | SUSPENDED 30 дней |
| Конфликт интересов (доказан) | -100% залога | TERMINATED + публичная запись |
| Пропуск SLA на разрешение | -5% залога (не накопительно за тот же спор) | — |
| Молчание > 72ч на принятый спор | -10% залога + reassign | — |
| Misconduct (сговор / коррупция / leak evidence) | -100% залога + бан | TERMINATED + публикация решения в прецедентной базе |

**Куда идёт slashed stake:**
- Если есть пострадавшая сторона (overturned решение, пострадавший пользователь) → 100% компенсация ему.
- Иначе → Treasury Reserve.

### 6.8 Vacation, capacity, conflict-of-interest (D17)

**Vacation (отпуск):**
- Арбитр в `/arbitrator/vacation` ставит даты начала/конца.
- Нельзя уйти, пока есть открытые споры — система предлагает «сдать» их head_arbitrator'у (тот переназначит другому свободному).
- Auto-return в ACTIVE по дате (или раньше — кнопка «Вернуться»).
- Лимит: 30 дней / календарный год. Сверх лимита — head_arbitrator approval.
- В отпуске — backend не назначает на новые споры.

**Capacity (нагрузка):**
- В `/arbitrator/capacity` арбитр ставит max active disputes (от 1 до 10, default 5).
- Когда достигнут лимит, status=CAPACITY_LIMITED, новые споры идут другим.
- Можно пометить специализацию (подкатегории сделок) — алгоритм назначения учитывает приоритетно.

**Conflict-of-interest (анти-предвзятость):**
- При назначении автоматический фильтр (см. §6.2.4): если потенциальный арбитр пересекался с любой стороной (по `userId`, IP, payout-address, telegram_id) за последние 90 дней — пропускаем.
- Если он сам взял спор и обнаруживает CoI после открытия → кнопка «Decline + reason» в `/arbitrator/dispute/:id` без штрафа.
- Если CoI вскроется позже расследованием → 100% slash залога + TERMINATED.

---

## 7. Mini App и полноценный сайт

Два клиентских входа на общем React/Vite UI Kit, общих API schemas и одинаковой финансовой модели:

- **Mini App** — Telegram-native оболочка, `initData`, MainButton/BackButton, theme params, haptics и TON Connect.
- **Website** — полноценная responsive оболочка с публичными страницами доверия/условий и авторизованной deal room; TON Connect остаётся основным wallet layer.

Парадигма сделки — **button-driven** (D12). Свободный ввод используется для описания, чата и evidence, но не для ручного конструирования платежа.

### 7.1 Пользовательские страницы
- `/` — список моих сделок (вкладки: Active / Completed / Disputed), кнопка «+ Новая сделка».
- `/deal/new` — мастер создания сделки: (1) разрешённая категория → (2) описание и сроки → (3) цена и on-chain актив → (4) fee split → (5) versioned quote с buyer total/seller net → (6) invite-ссылка.
- `/deal/:id` — страница сделки: условия, чат, статус, линк на контракт в эксплоере, кнопки действий (Confirm receipt / Cancel / Open dispute), все через MainButton/inline.
- `/dispute/:id` — flow для evidence (форма со слотами, drag-and-drop файлов) + просмотр решения.
- `/profile` — профиль, отзывы, привязанные TON-кошельки, фактически доступные payout methods, trust score и настройки.
- `/reviews` — отзывы по сделкам, оставленные/полученные.

### 7.2 Кабинет арбитра (`/arbitrator/*`) — только при роли `arbitrator`

- `/arbitrator` — **дашборд**:
  - Большой статус-toggle сверху: ACTIVE / VACATION / CAPACITY_LIMITED / PROBATION / SUSPENDED (последние два — read-only).
  - Активные споры (FIFO с дедлайнами SLA), цветовая индикация (зелёный / жёлтый / красный).
  - KPI за 30 дней: разрешено / в работе / overturn-rate / avg resolution time / accept rate.
  - Заработано (всего / за 30 дней) + pending payout.
  - Stake balance с предупреждением при < 100% (кнопка «Top up»).
- `/arbitrator/dispute/:id` — **рабочее место**:
  - Полный chat snapshot (read-only, с хэшем).
  - Evidence от обеих сторон (структурированно по слотам).
  - Кнопки «Запросить уточнение у buyer/seller» / «Decline (conflict of interest)».
  - Форма решения: два слайдера (buyer % / seller %, сумма = 100), preset-кнопки [100/0, 70/30, 50/50, 30/70, 0/100], обязательный reasoning ≥ 100 символов.
  - Pre-submit подтверждение: «Вы решаете 70/30. Это финально, обжалование 24ч. Подтвердить?».
- `/arbitrator/history` — все мои разрешённые споры (поиск, фильтр по дате/исходу/был ли overturned).
- `/arbitrator/payouts` — баланс, история выплат и direct withdrawal в поддерживаемом TON-активе.
- `/arbitrator/stake` — текущий stake / минимум / форфейт-история после утверждения D16. Top up/withdraw только через разрешённый TON flow с cooldown и отсутствием открытых споров.
- `/arbitrator/vacation` — flow отпуска:
  - Toggle «Уйти в отпуск» (disabled если есть открытые споры — показываем «Сначала разрешите N споров или передайте head_arbitrator'у»).
  - Поля: дата начала (default = сейчас), дата возврата (mandatory).
  - Counter «Использовано дней / 30 в этом году».
- `/arbitrator/capacity` — capacity & specialization:
  - Слайдер max active disputes (1-10).
  - Чекбоксы специализации (5 подкатегорий digital goods).
  - Toggle уведомлений (TG / off).
- `/arbitrator/sanctions` — read-only список моих санкций (что произошло, когда, сколько slashed, ссылка на спор).
- `/arbitrator/settings` — общие настройки профиля.

### 7.3 Админ-панель (`/admin/*`) — только при роли `admin` или `head_arbitrator`

- `/admin` — **overview**: active/funding deals, on-chain assets, user liabilities, treasury/reserve, reconciliation diff, circuit-breaker state, arbitrator queue и SLA breaches.
- `/admin/deals` — поиск/фильтр всех сделок, drill-down в любую, кнопка «Force resolve» (с обязательным reason и аудитом).
- `/admin/users` — поиск пользователей, profile, история, кнопки «Suspend / Unban / Verify», просмотр linked accounts (для CoI-анализа).
- `/admin/arbitrators` — **реестр арбитров**:
  - Таблица: `username`, `level`, `status`, `stake_balance`, `active_disputes`, `total_resolved`, `accept_rate`, `overturn_rate`, `avg_resolution_h`, `last_active_at`.
  - Фильтры по статусу и уровню.
  - Действия: `Hire` (отправить invite-link), `Suspend`/`Unsuspend`, `Terminate` (с reason), `Promote`/`Demote`, `Adjust stake` (slash или refund вручную, с audit).
- `/admin/arbitrators/:id` — **карточка арбитра**:
  - KPI-блок (7 / 30 / 90 дней): принято / разрешено / overturn-rate / avg time / жалоб.
  - История санкций (полная цепочка с reason, tx hashes).
  - Stake-leger (deposits, slashes, withdraws).
  - Все разрешённые споры с фильтром «Только overturned».
  - Conflict-of-interest log: автоматические pre-flight проверки и совпадения с участниками сделок.
- `/admin/disputes` — **глобальная очередь споров**:
  - Все споры (открытые / в работе / appealed / resolved / closed).
  - Фильтры по статусу, арбитру, длительности, стороне, сумме.
  - Действия: `Reassign` (на другого арбитра, с reason, аудит), `Force escalate` (на head_arbitrator), `Override` (head_arbitrator only — назначить решение лично).
- `/admin/moderation` — очередь жалоб (на сделку, на пользователя, на арбитра, abuse). Принять / отклонить / отложить.
- `/admin/treasury` — **финансы**:
  - Hot wallet balance / Reserve fund balance / Total slashed stakes (cumulative).
  - Pending payouts (арбитрам, продавцам после released сделок).
  - Учёт за период: `выплачено арбитрам / собрано штрафов / dotated from reserve / комиссия платформы / отчисление в Reserve`.
  - Кнопка multisig-approve withdrawal (требует 2/3).
- `/admin/audit` — лог всех админ-действий (Suspended, Terminated, Force-resolved, Stake adjusted, Override): кто, когда, кого, с каким reason. Read-only, immutable.
- `/admin/settings` — country/category/rail feature flags, versioned quote policy, лимиты и blocklist. Финансовые/контрактные изменения — только через утверждённый multisig/timelock process.

### 7.4 Общие требования к UI
- **Все действия через кнопки.** Поля ввода только там, где нужны данные (цена, описание, payout-адрес, reasoning арбитра).
- **MainButton** — primary action на странице.
- **BackButton** — нативная навигация.
- **HapticFeedback** — на success / warning / error.
- **Skeleton loaders** на всех асинхронных списках.
- **Empty states** с иконкой и CTA-кнопкой («У тебя пока нет сделок» → «+ Создать»).
- **Темизация** через `Telegram.WebApp.themeParams` (auto dark/light, Telegram-нативные цвета).
- **Унифицированные компоненты**: Button, Card, ListItem, Badge, Modal, Toast — один UI Kit.
- **Адаптивность**: 360px-мобайл — приоритет, desktop preview работает.
- **Accessibility**: aria-labels, фокус-стейты, контраст ≥ AA.

### 7.5 Интеграция с Telegram WebApp SDK
- `initData` валидация на backend (HMAC-SHA256 с bot token), age limit и one-time query replay protection.
- `MainButton.show/hide/setText/onClick` — контекстная primary action.
- `BackButton.show/hide/onClick` — навигация.
- `HapticFeedback.notificationOccurred('success'|'warning'|'error')`.
- `themeChanged` event — реактивная тема.
- `viewport` — корректная обработка resize и swipe-down.
- TON Connect + `ton_proof` — connect/restore/disconnect, wallet ownership и точный transaction request.
- Capability detection для embedded/gasless; обязательный standard TON-gas fallback.

### 7.6 Полноценный сайт

- Публичные страницы: value proposition для buyer/seller, «как работает», комиссии, безопасность без ложных гарантий, правила споров, availability по странам, ToS/Privacy/AML/prohibited items и support/status.
- Авторизованные страницы: dashboard, create/invite, deal room, wallet/payout settings, disputes, reviews и notifications.
- Admin/arbitrator workspace допускается вынести на отдельный защищённый web origin с MFA/step-up auth.
- Mobile-first и desktop layouts проектируются отдельно, а не через растягивание Mini App.
- SEO/marketing страницы не получают доступ к privileged API или wallet session без явного перехода в приложение.

---

## 8. Telegram bot (на основе Telegraf)

Парадигма — **button-driven** (D12). Только три текстовых команды, остальное — inline-кнопки.

### 8.1 Команды (deep-link fallback)
- `/start` — приветствие + большая кнопка «🚀 Открыть приложение» (открывает Mini App на главной).
- `/help` — короткое FAQ + кнопка «Открыть полный гайд».
- `/support` — кнопка «Связаться с поддержкой» (открывает чат с support-аккаунтом).

### 8.2 Inline-кнопки в нотификациях
Каждое критичное событие приходит сообщением с одной-двумя кнопками:
- **Новая invite-ссылка от партнёра** → «👀 Посмотреть сделку».
- **Сделка профинансирована** → «📂 Открыть сделку».
- **Запрос подтверждения получения** → «✅ Подтвердить» / «⚠️ Открыть спор».
- **Открыт спор по моей сделке** → «📑 Загрузить доказательства».
- **Решение арбитра** → «📜 Посмотреть решение».
- **Уведомление арбитру о новом споре** → «⚖️ Принять в работу» / «❌ Отказаться».
- **Алерт админу о SLA-breach или reconciliation diff** → «🛠 Открыть админ-панель».

### 8.3 Нет inline-режима, нет text-парсинга
Любая попытка ввести произвольный текст в чат с ботом → бот отвечает «Используй кнопки 👇» + main keyboard с двумя кнопками: «🚀 Открыть приложение» и «❓ Помощь».

---

## 9. База данных (укрупнённо)

```
users (id, telegram_id, telegram_username, role, kyc_status, country_code, ...)
wallet_bindings (id, user_id, network, chain_id, address, proof_type, proof_verified_at, revoked_at, ...)
deals (id, deal_number, type, subcategory, status, buyer_id, seller_id,
       quote_id, terms_version, terms_hash, escrow_address, fsm_state, created_at, ...)
-- subcategory ∈ {ACCOUNT, KEY_CODE, FILE, ONLINE_SERVICE, SUBSCRIPTION_TRANSFER}
deal_quotes (id, deal_id, version, asset, amount_atomic, buyer_total_atomic,
             seller_net_atomic, platform_fee_atomic, rail_fee_atomic,
             fx_rate, fx_spread, refund_atomic, expires_at, quote_hash, ...)
deal_payout_methods (deal_id, method, network, asset, address, provider_id, country_code, eligibility_snapshot, ...)
deal_messages (id, deal_id, author_id, content, content_hash, created_at)
deal_attachments (id, deal_id, message_id, s3_key, sha256, size, ...)
deal_events (id, deal_id, type, payload, created_at)  -- audit log
chain_events (id, network, event_id, action_index, tx_hash, lt, finalized_at, payload, ...)
chain_transfers (id, deal_id, direction, asset, amount_atomic, from_address, to_address,
                 inbound_tx_hash, outbound_tx_hash, status, ...)
ledger_accounts (id, owner_type, owner_id, asset, account_type, ...)
ledger_transactions (id, event_type, ref_type, ref_id, effective_at, ...)
ledger_postings (id, ledger_transaction_id, account_id, debit_atomic, credit_atomic, ...)
reconciliation_snapshots (id, asset, finalized_block, assets_atomic, liabilities_atomic,
                          delta_atomic, breaker_state, created_at, ...)
disputes (id, deal_id, opened_by, evidence_deadline, decision_deadline, status, ...)
dispute_evidence (id, dispute_id, side, content, files[], hash, submitted_at)
dispute_decisions (id, dispute_id, arbitrator_id, buyer_share_pct, seller_share_pct, reasoning, tx_hash)
dispute_appeals (id, dispute_id, requested_by, original_decision_id, new_arbitrator_id, ...)
arbitrators (id, user_id, level, status, stake_usdt, total_resolved, total_slashed_usdt,
             overturn_rate, avg_resolution_time_h, vacation_ends_at, capacity_max, ...)
arbitrator_stake_ledger (id, arbitrator_id, kind, amount, reason, dispute_id, tx_hash, created_at)
   -- kind ∈ {DEPOSIT, SLASH, WITHDRAW, REFUND}
arbitrator_sanctions (id, arbitrator_id, dispute_id, type, slash_pct, status_change, reason, created_at)
arbitrator_payouts (id, arbitrator_id, dispute_id, amount_usdt, source, tx_hash, created_at)
   -- source ∈ {GUILTY_BUYER, TREASURY_RESERVE}
treasury_ledger (id, account, kind, amount, ref_id, tx_hash, created_at)
   -- projection для отчётов; source of truth — balanced ledger_postings
reviews (id, deal_id, author_id, target_id, rating, comment, ...)
reputation_scores (user_id, score, total_deals, completed_deals, disputed_deals, trust_level)
moderation_reports (id, deal_id, reported_by, reason, status, ...)
outbox_events (id, source, payload, processed_at, attempts, last_error)  -- outbox pattern
```

Миграции — TypeORM. Все таблицы — soft delete + `created_at`/`updated_at`.

---

## 10. Безопасность и compliance

- **Секреты:** отозвать любой утёкший bot/API token, очистить history и подтвердить rotation; private keys не хранятся в env.
- **Key custody:** отдельные non-exportable production keys, private/mTLS signer, least privilege, 2/3 multisig и timelock. Emergency pause не даёт права изъять пользовательские средства.
- **Contract security:** threat model, conservation invariants, property/fuzz tests, mandatory coverage/analyzers и независимый audit + retest до любых real-money tests.
- **Financial safety:** balanced ledger для каждого движения, finalized reconciliation, circuit breaker и семь дней zero unexplained delta до beta.
- **Auth:** Telegram replay protection, короткие access tokens, rotating/revocable sessions и MFA/step-up для privileged money-moving operations.
- **Admin audit:** mutation и audit event атомарны и fail closed; ordinary role не может менять/удалять audit rows; off-site/WORM export.
- **Evidence:** private quarantine storage, magic-byte validation, AV, опасные форматы запрещены, expiring URLs, authorization и retention/deletion policy.
- **KYC/AML/sanctions:** не фиксированный глобальный порог, а правила, подтверждённые counsel/provider для каждой страны, категории, суммы и payout rail. Issuer/provider freeze risk раскрывается пользователю.
- **Запрещённые тематики:** allowlist категорий, автофильтр, ручная модерация и санкции. Запрещены как минимум оружие, наркотики, CSAM, фейковые документы и услуги обхода санкций; финальный список утверждает legal.
- **Policies:** ToS, Privacy, refund, arbitration, prohibited items, AML/KYC, vulnerability disclosure и incident communication готовы до beta.
- **Resilience:** encrypted immutable backups, isolated restore, RPC/indexer/DB/Redis failover drills, опубликованные RPO/RTO и именованные on-call owners.

---

## 11. Найм арбитров (поскольку их сейчас нет)

Это блокер для запуска даже closed beta. Предлагаю:

**Профиль кандидата (junior arbitrator):**
- Активный пользователь Telegram (≥ 2 года).
- Опыт P2P-сделок (даже на стороне) — может рассказать о случаях.
- Базовое понимание крипты (USDT, кошельки, эксплоеры).
- Русский — родной или C1.
- Способность писать структурированные решения.
- Уделяет проекту минимум 4 часа в день в течение 2 недель тестового периода.

**Где искать:**
- Закрытые TG-каналы про P2P-арбитраж и Web3.
- Outsource через Habr Freelance / Upwork.
- Реферальная программа: «приведи арбитра — $50 после прохождения испытательного».

**Тестовый процесс:**
- Кандидат разрешает 5 модельных споров (специально подготовленных кейсов).
- Сравниваем решения с эталоном.
- Если расхождение в 4 из 5 — отказ.

**Срок до first hire:** до запуска real-money closed beta; найм и модельные кейсы идут параллельно TON-разработке.

**На старте closed beta:** минимум два обученных исполнителя плюс escalation owner. Founder может быть head arbitrator, но не единственной точкой отказа. До готовности команды допускается только testnet/симуляция без пользовательских средств.

---

## 11a. Anti-scam чек (проверка аккаунтов + база скамеров)

Отдельная от эскроу-сделок функция: любой пользователь может проверить произвольный Telegram-аккаунт на скам и подать жалобу.

**Модуль:** `services/user-service/src/modules/anti-scam/` (+ хендлер `telegram-bot/telegram-anti-scam.handler.ts`).

**UX в боте (button-driven, D12):** пункт меню «🛡 Проверить пользователя» / команда `/check` → кнопка «Выбрать пользователя» (`request_users` → `users_shared`) либо ввод Telegram ID / `@username` → вердикт (чист / есть жалобы / скамер + ссылка на базу) → кнопка «🚩 Пожаловаться» (причина + **обязательные** скриншоты-доказательства).

**Модель подтверждения:**
- Число разных жалобщиков может повысить internal risk score и приоритет очереди, но **не** должно автоматически присваивать публичный статус `CONFIRMED`.
- Публикация — только после ручной проверки безопасно сохранённых evidence, reasoned moderation decision и проверки linked/duplicate complainants.
- Нужны уведомление затронутого пользователя, appeal/correction flow, журнал редакций и legal/privacy retention policy.
- При первой жалобе в чат модерации (`ANTISCAM_MODERATION_CHAT_ID`) приходит карточка решения только для подходящей роли; mutation и audit event атомарны.

**Anti-spam / дедуп:** одна жалоба на пару (жалобщик, цель); запрет одинакового текста жалобы глобально (SHA-256 `contentHash`); запрет self-report; скриншоты обязательны.

**Публикация в каналы (бот-постинг):**
- Выключена по умолчанию до legal/privacy sign-off и production evidence pipeline.
- После включения публикуется только минимально необходимая, отредактированная информация по подтверждённому решению; чувствительные evidence не становятся публичными автоматически.
- Correction/appeal должен обновлять или отзывать публикацию во всех каналах с audit trail.

**Данные (current implementation):** `scammer_records` (ключ `targetTelegramId`, статус, счётчик жалобщиков, message-id постов), `scam_reports` (жалоба, `contentHash`, `screenshotFileIds`). Telegram `file_id` без managed quarantine/scanning не проходит production evidence gate: перед использованием в решении/публикации файл должен быть безопасно получен, проверен, сохранён по утверждённой policy и связан с hash/audit metadata. Миграция `1716500000000-CreateAntiScamTables` требует расширения.

**Конфиг (env):** `ANTISCAM_DB_CHANNEL_ID/_USERNAME`, `ANTISCAM_EVIDENCE_CHANNEL_ID/_USERNAME`, `ANTISCAM_MODERATION_CHAT_ID`, `ANTISCAM_AUTO_CONFIRM_THRESHOLD`, `ANTISCAM_PUBLISH_BATCH_SIZE`, `ANTISCAM_MIN/MAX_SCREENSHOTS`, `ANTISCAM_PUBLISH_ENABLED`. Бот должен быть админом обоих каналов.

---

## 12. Дорожная карта

> **Честный статус v0.3:** значительная часть deal/chat/arbitration/admin/reputation и Polygon contract логики уже существует. Но TON сейчас является входным rail поверх Polygon, а не отдельным escrow lifecycle; fee/payout/ledger/security gaps остаются. Поэтому публичный multichain MVP нельзя считать «почти готовым, остался UI».

Подробные задачи, Definition of Done и численные gates находятся в [MULTICHAIN_PUBLIC_LAUNCH_PLAN.md](./MULTICHAIN_PUBLIC_LAUNCH_PLAN.md). Здесь фиксируется порядок фаз:

### Фаза 0 — Scope freeze и go/no-go решения

- Telegram clarification для P2P escrow цифровых товаров/услуг.
- Russia legal memo и первая country matrix.
- Unit economics, low-fee target и честная payout matrix.
- Freeze скрытого TON→Polygon settlement; network choice и channel availability становятся явными.

### Фаза 1 — Multichain specifications

- ADR нативного TON-контракта и Polygon hardening; общий `EscrowChainAdapter` contract.
- Contract/FSM invariants, canonical terms/quote schema и threat model.
- Double-entry chart of accounts, reconciliation invariant и circuit breaker.
- API contract между Mini App, website и backend.

### Фаза 2 — Два независимых testnet vertical slices

- TON Connect в Mini App и website.
- USDT-TON create → accept → fund → finalize → release/refund.
- Polygon wallet connect на website и Polygon USDT create → accept → fund → finalize → release/refund.
- Same-chain/same-asset payout; TON deal не требует EVM, Polygon deal не требует TON wallet.
- Durable on-chain IDs, cursor/backfill, ledger и reconciliation.
- Исправление текущих payload/FSM/fee inconsistencies.

### Фаза 3 — Disputes, security и operations

- TON и Polygon dispute/resolve/timeout/auto-release conformance.
- Production evidence pipeline.
- Signer, multisig/timelock, privileged auth и atomic audit.
- Monitoring, alerting, backups, restore/failover и incident runbooks.
- Независимый audit contract + backend funds flow; remediation и retest.

### Фаза 4 — Capped closed beta

- Invite-only, лимиты per-deal/user/day/total value at risk.
- Не менее 100 ограниченных сделок и не менее 20 на каждый enabled rail.
- Ноль потерь, ноль необъяснённых reconciliation deltas, все refund/recovery drills успешны.

### Фаза 5 — Public beta и постепенное расширение

- Только страны, категории и payout rails с подписанным sign-off.
- Ступенчатое повышение лимитов по safety, dispute, fraud, payout и support metrics.
- Fiat/card/SBP включается отдельно по стране, а не глобальным переключателем.

---

## 13. Что делаем прямо сейчас

1. Зафиксировать TON + Polygon scope и запрет скрытого cross-chain settlement внутри сделки.
2. Параллельно запросить Telegram clarification и заказать Russia legal memo.
3. Заполнить unit economics и утвердить тариф/минимум по измеримому low-fee target.
4. Зафиксировать MVP payout promise: direct same-chain payout для TON/Polygon; fiat только conditional.
5. Написать multichain ADR, per-chain threat models, общие contract invariants и ledger/reconciliation spec.
6. Исправить API payload mismatches и создать versioned Quote API.
7. Реализовать TON и Polygon testnet vertical slices через единый conformance suite.
8. Затем — security/operations hardening, внешний аудит и capped beta.
9. UI Mini App и сайта моделировать параллельно по стабильным interaction contracts; visual redesign не должен маскировать незавершённый money flow.

---

## 14. Открытые вопросы (зафиксировано, чтобы не забыть)

| # | Вопрос | Когда решать | Кто |
|---|--------|-------------|-----|
| Q1 | Разрешает ли Telegram заявленный neutral escrow для digital goods/services в Mini App и на каких условиях? | До freeze Mini App commerce scope | Founder + legal |
| Q2 | Разрешён ли точный TON escrow/conversion flow для пользователей в России; какое юрлицо и compliance нужны? | До любых real-money tests | Founder + fintech counsel |
| Q3 | Какие первая и резервная launch countries/categories входят в allowlist? | Фаза 0 | Founder + product + legal |
| Q4 | Индивидуальный TON-контракт на сделку или иная доказуемо изолированная модель? | До contract implementation | TON lead + security |
| Q5 | Тариф, минимум и reserve contribution по реальным unit economics | До Quote API freeze | Founder + finance/product |
| Q6 | Запускаем ли TONCOIN одновременно с USDT-TON либо после USDT vertical slice? | До Фазы 2 | Product + TON/security |
| Q7 | Какой лицензированный payout/KYC partner доступен в каждой стране? | До включения fiat/card rail | Founder + compliance |
| Q8 | Окончательная экономика арбитража, stake/slashing и компенсаций | До найма/контрактного freeze | Founder + legal + finance |
| Q9 | Подрядчик внешнего TON + Polygon + backend funds-flow аудита и bug-bounty budget | До Фазы 3 | Founder + security |
| Q10 | Production hosting, RPO/RTO, on-call и disaster-recovery owners | До closed beta | Founder + tech/ops |

---

*Конец документа.*
