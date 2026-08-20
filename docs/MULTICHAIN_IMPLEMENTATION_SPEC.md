# Multichain implementation specification

Дата: 2026-08-15

Статус: code-ready техническая декомпозиция; product direction согласован, численные fee/SLA требуют отдельного sign-off

Сети MVP: TON + Polygon

## 1. Главный инвариант

Каждая новая сделка имеет ровно одну settlement network и один asset:

```text
network + chainId + assetId + tokenAddress/master
```

Обе стороны подтверждают эти поля как часть versioned terms до funding. После первого finalized funding они immutable.

- TON funding → TON escrow → TON release/refund/resolve → TON seller wallet.
- Polygon funding → Polygon escrow → Polygon release/refund/resolve → Polygon seller wallet.
- Скрытый TON→Polygon или Polygon→TON bridge/float запрещён в target architecture.
- Conversion/off-ramp — отдельная операция с отдельным quote, consent, ledger и provider responsibility.

## 2. Channel availability

| Channel | TON | Polygon |
|---|---|---|
| Telegram Mini App | Да, TON Connect | Нет по умолчанию; только после письменного Telegram approval |
| Website | Да, TON Connect | Да, EIP-1193/WalletConnect-compatible connector |
| Admin/arbitrator web | Chain-aware read/execute по RBAC и step-up auth | Chain-aware read/execute по RBAC и step-up auth |

Network availability вычисляет backend. Frontend не hardcode'ит разрешённые сети и не показывает недоступный rail.

## 3. Domain model

### 3.1 Новые типы

```ts
export enum SettlementNetwork {
  TON = 'ton',
  POLYGON = 'polygon',
}

export enum SettlementAsset {
  TON_USDT = 'ton_usdt',
  TON_NATIVE = 'ton_native',
  POLYGON_USDT = 'polygon_usdt',
}

export enum ClientChannel {
  TELEGRAM_MINI_APP = 'telegram_mini_app',
  WEB = 'web',
  ADMIN_WEB = 'admin_web',
}

export enum SettlementMode {
  NATIVE = 'native',
  LEGACY_TON_TO_POLYGON = 'legacy_ton_to_polygon',
}
```

`SettlementMode.LEGACY_TON_TO_POLYGON` допускается только для существующих исторических записей. Создание новых сделок в этом режиме блокируется feature gate.

### 3.2 Поля сделки

Core financial fields нельзя хранить только в `metadata`.

```text
deals.settlement_network       TON | POLYGON
deals.settlement_chain_id      string
deals.settlement_asset         TON_USDT | TON_NATIVE | POLYGON_USDT
deals.asset_contract           TON jetton master | EVM token address | null for TON native
deals.settlement_mode          NATIVE | LEGACY_TON_TO_POLYGON
deals.quote_id                 uuid
deals.terms_version            integer
deals.terms_hash               bytes32/hex string
deals.buyer_wallet_address     string
deals.seller_wallet_address    string
deals.escrow_address           string
deals.funded_at                timestamp
```

Addresses хранятся в canonical chain format плюс исходное display representation при необходимости. Сравнение адресов всегда делает chain adapter.

### 3.3 Quote

`DealQuote` является единственным источником финансовых значений:

```text
network, chainId, assetId, assetContract
dealAmountAtomic
buyerFeeAtomic, sellerFeeAtomic
networkFeeEstimateAtomic, providerFeeAtomic
buyerTotalAtomic, sellerNetAtomic, refundAtomic
fxRate, fxSpread, expiresAt
quoteVersion, quoteHash
```

UI, payment request, contract initialization и ledger используют один persisted quote. Повторный локальный расчёт комиссии запрещён.

### 3.4 Chain transaction reference

```ts
export interface ChainTransactionRef {
  network: SettlementNetwork;
  chainId: string;
  txHash: string;
  eventId?: string;
  actionIndex?: number;
  blockNumber?: string;
  logicalTime?: string;
  finalizedAt: string;
}
```

## 4. Backend interfaces

### 4.1 Settlement adapter

```ts
export interface EscrowChainAdapter {
  readonly network: SettlementNetwork;

  validateAsset(config: SettlementAssetConfig): Promise<void>;
  normalizeAddress(address: string): string;
  validateAddress(address: string): boolean;

  prepareEscrow(input: PrepareEscrowInput): Promise<PreparedEscrow>;
  buildFundingRequest(input: FundingRequestInput): Promise<WalletTransactionRequest>;
  verifyFunding(input: VerifyFundingInput): Promise<VerifiedChainTransfer>;

  release(input: SettlementCommandInput): Promise<ChainTransactionRef>;
  refund(input: SettlementCommandInput): Promise<ChainTransactionRef>;
  openDispute(input: SettlementCommandInput): Promise<ChainTransactionRef>;
  resolve(input: ResolveCommandInput): Promise<ChainTransactionRef>;

  readEscrowState(address: string): Promise<NormalizedEscrowState>;
  reconcile(input: ReconciliationInput): Promise<ChainReconciliationResult>;
}
```

Adapter не рассчитывает product fee, не меняет deal FSM самостоятельно и не конвертирует актив. Он проверяет/исполняет chain-specific действие и возвращает нормализованный результат.

### 4.2 Registry и policy

```ts
interface SettlementAdapterRegistry {
  get(network: SettlementNetwork): EscrowChainAdapter;
}

interface NetworkAvailabilityPolicy {
  listFor(input: {
    channel: ClientChannel;
    countryCode?: string;
    category: DealCategory;
    userId?: string;
  }): Promise<NetworkOffer[]>;
}
```

`NetworkOffer` содержит availability, asset list, estimated fee/time, wallet requirements и reason code, если сеть недоступна.

### 4.3 Разделение funding rail и settlement

Текущий `PaymentRail` предполагает, что Polygon всегда является settlement layer. Это предположение удаляется.

- `FundingConnector` отвечает за wallet/provider interaction.
- `EscrowChainAdapter` отвечает за escrow и settlement.
- Direct connector обязан совпадать с сетью сделки.
- Provider conversion connector может отличаться только при наличии отдельного conversion order и явного consent.
- Registry не выбирает settlement по `PaymentMethod`; он получает его из immutable deal terms.

## 5. Реализации

### 5.1 `PolygonEscrowAdapter`

Переиспользует:

- `contracts/contracts/EscrowImplementation.sol`;
- `EscrowFactory.sol`, `PlatformTreasury.sol` и утверждённые governance contracts;
- `services/user-service/src/modules/escrow/escrow.service.ts`;
- ethers/Web3Signer infrastructure;
- `mini-app/src/hooks/useEscrowRelease.ts` после переноса в chain-aware hook.

Необходимые изменения:

- удалить предположение, что escrow создаётся автоматически при наличии двух generic `walletAddress`;
- использовать только подтверждённые Polygon bindings;
- зафиксировать chain id, token address, decimals, quote hash и terms hash;
- allowlist Polygon USDT отдельно для testnet/mainnet;
- проверить direct funding, release, refund, dispute, resolve и timeout;
- вернуть нормализованный `ChainTransactionRef`;
- завершить Web3Signer/KMS, Safe 2/3, timelock и deployment acceptance;
- сохранить Polygon UI на website; не вызывать EVM connector в Mini App без policy approval.

### 5.2 `TonEscrowAdapter`

Новая нативная реализация:

- isolated TON escrow deployment pattern по ADR;
- USDT-TON jetton validation и TON native support за отдельными asset capabilities;
- TON Connect funding/release commands;
- finalized event ingestion с cursor/backfill и unique `(eventId, actionIndex)`;
- direct same-chain release/refund/resolve;
- отдельные treasury/governance addresses и limits;
- ни одного требования EVM wallet/MetaMask/Polygon float.

Текущие `ton-rail.base.ts`, `ton-usdt.rail.ts` и `toncoin.rail.ts` используются как migration inventory для rate, detection и recovery logic, но их Polygon funding step не переносится в target adapter.

## 6. API contract

### 6.1 Create/update terms

```json
{
  "type": "digital",
  "subcategory": "online_service",
  "quoteAmount": "100.00",
  "quoteCurrency": "USDT",
  "settlement": {
    "network": "ton",
    "chainId": "mainnet",
    "asset": "ton_usdt"
  },
  "feeModel": "split_50_50",
  "description": "..."
}
```

Backend отклоняет:

- network/asset mismatch;
- Polygon request из Mini App channel;
- неразрешённые country/category/network сочетания;
- funding для неподтверждённой или истёкшей terms version;
- изменение network/asset после funding.

### 6.2 Accept terms

Seller передаёт `termsVersion`, `quoteId`, `walletBindingId`. Backend подтверждает, что binding относится к выбранной сети, пересчитывает hash на сервере и сохраняет consent обеих сторон.

### 6.3 Funding intent

`POST /deals/:id/funding-intent` возвращает discriminated union:

```ts
type FundingIntent =
  | { network: 'ton'; kind: 'ton_connect'; messages: TonConnectMessage[]; expiresAt: string }
  | { network: 'polygon'; kind: 'evm_transaction'; chainId: number; transaction: EvmTransactionRequest; expiresAt: string };
```

Frontend не собирает destination/amount самостоятельно.

## 7. Database migration strategy

1. Добавить nullable settlement/quote/terms/wallet columns и новые enum/reference tables.
2. Backfill существующие сделки с EVM escrow как `POLYGON + POLYGON_USDT`.
3. Сделки, оплаченные TON rail и профинансированные Polygon float, маркировать `LEGACY_TON_TO_POLYGON`; не представлять их как native TON.
4. Не мигрировать funded/active escrow между сетями.
5. Добавить validation на уровне service, затем database checks для новых записей.
6. После E2E parity сделать settlement fields `NOT NULL` для новых deal versions.
7. Legacy read/recovery остаётся до закрытия последней исторической сделки; создание legacy mode выключено feature flag.

## 8. Frontend implementation

### Общая модель

- `SettlementNetwork`, `SettlementAsset` и funding intent генерируются из backend OpenAPI/schema, а не копируются вручную.
- `NetworkComparison` показывает каждой стороне estimated all-in fee, expected finality, supported wallets и payout result.
- Network selector доступен до принятия terms; после funding read-only.
- Seller подтверждает wallet выбранной сети и seller net.

### Telegram Mini App

- Backend availability возвращает TON offers.
- TON Connect provider и capability detection.
- Если deal создан на website в Polygon, Mini App не подключает EVM wallet и не подписывает транзакцию; допустимый информационный/deep-link flow определяется Telegram approval.

### Website

- TON Connect и Polygon EVM connector как независимые wallet providers.
- Один активный connector на конкретной deal page; второй кошелёк не требуется.
- Wrong-chain detection и безопасная network switch request для Polygon.
- Marketing/public shell отделён от authenticated deal application.

### Текущие UI исправления до redesign

- `DealNewPage.tsx`: root-level `subcategory`, `feeModel`, settlement object; убрать critical financial fields из metadata.
- `AmountDisplay.tsx`: читать persisted quote, не считать 5% локально.
- `ContractPanel.tsx`: убрать mock payout currencies; показывать только eligible same-chain result.
- `useEscrowRelease.ts`: заменить EVM-only hook на chain-dispatched settlement action.
- payment view: TON Connect вместо address/memo copy в normal path; Polygon connector только на website.

## 9. Ledger и reconciliation

Ledger account key включает:

```text
network + chainId + assetId + owner/account type
```

- Балансы TON и Polygon никогда не взаимозачитываются для прохождения reconciliation.
- Per-chain breaker останавливает funding/egress только затронутой сети; global breaker включается при shared-ledger/auth/governance incident.
- Postings обязательны для receipt, escrow liability, release, refund, platform fee, reserve, arbitration payout и conversion order.
- Dashboard показывает assets/liabilities/delta отдельно по TON и Polygon и общий агрегат только в отчётной валюте с явным rate timestamp.

## 10. Conformance и chain-specific tests

Общий adapter conformance suite:

- prepare/create;
- exact funding;
- under/over/wrong-asset funding;
- duplicate/reordered/replayed event;
- release/refund/dispute/resolve;
- timeout/auto-release;
- command retry после process restart;
- conservation of funds;
- quote/terms mismatch rejection;
- immutable network after funding.

Chain-specific suites:

- TON: jetton master/wallet validation, bounced messages, logical time/finality, fake jetton, memo/query id replay.
- Polygon: wrong chain/token, allowance/transfer behavior, reentrancy, nonce replacement, RPC reorg/finality, signer queue.

Beta и audit gates считаются отдельно для каждой сети. Запуск TON не автоматически разрешает Polygon и наоборот.

## 11. Последовательность code PRs

### PR 1 — Domain contract без изменения движения денег

- добавить settlement enums/types;
- добавить nullable schema migration и legacy classification;
- versioned create/accept API с channel/network validation;
- расширить rail descriptor полями settlement network/asset/channel;
- добавить invariant: network immutable after funding;
- consumer tests backend ↔ frontend.

### PR 2 — Wrap существующего Polygon

- `EscrowChainAdapter` + registry;
- `PolygonEscrowAdapter` поверх текущего escrow service;
- chain-aware funding/release API;
- Polygon website connector boundary;
- conformance tests без изменения production feature flags.

### PR 3 — Quote и ledger foundation

- persisted versioned Quote API;
- убрать локальные fee calculations;
- balanced postings и per-chain reconciliation schema;
- breaker policies и injected-delta tests.

### PR 4 — Native TON testnet

- TON contracts;
- `TonEscrowAdapter`;
- TON Connect;
- finalized ingestion/backfill;
- native release/refund/dispute/resolve;
- TON conformance и recovery tests.

### PR 5 — UI flows и website shell

- network comparison/consent;
- channel-aware wallet providers;
- shared deal room and status components;
- honest payout/fee/failure states;
- accessibility/E2E analytics.

### PR 6 — Security/operations acceptance

- signer/governance, evidence, atomic audit, auth hardening;
- monitoring, backup/restore, failover и incident drills;
- external audits и remediation;
- capped per-chain beta flags/limits.

## 12. Definition of Done первого implementation slice

PR 1 готов, когда:

- новая сделка явно хранит network/chain/asset как typed core fields;
- Mini App API не разрешает Polygon funding offer;
- Website API возвращает TON и Polygon по policy;
- обе стороны подтверждают одну terms/quote version;
- смена сети после funding покрыта отрицательным тестом;
- существующие Polygon и legacy hybrid сделки читаются без изменения их движения средств;
- ни один production feature flag не включён автоматически;
- build, typecheck, unit и integration tests зелёные.
