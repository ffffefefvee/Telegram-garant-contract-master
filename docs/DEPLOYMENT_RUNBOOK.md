# Deployment Runbook

Операционный сценарий деплоя tg-garant: контракты (Polygon), backend
(user-service), бэкапы БД. Дополняет `PAYMENTS_E2E_CHECKLIST.md` (функциональная
проверка) — здесь именно *как выкатывать*.

## 0. Компоненты

| Компонент | Где живёт | Деплой |
|---|---|---|
| Контракты (Treasury, Registry, Impl, Factory) | Polygon / Amoy | `contracts/scripts/deploy.ts`, `redeploy-impl.ts` |
| user-service (NestJS) | Railway (`railway.json`) или docker-compose | git push / `docker compose up -d` |
| mini-app (React) | статика за nginx / Railway | `npm run build` |
| Postgres | Railway managed / compose-контейнер | `scripts/db-backup.sh` / `db-restore.sh` |

## 1. Предусловия

- `.env` в `contracts/`: `DEPLOYER_PRIVATE_KEY` (или ключ в hardhat-конфиге через env), `BLOCKCHAIN_RPC_URL` (для Amoy опционально — есть публичный), `POLYGONSCAN_API_KEY` (для verify).
- На деплоер-адресе достаточно POL/MATIC на газ (полный деплой ~0.05–0.1, redeploy ~0.03).
- `RELAY_ADDRESS` и `ADMIN_ADDRESS` определены. **Mainnet: admin — отдельный от relay ключ**, в идеале multisig (см. SECURITY.md). Если admin ≠ deployer, скрипты печатают grantRole-команды для ручной подписи.

## 2. Первый деплой полного стека

```bash
cd contracts
RELAY_ADDRESS=0x... ADMIN_ADDRESS=0x... npm run deploy:amoy   # или --network polygon
```

Скрипт деплоит (Mock)USDT → Treasury → Registry → Implementation → Factory,
раздаёт роли и пишет адреса в `deployments/<network>.json` (коммитить для
amoy/polygon — это источник правды).

Затем → §5 (backend) и §6 (verify).

## 3. Redeploy implementation + factory (текущий случай: PR #9 `extendFundingDeadline`)

`EscrowFactory.implementation` — immutable, поэтому новая имплементация =
новая фабрика. Treasury/Registry/балансы **не трогаются**.

```bash
cd contracts
npx hardhat run scripts/redeploy-impl.ts --network amoy   # потом polygon
```

Скрипт сам: читает конфиг (relay, тарифы, штрафы) **on-chain со старой фабрики**
→ деплоит новые Impl+Factory с идентичным конфигом → выдаёт новой фабрике
`FACTORY_ROLE` на Treasury и Registry (или печатает команды для admin) →
обновляет `deployments/<network>.json`, сохранив старую фабрику в
`previousFactories`.

**Важно про in-flight сделки:**
- Старая фабрика и её эскроу продолжают работать — роли у неё не отзываем,
  пока есть незавершённые сделки (`SELECT count(*) FROM deals WHERE status NOT IN ('COMPLETED','CANCELLED','REFUNDED')` по сделкам со старым адресом фабрики).
- `extendFundingDeadline` доступен только эскроу, созданным **новой** фабрикой.
- Backend хранит адрес эскроу per-deal, поэтому смена `ESCROW_FACTORY_ADDRESS`
  влияет только на новые сделки.
- Когда на старой фабрике не останется живых эскроу: `revokeRole(FACTORY_ROLE, oldFactory)` на Treasury и Registry (admin).

## 4. Порядок выката (Amoy → mainnet)

1. **Amoy**: §3 → §6 (verify) → переключить staging-backend (§5) → прогнать смоук: создать сделку → fund → `POST /admin/payments/:id/extend-deadline` → release. Чек-лист: `PAYMENTS_E2E_CHECKLIST.md`.
2. **Mainnet**: повторить §3/§6 в окно низкой активности; перед переключением убедиться, что нет сделок в `AWAITING_FUNDING` (они не переносятся на новую фабрику автоматически).
3. Переключить prod backend (§5), смоук-сделку на минимальную сумму, мониторить `OPS_ALERT_CHAT_ID` и `/api/health` 30 минут.

## 5. Переключение backend

```bash
# Railway: обновить переменную и перезапустить сервис
ESCROW_FACTORY_ADDRESS=0x<новая фабрика>
# docker-compose:
#   правим .env → docker compose up -d user-service
```

- Health-check: `curl https://<host>/api/health` (Railway сам гейтит выкат по `/api/health`, timeout 120s).
- **Rollback** = вернуть старое значение `ESCROW_FACTORY_ADDRESS` и перезапустить. Сделки, успевшие создаться на новой фабрике, доживают на ней (адрес у сделки свой) — это безопасно.

## 6. Polygonscan verify

```bash
npx hardhat verify --network amoy <implementation>
npx hardhat verify --network amoy <factory> \
  <implementation> <token> <treasury> <registry> <relay> <admin> \
  <minDealAmount> '(<threshold>,<flatFee>,<percentFeeBps>)' '(<fineBps>,<fineMin>,<fineMax>)'
```

Все значения есть в `deployments/<network>.json`. Verify обязателен до
переключения prod — пользователи и арбитры должны видеть исходники.

## 7. Бэкапы Postgres

- **Ежедневно** (cron на хосте / Railway cron service):
  `30 3 * * * cd /opt/garant && bash scripts/db-backup.sh >> /var/log/garant-backup.log 2>&1`
- Скрипт сам определяет подключение (`DATABASE_URL` → `DB_*` → docker-контейнер), пишет custom-format dump + sha256, фейлится на подозрительно маленьком дампе, чистит локальные копии старше `RETENTION_DAYS` (14).
- **Обязательно off-site**: задать `S3_BUCKET=s3://...` (локальный диск умирает вместе с БД).
- **Restore-дрилл раз в квартал**: восстановить свежий дамп в scratch-БД
  (`FORCE=1 DATABASE_URL=postgres://...scratch bash scripts/db-restore.sh backups/<latest>.dump`)
  и сверить счётчики users/deals/payments с прод-БД. Непроверенный бэкап — не бэкап.
- Restore в прод требует `FORCE=1` (защита от случайной перезаписи) и останова backend на время restore.

## 8. Смоук после любого выката

1. `/api/health` зелёный, в логах нет ERROR за первые 5 минут.
2. Тестовая сделка на минимальную сумму: create → fund (Cryptomus или TON) → release.
3. Админка: список TON-депозитов открывается, extend-deadline работает на новой сделке.
4. Алерты в `OPS_ALERT_CHAT_ID` приходят (можно дёрнуть тестовый float-алерт).
