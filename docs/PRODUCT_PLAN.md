# Telegram Garant — Product Plan (v0.1)

> Единый источник правды по продукту и архитектуре. Заменяет все файлы `PHASE*_COMPLETE.md`, `FINAL_STATUS.md`, `ARCHITECTURE.md`, `.qwen/PROJECT_SUMMARY.md` после согласования.
>
> Статус: **черновик на согласование**. После твоего «ок» коммитим как `docs/PRODUCT_PLAN.md` через PR и удаляем устаревшие документы.

---

## 1. Что мы делаем

**Telegram Garant** — anti-scam P2P escrow внутри Telegram. Покупатель и продавец встречаются в личной «комнате сделки», прописывают условия, общаются в чате Mini App. Деньги хранятся в индивидуальном смарт-контракте на Polygon (USDT). При споре арбитр платформы распределяет средства.

**Целевая аудитория MVP:** русскоязычные P2P-сделки на цифровые товары/доступы/услуги (аккаунты, ключи, подписки, инфопродукты, фриланс-задачи).

**Чего точно нет в MVP** (явно, чтобы не было разночтений):
- Конструктор ботов с self-host у продавца (Phase 3+).
- Cryptomus payout продавцу в фиат (Phase 2 — пока только USDT в Web3-кошелёк продавца).
- Физические товары с доставкой, аренда, сложные multi-stage сделки (Phase 2+).
- Decentralized арбитраж со стейкингом (Phase 3+).
- Внешняя проверка скам-историй (Phase 2, и только как ручная модерация).
- Реферальная программа (Phase 2).
- Поддержка нескольких сетей кроме Polygon (BSC — Phase 2, TRON/TON — позже, требует отдельной архитектуры).

---

## 2. Зафиксированные решения

| # | Решение | Значение | Обоснование |
|---|---------|----------|-------------|
| D1 | Custody | Non-custodial payout; light-custody на funding (Cryptomus relay) | Cryptomus не разрешает произвольный `to_address` в инвойсе → backend становится relay'ем. Деньги физически проходят через hot-wallet платформы между webhook и on-chain forward. Payout продавцу — прямо из эскроу в его Web3-кошелёк. |
| D2 | Сеть и токен в эскроу (MVP) | Polygon, USDT (USDT.e или native USDT — уточняем при деплое). **Валюта котировки** — на выбор продавца при создании сделки: `RUB` или `USDT`. | Эскроу всегда в USDT (нужен один токен on-chain). UI и платёж идут в выбранной валюте; курс RUB→USDT фиксируется в момент funding'а через Cryptomus rate snapshot. BSC — Phase 2. TRON/TON — позже. |
| D3 | Тип сделки (MVP) | Digital goods, 5 подкатегорий: (1) аккаунт, (2) ключ/код активации, (3) цифровой файл, (4) онлайн-услуга, (5) перенос подписки | Нет доставки, нет «оспорить качество товара», единственный critical path: «получил доступ → подтвердил». Контракт и FSM одинаковы для всех 5 — различаются только поля формы и шаблоны evidence в споре (см. §6.2). |
| D4 | Распределение комиссии | Дефолт 50/50, при создании сделки можно выбрать 100/0 (на покупателе) или 0/100 (на продавце) | Скамят чаще продавцы, безопасность нужна обеим сторонам. Перенос — только до funding'а, не во время спора. |
| D5 | Тариф комиссии | **Тарифная сетка**: при сумме сделки `< 1000 ₽` — фикс **50 ₽**; при `≥ 1000 ₽` — **5%** от суммы. Для сделок в USDT — пересчёт по курсу RUB→USDT в момент funding'а (`< $11` → ~$0.55 фикс, `≥ $11` → 5%). Распределение между сторонами по D4. | На мелких сделках процентная комиссия не покрывает себестоимость спора; фикс делает мелочёвку безубыточной. Параметризуется в `EscrowFactory` (порог + ставки). |
| D6 | Минимальная сумма | **300 ₽** или эквивалент в USDT по курсу на момент создания сделки (~$3.30). | Покрывает газ + комиссию Cryptomus + наши 50 ₽ фикс + остаётся продавцу около 220-240 ₽. |
| D7 | Арбитраж (MVP) | Централизованный пул, 1 арбитр на спор, апелляция → второй арбитр | Decentralized — Phase 3+. На старте арбитров нанимаем (см. §11). |
| D8 | Юрисдикция юрлица | TBD — блокирующий вопрос для legal-фазы перед публичным запуском | Не блокирует разработку MVP, но блокирует closed beta с реальными деньгами. |
| D9 | Контрактный паттерн | EIP-1167 minimal proxy clones + Factory с `cloneDeterministic(salt = dealId)` | Газ ~45k на клон вместо ~1M+. Адрес вычисляется заранее (CREATE2) → показываем покупателю до деплоя. |
| D10 | Auth в Mini App | Telegram WebApp `initData` HMAC-валидация на backend | Нативно для TG, без отдельного логина. |
| D11 | Стек | NestJS (модульный монолит) + PostgreSQL + Redis + BullMQ + ethers v6 + Telegraf + React/Vite | Уже есть в репо, рефакторим, не переписываем с нуля. |
| D12 | UX-парадигма | **Button-driven**: все действия через inline-кнопки в боте и кнопки в Mini App. Текстовые команды — только `/start`, `/help`, `/support` как deep-link fallback. | Снижает порог входа, исключает ошибки ввода, нативно для Telegram. |
| D13 | Дизайн-система | Единый UI Kit на основе Telegram-native palette + темизация под `Telegram.WebApp.themeParams` (auto dark/light). Skeleton loaders, плавные переходы, haptic feedback на всех мутирующих действиях, иконки на каждой кнопке. | Качество UI — приоритет, отдельный design pass в конце Горизонта 1. |
| D14 | Админ-панели | **Две панели в MVP**: (a) Arbitrator panel — кабинет арбитра; (b) Admin panel — панель founder/саппорта. Обе — отдельные секции Mini App с auth по роли. | В Горизонте 1, не Phase 2. |
| D15 | Оплата арбитра | **Штраф с виновной стороны = зарплата арбитра** (см. §6.5). Размер — 10% от суммы сделки, минимум 100 ₽, максимум 1000 ₽. Источник: эскроу-средства проигравшего. **Когда виновен продавец** — у него нет денег под нашим контролем; платформа доплачивает арбитру из своей комиссии (Treasury Reserve, 20% от каждой нормальной сделки). Невиновный **всегда** получает 100% ожидаемого. | Простая прозрачная связь «решение спора → деньги». Платформа несёт риск шортфолла, который покрывается резервом из обычных сделок. |
| D16 | Залог арбитра | **200 USDT** при найме, on-chain в `ArbitratorRegistry.sol`. Сетка форфейтов 10/25/50/100% по тяжести проступка (см. §6.7). Изъятый залог → пострадавшей стороне или в Treasury Reserve. Senior-арбитры (>50 разрешённых споров без санкций) могут работать с пониженным залогом 100 USDT. | Skin in the game без агрессивного барьера на найм. |
| D17 | Vacation & capacity | Арбитр сам управляет статусом: ACTIVE / VACATION / CAPACITY_LIMITED. Vacation — auto-resume по дате, нельзя если есть открытые споры (надо сдать head_arbitrator'у). Лимит отпуска — 30 дней / год. Capacity — max active disputes (по умолчанию 5). | Минимизирует burnout арбитров и даёт прозрачную загрузку. |

---

## 3. Поток одной сделки (happy path)

```
[1] Покупатель в боте → /new_deal
    → выбирает тип "digital goods", описывает что покупает
    → указывает цену сделки и **валюту котировки** (RUB или USDT — выбор продавца при акцепте, см. шаг [4])
    → выбирает модель распределения комиссии (50/50 / 100% buyer / 100% seller)
    → платёжная валюта на стороне Cryptomus — отдельно, выбирает покупатель на платёжной странице (RUB карта, USDT, BTC, ...)

[2] Backend генерирует invite-ссылку с deal_id
    → детерминированно вычисляет будущий адрес escrow (CREATE2)
    → сохраняет в БД (deal: status=PENDING_SELLER)

[3] Покупатель шлёт ссылку продавцу

[4] Продавец открывает ссылку → Mini App → видит условия, акцептует
    → если возражает: цикл переговоров через чат, финальный consent от обеих сторон
    → продавец указывает Polygon-адрес, куда хочет получить USDT
    → deal: status=AWAITING_FUNDING

[5] Mini App показывает покупателю кнопку "Оплатить через Cryptomus"
    → создаётся Cryptomus invoice (order_id = deal_id, amount = price + buyer_fee)
    → ссылка ведёт на платёжную страницу Cryptomus

[6] Покупатель платит в любой поддерживаемой валюте
    → Cryptomus конвертирует → шлёт USDT на статичный hot-wallet платформы

[7] Cryptomus webhook → backend (verify signature, idempotent insert в outbox)
    → BullMQ воркер берёт outbox-запись:
        a) если escrow ещё не задеплоен — Factory.deployAndFund(deal_id, ...)
        b) если задеплоен — переводит USDT в escrow + Escrow.notifyFunded()
    → deal: status=FUNDED
    → пуш обеим сторонам

[8] Mini App у обоих обновляется: "Деньги в эскроу. Линк на контракт: <polygonscan>"

[9a] Happy path:
    → продавец передаёт цифровой товар через чат сделки
    → покупатель жмёт "Подтвердить получение"
    → Escrow.release(): seller_amount → seller_wallet, fee → PlatformTreasury
    → deal: status=COMPLETED → request reviews от обеих сторон

[9b] Sad path (любая сторона жмёт "Открыть спор"):
    → deal: status=DISPUTED
    → 48h evidence period: обе стороны загружают доказательства (скриншоты, чек-логи, файлы)
    → файлы хэшируются, хэши immutable в БД; снапшот чата фиксируется (хэш-цепочка сообщений)
    → backend случайно назначает свободного арбитра (round-robin с фильтром "конфликт интересов")
    → арбитр читает чат + evidence, может задать уточняющие вопросы в "арбитражном чате"
    → 72h на решение → Escrow.resolve(buyer_share_bps, seller_share_bps)
    → если кто-то из сторон запросил апелляцию в течение 24h → новый арбитр (или панель из 3 для крупных сумм)
    → итоговое решение исполняется on-chain
    → deal: status=RESOLVED

[10] После closure (любого):
    → reviews от обеих сторон (двойная)
    → reputation update
    → решения арбитра анонимизированно публикуются в "прецедентную базу" (опционально)
```

### Граничные случаи (обязательны в MVP)

- **Cancel до funding**: любая сторона жмёт "отменить", deal: status=CANCELLED, без последствий.
- **Timeout funding**: 7 дней без оплаты → deal: status=EXPIRED.
- **Timeout seller after funding**: 14 дней без активности продавца после funding → автоматически открывается спор в пользу покупателя.
- **Partial release**: только через consent обеих сторон ИЛИ через арбитра в диспуте.
- **Webhook повторно/потерян**: outbox + idempotency keys. Watcher балансов hot-wallet'а как fallback.
- **Контракт не задеплоился**: ретраи с экспоненциальным backoff. После 5 fails — алерт + ручной forward.

---

## 4. Контракты (Polygon)

### 4.1 Список

| Контракт | Назначение | Изменяемость |
|----------|-----------|--------------|
| `EscrowImplementation.sol` | Логика одного эскроу (за которым клонится множество proxy) | Immutable, новая версия = новый адрес |
| `EscrowFactory.sol` | Деплой клонов через `Clones.cloneDeterministic`, конфиг **тарифной сетки** (порог + ставки + флэт), регистр арбитров | Owner-controlled, через TimelockController |
| `PlatformTreasury.sol` | Аккумулирует комиссии и Treasury Reserve (20% отчислений), multisig withdrawal | 2/3 multisig |
| `ArbitratorRegistry.sol` | On-chain реестр арбитров: stake, level, status, slashing (D16) | Owner-controlled через TimelockController |

### 4.2 Интерфейс EscrowImplementation

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

### 4.3 Газ-стратегия

Все вызовы (release, refund, dispute, resolve, notifyFunded) — **через relay-кошелёк платформы**. Пользователи никогда не платят газ напрямую. Газ компенсируется из комиссии. У relay'я отдельный bot-кошелёк с минимальным балансом MATIC (рефиллится из treasury).

### 4.4 Тесты и аудит

- Hardhat coverage ≥ 90% на финальных версиях контрактов (Foundry опционально).
- Slither + Mythril в CI.
- **Перед запуском с реальными деньгами** — внешний аудит (CertiK/Hacken/локальный аудитор). На MVP closed beta — собственный аудит + bug bounty.

---

## 5. Backend (NestJS)

### 5.1 Модули

```
src/modules/
├── auth/              # Telegram WebApp initData валидация, JWT для веба
├── user/              # Профили, settings, payout-адреса
├── deal/              # Сделки, FSM, чат, snapshot чата
├── arbitration/       # Споры, evidence, decisions, апелляции, назначение арбитров
├── payment/           # Cryptomus invoice, webhooks, конверсия валют
├── escrow/            # Взаимодействие с контрактами + on-chain watcher
├── ledger/            # Двойная запись: каждое движение средств логируется и сверяется с on-chain
├── notification/      # Telegram-пуши, email-fallback на критичные события
├── review/            # Двойные отзывы, репутация, trust score
├── admin/             # Internal API для арбитров и саппорта (auth по роли)
├── moderation/        # Фильтры запрещённых тематик, жалобы
└── i18n/              # ru на MVP, en/es позже
```

### 5.2 Инфраструктурные паттерны

- **Outbox pattern** для всех внешних event-ов (Cryptomus webhook, on-chain events). Webhook → INSERT в outbox → BullMQ воркер → внешний side-effect → mark processed. Гарантия at-least-once + idempotency.
- **Idempotency keys** на все мутирующие endpoint-ы.
- **Reconciliation job** каждые 5 минут: сверка `sum(funded_deals.amount) == hot_wallet.usdt_balance + sum(active_escrows.balance)`. Расхождение → алерт.
- **State machine** на сделке как явный код (XState или собственный enum-FSM с гардами), не как if/else в сервисах.

### 5.3 Что выкидываем из текущего кода

После аудита репо — много модулей либо пустых, либо с TS-ошибками, либо дублирующих:
- `services/user-service/src/modules/store/` — это что? Никак не связан с escrow. Удалить.
- `monitoring/` — пустой каркас. Удалить, заменить на Prometheus + структурный logger.
- `arbitration/` сейчас — 11 entities, но без работающего FSM. Переписать с нуля по новой модели (§6).
- Все `*.ps1`, `*.bat`, `$null`, `build_output*`, `.qwen/` — мусор.
- 8 `PHASE*_COMPLETE.md` — заменить этим документом.

---

## 6. Арбитраж — детальная спецификация

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
   - Каждый файл хэшируется (SHA-256), хэш в immutable БД. Файлы — в S3/object storage с lifecycle policy (хранение 5 лет).

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
   - На MVP при единственном/двух арбитрах — head arbitrator = ты (founder).

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

### 6.5 Экономика арбитра (D15)

**Штраф с виновной стороны = зарплата арбитра.** Прозрачная и простая связь: чьё решение принято — тот не платит штраф; чьё отклонено — платит.

**Расчёт штрафа:**
```
fine = clamp(0.10 * deal_amount_usdt, min=100₽_eq, max=1000₽_eq)
```
В пересчёте на USDT по курсу момента funding. На MVP-минимуме 300 ₽ → 100 ₽ штраф (33% от сделки) — это плата за то, что человек втянул арбитра в мелкую сделку.

**Распределение по исходу:**

| Решение арбитра | Откуда штраф | Кому штраф |
|---|---|---|
| 100% покупателю (виновен продавец) | Treasury Reserve платформы | Арбитру |
| 100% продавцу (виновен покупатель) | Из эскроу-доли покупателя | Арбитру |
| Доли (например 70/30) | Пропорционально из доли каждой стороны (30% штрафа платит покупатель, 70% — Treasury за продавца) | Арбитру |

**Treasury Reserve** — отдельный счёт платформы. Источник: 20% от каждой обычной (без споров) платформенной комиссии. Назначение: покрытие шортфолла, когда виновен продавец. По экспертной оценке индустрии: ~5-10% сделок идут в спор, из них ~40-60% решаются в пользу покупателя → резерв расходуется на ~3-6% сделок, при отчислении 20% это 4-7x запас прочности.

**Бонусы и ранги** (поверх штрафа):

| Ранг | Доступные споры | Бонус за «не оспорено в апелляции» |
|---|---|---|
| TRAINEE (первые 5 решений) | До $50 | 0% |
| JUNIOR | До $500 | +50% к штрафу из Treasury Reserve |
| SENIOR (>50 без санкций) | До $5000 + апелляции | +100% к штрафу |
| HEAD_ARBITRATOR (founder) | Любые + misconduct | Не получает прямой штраф (его комп — фикс из Treasury) |

**Защита от «продажи решения»:** так как штраф — прямой процент от сделки, теоретически арбитру выгоднее судить «в пользу той стороны, у которой больше денег вне платформы». Контрмеры:
- Доли решений (50/50 / 70/30 / 30/70) — арбитр выбирает соотношение, не «победителя», что усложняет коррупцию.
- Random round-robin назначение (нет права выбрать спор).
- Публикация решений в анонимной прецедентной базе.
- Апелляции с переворотом решения → форфейт залога (см. §6.7).
- Ratio overturn-rate в KPI; >15% → автосуспенд + расследование.

### 6.6 Залог арбитра и реестр (D16)

**Реестр в `ArbitratorRegistry.sol`:**
```solidity
struct Arbitrator {
    address wallet;             // payout address
    bytes32 telegramIdHash;     // ссылка на TG-аккаунт (для backend join)
    uint256 stake;              // текущий залог
    uint256 totalResolved;      // счётчик
    uint256 totalSlashed;       // суммарно изъято
    Level level;                // TRAINEE | JUNIOR | SENIOR | HEAD
    Status status;              // ACTIVE | VACATION | PROBATION | SUSPENDED | TERMINATED
    uint64 hiredAt;
    uint64 lastActivityAt;
    uint64 vacationEndsAt;      // 0 если не в отпуске
}
```

**Lifecycle:**
- **Hire:** head_arbitrator (или admin) приглашает кандидата → invite-link. Кандидат вносит 200 USDT через Cryptomus или Web3 → status=TRAINEE.
- **Promotion:** автоматически JUNIOR после 5 разрешённых споров без санкций; SENIOR после 50 без санкций (за последние 90 дней).
- **Top-up:** если stake < 80% от минимума → status=SUSPENDED, автоматически назначения отключены до пополнения.
- **Withdraw:** через `requestWithdraw()` + 14-дневный cooldown без открытых споров и санкций → multisig admin одобряет → on-chain transfer.

### 6.7 Санкции и форфейт залога

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

## 7. Mini App

Один SPA на React + Vite + Zustand + Telegram WebApp SDK. Парадигма — **button-driven** (D12), без свободного ввода команд.

### 7.1 Пользовательские страницы
- `/` — список моих сделок (вкладки: Active / Completed / Disputed), кнопка «+ Новая сделка».
- `/deal/new` — мастер создания сделки: (1) выбор подкатегории digital goods из 5 (аккаунт / ключ-код / файл / онлайн-услуга / перенос подписки) → (2) описание + поля под подкатегорию → (3) цена + валюта котировки (RUB / USDT) → (4) модель распределения комиссии → (5) invite-ссылка.
- `/deal/:id` — страница сделки: условия, чат, статус, линк на контракт в эксплоере, кнопки действий (Confirm receipt / Cancel / Open dispute), все через MainButton/inline.
- `/dispute/:id` — flow для evidence (форма со слотами, drag-and-drop файлов) + просмотр решения.
- `/profile` — мой профиль, отзывы на меня, payout-адрес (с QR-сканером), trust score, настройки.
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
- `/arbitrator/payouts` — баланс, история выплат, кнопка «Withdraw to Web3 wallet» (только USDT).
- `/arbitrator/stake` — текущий stake / минимум / форфейт-история (с linker'ами на споры). Кнопка «Top up» (через Cryptomus или прямой trans). Кнопка «Request withdraw» (только если ACTIVE, no open disputes, cooldown 14 дней).
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

- `/admin` — **overview**: live-метрики (active deals, deals in funding, hot-wallet balance, Treasury Reserve balance, reconciliation diff, arbitrator queue length, SLA breaches за 24ч), алерты с цветовыми бейджами.
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
- `/admin/settings` — feature flags, fee-config (тарифная сетка D5, штраф D15, минимум D6 — менять только через TimelockController), blocklist ключевых слов.

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
- `initData` валидация на backend (HMAC-SHA256 с bot token).
- `MainButton.show/hide/setText/onClick` — контекстная primary action.
- `BackButton.show/hide/onClick` — навигация.
- `HapticFeedback.notificationOccurred('success'|'warning'|'error')`.
- `themeChanged` event — реактивная тема.
- `viewport` — корректная обработка resize и swipe-down.

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
users (id, telegram_id, telegram_username, payout_address, role, kyc_status, ...)
deals (id, deal_number, type, subcategory, status, buyer_id, seller_id,
       amount_quote, quote_currency,        -- цена в выбранной валюте (RUB | USDT)
       amount_usdt, fx_rate_locked_at,      -- зафиксированный эквивалент в USDT в момент funding
       fee_model, fee_buyer_usdt, fee_seller_usdt,  -- по тарифной сетке D5 + распределение D4
       escrow_address, funding_invoice_id, fsm_state, created_at, ...)
-- subcategory ∈ {ACCOUNT, KEY_CODE, FILE, ONLINE_SERVICE, SUBSCRIPTION_TRANSFER}
-- quote_currency ∈ {RUB, USDT}; ESCROW всегда в USDT on-chain
deal_messages (id, deal_id, author_id, content, content_hash, created_at)
deal_attachments (id, deal_id, message_id, s3_key, sha256, size, ...)
deal_events (id, deal_id, type, payload, created_at)  -- audit log
ledger_entries (id, deal_id, direction, amount, source_address, dest_address, tx_hash, ...)
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
   -- account ∈ {HOT_WALLET, RESERVE, MAIN}; kind ∈ {FEE_INCOME, RESERVE_DEPOSIT, ARB_PAYOUT, COMP_PAYOUT, WITHDRAW}
reviews (id, deal_id, author_id, target_id, rating, comment, ...)
reputation_scores (user_id, score, total_deals, completed_deals, disputed_deals, trust_level)
moderation_reports (id, deal_id, reported_by, reason, status, ...)
outbox_events (id, source, payload, processed_at, attempts, last_error)  -- outbox pattern
```

Миграции — TypeORM. Все таблицы — soft delete + `created_at`/`updated_at`.

---

## 10. Безопасность и compliance

- **Утёкший Telegram bot token** в `.env.example` — отозвать через @BotFather и удалить из git history (BFG / `git filter-repo`). Это **первая задача** Горизонта 0, сделать ДО любых других PR.
- **Multisig hot wallet** (2/3) для USDT-relay. Ключи у разных людей (разные устройства).
- **KYC**: на MVP — встроенный KYC через Cryptomus (они его делают для крупных сумм). При сделках > $1000 — обязательно. Ниже — пока не требуем.
- **AML**: ручной мониторинг подозрительных паттернов (одни и те же payout-адреса, сделки между accounts с одного IP, разгон репутации) → блокировка.
- **Запрещённые тематики**: автофильтр ключевых слов + ручная модерация. Список: оружие, наркотики, любые виды CSAM, услуги политического характера, фейковые документы, услуги по обходу санкций.
- **Terms of Service** + **Privacy Policy** на старте. ToS включает arbitration clause, отказ от ответственности, юрисдикцию.
- **Аудит контрактов** перед запуском с реальными деньгами (внешний). На closed beta — собственный + bug bounty.

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

**Срок до first hire:** 2-3 недели после старта закрытой беты (или параллельно с разработкой Горизонта 1).

**На старте closed beta** (когда арбитров ещё нет) — head arbitrator = founder (ты). Объёма споров не должно быть много при ≤ 50 пользователях.

---

## 12. Дорожная карта

### Горизонт 0 — Гигиена (1 спринт = ~1 неделя)
- [ ] Отозвать утёкший TG bot token, очистить git history.
- [ ] Удалить мусор: `*.ps1`, `*.bat`, `$null`, `.qwen/`, `build_output*.txt`, `fix-errors.sh`.
- [ ] Удалить все `PHASE*_COMPLETE.md`, `FINAL_STATUS.md`, `ARCHITECTURE.md` после коммита этого документа.
- [ ] Починить TS-ошибки → `npm run build` и `npm run lint` зелёные без `--type-check false`.
- [ ] CI: GitHub Actions — build + lint + unit tests + slither (на контрактах) на каждый PR.
- [ ] `docker-compose.yml` поднимает весь стек (postgres + redis + user-service + mini-app + Hardhat node).

### Горизонт 1 — MVP (5-6 спринтов = ~6-8 недель)

**Spr 1: Контракты + базовая инфра**
- `EscrowImplementation`, `EscrowFactory`, `PlatformTreasury`, `ArbitratorRegistry` + 90% test coverage.
- Deploy на Polygon Amoy (testnet).
- Backend `escrow/` модуль: relay-вызовы, watcher событий.

**Spr 2: Сделка end-to-end (без оплаты)**
- FSM сделки.
- API: create deal, invite, accept, cancel.
- Mini App: страницы создания сделки и просмотра.
- Telegram bot: команды `/start`, `/new_deal`, deep-links.

**Spr 3: Оплата + funding**
- Cryptomus интеграция: создание инвойса, webhook handler, outbox.
- Backend forward USDT в эскроу.
- Reconciliation job.

**Spr 4: Чат + release happy path**
- Mini App чат сделки.
- Кнопки release / cancel / dispute.
- Уведомления в Telegram.

**Spr 5: Арбитраж**
- FSM спора.
- Evidence collection.
- Назначение арбитров.
- Кабинет арбитра.
- Resolve on-chain.

**Spr 6: Admin & Arbitrator panels (MVP-обязательные)**
- `/admin/*` страницы: overview, deals, users, arbitrators, moderation, treasury, disputes, settings.
- `/arbitrator/*` страницы: dashboard, dispute workspace, history, payouts.
- Auth по ролям, аудит-лог всех админ-действий.

**Spr 7: Reviews + reputation + Design pass + closed beta**
- Двойные отзывы, trust score, влияние на лимиты.
- **Design pass**: единый UI Kit, skeleton loaders, empty states, HapticFeedback, плавные переходы, прохождение по всем страницам с дизайнером (если есть) или с UI-чек-листом (см. §7.4).
- Внутренний аудит контрактов + deploy на Polygon mainnet.
- Закрытая бета на 20-50 пользователей.

### Горизонт 2 — Развитие (после MVP)
- BSC support.
- Cryptomus payout продавцу в фиат (custody-light с признанием).
- Физические товары / услуги с доставкой / аренда.
- Реферальная программа.
- Внешний аудит контрактов.
- Расширение admin/arbitrator панелей (advanced analytics, batch actions, экспорт отчётов).
- Mini App на en/es.

### Горизонт 3 — Масштаб
- Конструктор ботов (отдельный продукт).
- Decentralized арбитраж (а-ля Kleros).
- TON / TRON support.
- KYC через сторонних провайдеров (Sumsub).

---

## 13. Что делаем прямо сейчас

После твоего «ок» по этому документу:

1. Создаю PR с этим файлом как `docs/PRODUCT_PLAN.md`.
2. **Не удаляю** PHASE-файлы в этом PR — они уйдут в Горизонте 0 (отдельный PR).
3. Жду твоего апрува PR'а с планом.
4. Затем — отдельный PR на Горизонт 0 (чистка + фикс TS-ошибок + CI).
5. Дальше — по тикетам.

---

## 14. Открытые вопросы (зафиксировано, чтобы не забыть)

| # | Вопрос | Когда решать | Кто |
|---|--------|-------------|-----|
| Q1 | Юрисдикция юрлица | До closed beta с реальными деньгами | Founder + юрист |
| Q2 | KYC-процесс при сделках > $1000 | До mainnet deploy | Founder |
| Q3 | Внешний аудит контрактов: какой подрядчик | До mainnet deploy | Founder |
| Q4 | Размер security budget на bug bounty | После closed beta | Founder |
| Q5 | Найм первых арбитров | Параллельно Горизонту 1 | Founder |
| Q6 | Точные ставки оплаты арбитров (черновик в §6.5) | До hire | Founder |
| Q7 | Hosting платформы (Railway есть в репо, но это prod-grade?) | До закрытой беты | Founder + tech |

---

*Конец документа.*
