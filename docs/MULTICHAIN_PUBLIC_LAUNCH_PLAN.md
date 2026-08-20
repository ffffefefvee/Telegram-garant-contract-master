# TON-focused multichain plan до публичного запуска

Дата: 2026-08-15

Статус: рабочий план реализации; дополняет `PRODUCT_PLAN.md`. Code-level структура: [MULTICHAIN_IMPLEMENTATION_SPEC.md](./MULTICHAIN_IMPLEMENTATION_SPEC.md). Численные targets являются предложением до явного product sign-off

Приоритет: сохранность средств и корректность расчётов выше скорости запуска

## 0. Внешние ограничения, на которых основан план

Состояние источников проверено 2026-08-15; перед релизом их нужно проверить повторно.

- [Telegram Bot Developer Terms, §7](https://telegram.org/tos/bot-developers?setln=en) требуют, чтобы crypto functionality Mini App была основана на TON, а wallet interaction использовал TON Connect. Поэтому Mini App исполняет TON-сделки; Polygon остаётся first-class settlement на полноценном сайте. Любое иное отображение/перенаправление из Mini App требует письменного Telegram approval.
- [Telegram Stars rules for digital goods/services](https://core.telegram.org/bots/payments-stars) отдельно требуют Stars для определённых продаж внутри bots/Mini Apps. Неясность применимости к neutral P2P escrow — внешний go/no-go вопрос, а не инженерное предположение.
- [TON Connect embedded requests](https://docs.ton.org/applications/ton-connect/how-to/embedded-request) позволяют приблизиться к connect-and-act UX; [gasless guidance](https://docs.ton.org/applications/ton-connect/how-to/sign-message-gasless) показывает, почему capability detection и обычный fallback всё равно обязательны.
- [TON jetton payment guidance](https://docs.ton.org/applications/payments/jettons) требует не доверять отображаемым metadata токена и проверять master/jetton-wallet/message данные.
- Доступность card/off-ramp зависит от страны и провайдера. Например, [MoonPay указывает Россию среди неподдерживаемых стран](https://support.moonpay.com/en/articles/380968-moonpay-s-unsupported-countries), а [Wallet P2P rules](https://help.wallet.tg/article/21-p2p-market-rules) описывают пользовательский KYC/name-matched P2P flow, а не автоматическую выплату платформы.
- Точный российский escrow/settlement flow требует внешнего заключения с учётом [259-ФЗ](https://publication.pravo.gov.ru/Document/View/0001202007310056) и актуальных разъяснений, включая [материалы Банка России о стейблкоинах](https://www.cbr.ru/Content/Document/File/193894/Consultation_Paper_25062026_52.pdf).

## 1. Как выглядит итоговый продукт

Telegram Garant — сервис защищённых P2P-сделок с единым ядром для Telegram Mini App и полноценного сайта.

Покупатель получает:

- зафиксированные до оплаты условия;
- понятную итоговую сумму без скрытых комиссий;
- перевод средств непосредственно в TON-эскроу;
- возврат или арбитраж по опубликованным правилам;
- доказуемый on-chain статус сделки.

Продавец получает:

- подтверждение, что средства уже заблокированы в эскроу;
- защиту от бездействия покупателя через auto-release либо гарантированный спор по SLA;
- заранее показанную чистую сумму к получению;
- прямую выплату в кошелёк выбранной сети в активе сделки;
- дополнительные способы вывода только там, где они реально доступны через лицензированного партнёра.

Платформа получает:

- прозрачную комиссию, покрывающую инфраструктуру, поддержку, риск и арбитраж;
- управляемый риск благодаря лимитам, резерву, учёту и автоматическим стоп-механизмам;
- продукт, где TON-пользователь не обязан иметь EVM-кошелёк, а Polygon-пользователь не обязан иметь TON-кошелёк.

### Продуктовые принципы, которые нельзя размывать

1. **Выгода для обеих сторон.** Комиссия и ограничения оправданы только реальным снижением риска и удобством сделки.
2. **TON-focused, Polygon retained.** TON — основной Telegram-путь; Polygon — равноправный выбор на сайте. Стороны выбирают сеть сами до funding.
3. **Два действия для оплаты.** Для пользователя с уже подключённым совместимым кошельком нормальный путь: «Оплатить» → подтверждение в кошельке. Ручной ввод адреса, memo, сети и суммы не допускается.
4. **Одинаковая финансовая правда во всех слоях.** Один расчёт должен определять сумму в UI, инвойсе, БД, ledger и контракте.
5. **Никаких недоказуемых обещаний.** Нельзя обещать «на любую карту», «в любой стране», «без KYC», «абсолютно безопасно» или «всегда два клика».
6. **Безопасность — набор pass/fail-гейтов.** Публичный запуск запрещён, пока не выполнены измеримые условия этого документа.

### Как пользователь выбирает сеть

| Кому обычно полезнее | TON | Polygon |
|---|---|---|
| Telegram/CIS-oriented пользователь | Нативный Mini App и TON Connect; не нужен EVM-кошелёк | Доступен через полноценный сайт |
| Пользователь с EVM-кошельком и Polygon USDT | Не обязан заводить TON-кошелёк, если выбирает Polygon | Сохраняет привычный EVM wallet и Polygon ecosystem |
| Оплата и выплата | TON asset остаётся в TON | Polygon asset остаётся в Polygon |
| Комиссия и скорость | Показываются по актуальному chain-specific quote | Показываются по актуальному chain-specific quote |
| Ограничение | Wallet/capability/provider availability | Telegram Mini App policy; EVM network/token correctness |

Платформа не утверждает, что одна сеть всегда дешевле или быстрее. Перед подтверждением обе стороны видят актуальные buyer total, seller net, network fee estimate, ожидаемую finality, wallet requirement и payout result. Выбор становится окончательным после funding.

## 2. Границы MVP

### Обязательно в MVP

- Telegram Mini App и полноценный адаптивный сайт на одном backend/API.
- Авторизация Mini App через Telegram `initData`; владение TON-кошельком через TON Connect/`ton_proof`.
- Нативный TON-эскроу и сохранённый/hardened Polygon-эскроу за независимыми adapters.
- TON: USDT-TON как основной актив, TON после отдельного lifecycle test. Polygon: allowlisted USDT deployment.
- Создание, приглашение, принятие и неизменяемый снимок условий сделки.
- Обязательный выбор `network + chainId + asset` до funding и согласие обеих сторон.
- Прямая оплата из кошелька выбранной сети в её escrow без скрытого cross-chain float в основном пути.
- Release, voluntary refund, dispute, resolution и безопасный timeout/auto-release.
- Прямая same-chain/same-asset выплата продавцу.
- Централизованный арбитраж, evidence, апелляция, журнал решений и операционный SLA.
- Полный двойной финансовый учёт, on-chain reconciliation и автоматический circuit breaker.
- Country allowlist, KYC/AML/sanctions controls в соответствии с моделью и страной запуска.
- Админ- и арбитражная панели с минимально необходимыми правами и неизменяемым аудитом действий.

### Условно, только после внешнего подтверждения

- Сделки с цифровыми товарами/услугами внутри Mini App — только после письменного подтверждения допустимой модели по правилам Telegram. Если модель не разрешена, соответствующий поток выносится на сайт либо адаптируется к разрешённой платёжной модели.
- Автоматическая выплата на карту/SBP — только после договора с лицензированным партнёром, legal sign-off и успешных E2E/refund-тестов для конкретной страны.
- Gasless USDT — только для кошельков с нужной capability и при наличии обычного TON-gas fallback.
- Конвертация в другой актив — только как отдельная котируемая операция партнёра с показом курса, spread, комиссии, срока и ответственности за сбой.

### Не обещаем в MVP

- выплату «на любую карту в любой стране»;
- внутренний автоматический crypto-to-fiat обмен силами платформы без нужной лицензии/партнёра;
- поддержку BSC/TRON и cross-chain settlement внутри одной сделки;
- гарантированное отсутствие уязвимостей;
- мгновенную выплату при недоступности сети, кошелька или внешнего провайдера.

## 3. Что в текущей реализации не соответствует целевой модели

| ID | Разрыв | Что требуется |
|---|---|---|
| G1 | TON сейчас является входным rail, а эскроу и release остаются на Polygon | Разделить на два настоящих lifecycle: native TON и retained Polygon; убрать скрытый TON→Polygon float |
| G2 | Платёж требует адрес/memo либо внешний deep link, TON Connect в Mini App отсутствует | Реализовать TON Connect, embedded request, восстановление сессии и capability fallback |
| G3 | Тариф 50 ₽ на минимальной сделке 300 ₽ даёт 16,7%; выше порога — 5% | Построить unit economics и новую низкую all-in сетку |
| G4 | Выбор продавцом USDT/BTC/ETH/RUB визуальный; фактический payout сейчас Polygon USDT | Хранить chain-specific payout method; гарантировать same-chain/same-asset payout |
| G5 | Fee model расходится между UI, backend, invoice и контрактом | Единый versioned Quote API и контрактный commitment на quote/terms |
| G6 | Ledger пишет не все движения, reconciliation не доказывает assets = liabilities | Полный double-entry ledger, finalized snapshot, circuit breaker |
| G7 | TON lifecycle имеет незакрытые completion/refund/tx-id и ingestion gaps | Исправить FSM, on-chain refund, durable IDs, cursor/backfill и независимую проверку |
| G8 | Production signer/governance и внешний аудит не прошли приёмку | Non-exportable keys, multisig/timelock, acceptance report и независимый audit |
| G9 | Evidence-файлы не имеют production storage/scanning | Private quarantine storage, AV, authorization, retention и immutable deadline |
| G10 | Legal/Telegram scope и страны запуска не подтверждены | Письменное решение Telegram и legal memo по каждой разрешённой стране |
| G11 | Auto-confirm не обеспечивает продавцу исполнение при бездействии покупателя | Реальный on-chain auto-release либо гарантированная эскалация в спор по SLA |
| G12 | UI/API payloads расходятся для subcategory, fee payer и RUB payment | Исправить API contract и добавить consumer/contract tests до UI redesign |

## 4. Целевая multichain-архитектура

### 4.1 Поток средств

1. Стороны согласуют цену, **network**, chain id, asset, комиссию, payout method, сроки и правила спора.
2. Backend формирует versioned quote и canonical terms hash; обе стороны подтверждают одну версию.
3. Выбранный adapter создаёт или детерминированно вычисляет escrow в этой сети.
4. TON Connect либо EVM connector формирует транзакцию с точными chain/asset/amount/destination.
5. Покупатель подтверждает её в кошельке; приложение не получает private key.
6. Backend индексирует finalized on-chain событие, проверяет токен и сумму, делает balanced postings и переводит сделку в `FUNDED`.
7. Release/refund/resolve выполняются контрактом; backend индексирует результат и сверяет выплату с обязательством.

Основной путь не должен принимать TON и затем покрывать сделку из Polygon float или наоборот. Cross-chain conversion возможен только как отдельная явно котируемая операция вне escrow lifecycle.

### 4.2 Контрактная модель

Базовое предложение — изолированный контракт на сделку либо эквивалентная модель с доказуемой изоляцией балансов. TON и Polygon имеют отдельные ADR/deployments, но должны пройти общий conformance suite.

Обязательные свойства:

- стороны, актив, сумма, fee split, сроки и hash условий фиксируются до funding;
- состояния и переходы однозначны; повторный вызов не создаёт повторную выплату;
- сохранение средств проверяется property/fuzz тестами для каждого перехода;
- release доступен по валидному согласию покупателя или timeout-правилу;
- refund доступен по согласованному правилу, а dispute замораживает автоматическое исполнение;
- resolve не может распределить больше баланса контракта;
- администратор не может произвольно перенаправить средства;
- upgrades/config changes защищены multisig и timelock; emergency pause не разрешает изъятие денег;
- recovery-путь документирован для каждого terminal и stuck state.

### 4.3 TON implementation

- Allowlist только официального jetton master из актуальной официальной конфигурации.
- Адрес jetton wallet получателя выводится и проверяется из allowlisted master, а не доверяется metadata токена.
- Проверяются `transfer_notification`, amount, sender, invoice/deal id и отсутствие повторного credit.
- Credit только после принятой командой политики finality.
- Fake jetton с похожими названием/тикером/иконкой никогда не считается оплатой.

### 4.4 TON Connect UX

- Повторный пользователь: «Оплатить» → подтверждение в кошельке.
- Новый пользователь может иметь отдельный шаг подключения; это честно отражается в аналитике и текстах.
- Embedded connect-and-act применяется только для совместимых кошельков.
- Gasless используется после capability detection; при любой ошибке доступен обычный путь с TON для газа.
- TON flow не требует MetaMask/EVM address, ручного memo или ручного ввода суммы.

### 4.5 Polygon implementation

- Существующие `EscrowImplementation`/`EscrowFactory` сохраняются после hardening, audit и verified deployment.
- `chainId` и allowlisted USDT contract входят в quote/terms; frontend запрещает funding на другой сети или другим токеном.
- Website использует EIP-1193/WalletConnect-compatible connector; Mini App не инициирует Polygon wallet/transactions без письменного Telegram approval.
- Funding/release/refund/resolve подтверждаются по Polygon finality policy и индексируются независимо от TON.
- Polygon treasury, signer, RPC failover, reconciliation и emergency controls имеют отдельные balances/limits.

### 4.6 Общий adapter contract

Backend использует общий интерфейс для `prepareEscrow`, `buildFundingRequest`, `verifyFunding`, `release`, `refund`, `resolve`, `readBalance` и `reconcile`, но adapter обязан возвращать нормализованные chain transaction references и никогда не конвертирует актив скрыто.

## 5. Комиссии и взаимная выгода

### 5.1 Сначала — unit economics

До фиксации тарифа собрать модель по диапазонам суммы и каждому rail:

- TON gas и возможный relayer;
- provider/RPC/indexer;
- FX и rebalancing, если они есть;
- KYC/AML/sanctions screening;
- support и ожидаемая стоимость спора;
- reserve/insurance contribution;
- payout/off-ramp fee;
- chargeback/fraud loss там, где появляется фиат.

### 5.2 Launch target

- All-in cost не выше **3% для не менее 90% целевого объёма сделок**.
- Исключения для очень маленьких сумм показываются до создания сделки; минимальная сумма выводится из unit economics, а не наследуется как 300 ₽.
- Contribution margin платформы неотрицателен в каждом включённом ticket band.
- Один versioned quote содержит: buyer total, seller net, platform fee, network/rail fee, FX/spread, refund amount, expiry и payout SLA.
- Quote используется без повторного независимого расчёта в UI, API, payment request, ledger и контракте.
- Допустимое расхождение между показанным и исполненным — ноль, кроме заранее определённого округления минимальной единицы.

Точный platform fee не считается подтверждённым, пока модель не заполнена реальными котировками и beta-данными. Старые 50 ₽/5% выводятся из целевой спецификации.

## 6. Выплаты продавцу

### Гарантируемый MVP-путь

- USDT-TON сделка → USDT-TON на TON-кошелёк продавца.
- TON сделка → TON на TON-кошелёк продавца.
- Payout asset и адрес подтверждаются до funding и входят в terms hash.
- После release crypto payout P95 — до 2 минут при нормальной работе TON; исключения получают понятный статус и recovery SLA.

### Card/SBP/fiat

Это отдельный регулируемый rail, а не часть смарт-контракта. Для каждой страны нужны:

1. договор и production API лицензированного партнёра;
2. legal/compliance sign-off конкретного buyer/seller flow;
3. KYC и name matching;
4. quote с курсом, spread, fee, expiry и expected net;
5. idempotent payout, webhook verification, retry, refund/recovery и support ownership;
6. successful/failed/reversed E2E tests;
7. feature flag и country/user eligibility check.

До выполнения этих условий интерфейс показывает direct on-chain withdrawal и может дать нейтральную ссылку на внешний пользовательский P2P/off-ramp. Платформа не называет такой внешний шаг автоматической выплатой и не гарантирует его доступность.

## 7. Финансовая корректность и backend

### Обязательные изменения

- Один idempotent payment/deal FSM для create, awaiting, detected, finalized, funded, released, refunded, disputed, resolved и failed/recovery states.
- Durable inbound/outbound TON transaction IDs и причинная связь с deal/payment/ledger entries.
- Cursor-based ingestion, backfill и защита уникальностью `(event_id, action_index)`.
- Два независимых источника TON-данных для сверки критических событий либо документированный degraded mode без автоматического credit.
- Double-entry postings для receipt, escrow liability, funding, release, refund, fee, reserve, arbitrator payout, conversion и deferred payout.
- Finalized snapshot reconciliation: активы по адресам/контрактам сопоставляются со всеми пользовательскими и платформенными обязательствами.
- Любое необъяснённое расхождение выше минимальной единицы включает circuit breaker: запрет новых funding requests и автоматического egress, alert и dual-authorized recovery.
- Mutation и security audit event фиксируются атомарно; ошибка audit write откатывает действие.
- API schema является versioned контрактом; Mini App и website проверяются consumer tests.

### Финансовый gate

В staging должно быть семь непрерывных дней с нулевым необъяснённым reconciliation delta. Искусственно внесённое расхождение в одну минимальную единицу обязано включить circuit breaker и alert.

## 8. Security workstream

### До внешнего аудита

- Threat model: contracts, TON messages/jettons, wallet connection, backend, indexers, admin, arbitration, evidence, fiat partners и insider risk.
- Инварианты и property/fuzz tests на сохранение средств, idempotency, deadlines, splits и replay.
- Mandatory CI: build, typecheck, lint, unit/integration/contract tests, coverage gate, SAST и contract analyzers.
- Replay protection для Telegram `initData`/query id; короткие access tokens; rotation/revocation; step-up/MFA для privileged money-moving actions.
- Отдельные non-exportable production keys; signer в private network/mTLS; никаких relay private keys в env.
- 2/3 multisig и timelock для governance/config; documented emergency roles и least privilege.
- Private evidence storage: quarantine, magic-byte validation, запрет опасных форматов, AV, SHA-256 после scan, expiring URLs, authorization и retention/deletion.
- Immutable/tamper-evident admin audit с off-site/WORM export.
- Encrypted backups и проверенный isolated restore; RPC/indexer/Redis/DB outage и failover drills.

### Внешняя проверка

- Независимый аудит TON-контрактов и backend payment/ledger flow.
- Ноль нерешённых Critical/High findings.
- Исправления повторно проверены аудитором.
- Публичный security contact и управляемый bug bounty до расширения лимитов.

Ни один документ со статусом «implemented» не заменяет test report, audit report, deployment manifest и подписанный go/no-go checklist.

## 9. Legal, Telegram и market gates

### Gate L0 — Telegram

Получить письменную позицию по тому, допустим ли neutral P2P escrow для заявленных цифровых товаров/услуг внутри Mini App и какая платёжная модель обязательна. До ответа не замораживать Mini App commerce scope и не принимать реальные деньги.

### Gate L1 — Россия

Российский fintech/crypto counsel должен письменно оценить точный поток:

`buyer → TON escrow → seller`

и, отдельно:

`buyer → TON escrow → licensed conversion partner → seller fiat`.

Заключение должно определить допустимые категории сделок, тип юрлица, договорную модель, custody/VASP/payment exposure, KYC/AML, sanctions и reporting. Команда разработки не подменяет это юридическим выводом.

### Gate L2 — страны

«СНГ» не является одной launch jurisdiction. Для каждой страны создаётся карточка:

- разрешённые категории и активы;
- кто может пользоваться;
- KYC threshold/process;
- доступные payout methods;
- провайдер и лицензия;
- sanctions restrictions;
- Terms/Privacy/refund/dispute texts;
- support и regulator contact requirements.

Production открывается только по allowlist стран с подписанным sign-off.

## 10. Operations и арбитраж

- Утвердить evidence standard по каждой категории до её включения.
- Нанять и обучить минимум двух арбитров плюс escalation owner; founder не должен быть единственной точкой отказа публичного продукта.
- Провести модельные споры, appeal, timeout, conflict-of-interest и emergency drills.
- Опубликовать сроки funding detection, delivery, evidence, decision, appeal, release/refund и support response.
- Создать 24/7 alert routing для fund-safety событий и именованных on-call owners.
- Подготовить runbooks для stuck payment, wrong/fake jetton, duplicate event, under/overpayment, failed release/refund, compromised key, reconciliation mismatch и provider outage.
- Установить per-deal, per-user, daily и total-value-at-risk caps; повышение лимитов — только по данным.

## 11. UI workstream, который проектируем отдельно

До визуального redesign нужно зафиксировать interaction contract для обоих клиентов:

1. onboarding и wallet connect;
2. create/invite/accept и взаимное подтверждение terms;
3. fee/quote disclosure;
4. двухшаговый funding;
5. funded proof и delivery chat;
6. release/refund/timeout;
7. dispute/evidence/appeal;
8. seller payout status/recovery;
9. admin/arbitrator emergency states;
10. country/KYC/rail unavailable states.

Mini App и website используют общую design system, общие API schemas и одинаковую финансовую терминологию. Различаются оболочка, навигация и возможности Telegram, но не правила сделки.

## 12. План исполнения и гейты

### Этап 0 — Freeze и внешние решения

- Зафиксировать TON + Polygon scope, channel availability и запрет скрытого cross-chain settlement.
- Получить Telegram response и legal memo по первой стране.
- Выбрать первоначальный country/category allowlist.
- Заполнить unit economics и payout matrix.

**Exit:** Gate L0/L1 пройден либо зафиксирован изменённый scope; тарифная цель и юридическая модель утверждены.

### Этап 1 — Multichain architecture и specifications

- ADR по TON-контракту, Polygon hardening, adapters и governance.
- Contract state machine, terms/quote schema и threat model.
- Ledger chart of accounts и reconciliation invariant.
- Payout/provider interfaces и failure matrix.

**Exit:** design review от product, TON/Polygon engineering, backend, security и compliance; adapter interface и тестовые инварианты написаны до реализации.

### Этап 2 — Два testnet vertical slices

- TON Connect в Mini App и website.
- USDT-TON create → accept → fund → detect/finalize → release/refund.
- EVM connector на website и Polygon USDT create → accept → fund → detect/finalize → release/refund.
- Direct same-chain receipt: TON flow без EVM, Polygon flow без TON wallet.
- Ledger и reconciliation для полного happy/sad path.
- Исправление API payload mismatches и contract tests.

**Exit:** TON-only user и Polygon-only user независимо проходят E2E; выбранная сеть неизменяема после funding; zero manual destination/amount entry; duplicate/restart/reorder tests зелёные.

### Этап 3 — Disputes, hardening и operations

- On-chain dispute/resolve/timeout.
- Evidence pipeline.
- Admin/arbitration RBAC, atomic audit, signer, multisig/timelock.
- Monitoring, circuit breakers, backup/failover и runbooks.
- Внешний audit и remediation.

**Exit:** ноль Critical/High; семь дней zero reconciliation delta; все recovery drills пройдены.

### Этап 4 — Capped closed beta

- Invite-only.
- Не менее 100 сделок с ограниченной суммой.
- Не менее 20 сделок на каждый включённый asset/rail.
- Обязательные сценарии release, voluntary refund, timeout, dispute, appeal и provider/indexer outage.

**Exit:** ноль потерь средств, ноль необъяснённых балансов, 100% recovery/refund drills, fee quote mismatch = 0, SLA и support capacity подтверждены.

### Этап 5 — Public beta, затем scale

- Открыть только утверждённые страны/категории/rails.
- Сохранить лимиты и автоматические stop conditions.
- Повышать лимиты ступенчато по reconciliation, dispute, fraud, payout и support metrics.
- Card/SBP добавлять отдельно по стране после собственного go/no-go.

## 13. Измеримые release gates

| Область | Условие GO |
|---|---|
| Policy/legal | Письменные Telegram и country legal decisions для фактического scope |
| Network independence | TON deal не требует EVM; Polygon deal не требует TON wallet; скрытых bridge/float нет |
| Channel policy | Mini App исполняет TON; Polygon wallet/transactions доступны на website, пока Telegram письменно не разрешит иное |
| Funding UX | После сохранённой wallet session не более двух намеренных действий |
| Funding reliability | P95 detection/finality ≤ 120 секунд; zero duplicate credits |
| Seller payout | Same-chain/same-asset crypto payout в опубликованном per-chain SLA |
| Fee truth | Buyer total/seller net совпадают в UI, request, ledger и contract; mismatch = 0 |
| Low fees | All-in ≤ 3% минимум для 90% целевого объёма; исключения явно показаны |
| Accounting | 7 дней zero unexplained reconciliation delta; injected mismatch включает stop |
| Contract security | TON и Polygon отдельно имеют ноль unresolved Critical/High; общий conformance suite проходит |
| Operational security | Signer, multisig/timelock, restore/failover и alert drills подтверждены отчётами |
| Evidence | Malware/auth/immutability tests проходят; unsafe upload не становится evidence |
| Beta | ≥100 capped deals, ≥20 на rail, zero fund loss, 100% recovery drills |
| Claims | UI не показывает недоступный пользователю payout method и не обещает «any card» |

## 14. Следующие задачи в порядке выполнения

1. Founder/Product: подтвердить TON + Polygon scope и channel boundary.
2. Legal: получить Telegram clarification и заказать Russia flow memo; выбрать следующую страну только после первой матрицы.
3. Product/Finance: заполнить unit economics по ticket bands и предложить тариф, удовлетворяющий launch target.
4. Product/Compliance: зафиксировать payout matrix: TON direct + Polygon direct; fiat — conditional.
5. TON/Polygon/Security: написать adapter ADR, per-chain contract invariants, threat models и governance model.
6. Backend/Finance: спроектировать chart of accounts, postings и reconciliation/circuit-breaker spec.
7. Frontend/Backend: зафиксировать versioned API schemas и исправить существующие create/payment payload mismatches.
8. Chain/Frontend: собрать два testnet vertical slices — TON Connect и Polygon EVM connector.
9. Security/Ops: signer, keys, evidence, atomic audit, monitoring, restore/failover и runbooks.
10. External auditor: аудит, remediation и retest до реальных денег.
11. Operations: набрать/обучить арбитров, провести dispute и incident drills.
12. Product/UI: совместно спроектировать Mini App и website на уже стабильных interaction contracts.
13. Release owner: запустить capped closed beta и подписать каждый GO gate доказательствами.

## 15. Definition of Done публичного MVP

Публичный MVP готов не тогда, когда закончены Mini App и сайт, а когда одновременно:

- TON и Polygon являются независимыми полными escrow lifecycles, а не rail/settlement гибридом;
- покупатель и продавец получают заявленную защиту и понятную выгоду;
- комиссия доказуемо низкая и единообразно рассчитана;
- продавец получает реально выбранный и доступный способ выплаты;
- policy/legal scope разрешён для каждой включённой страны и категории;
- учёт доказывает сохранность средств и автоматически останавливает систему при расхождении;
- внешний аудит и закрытая бета подтверждают безопасность и recovery;
- Mini App и website прошли UX, accessibility, E2E и operational acceptance.
