# Relay Signer → KMS/Vault: чек-лист для закрытия (действия USER)

Что нужно **от вас**, чтобы закрыть единственный оставшийся HIGH-пункт из
[PAYMENTS_HARDENING_PLAN.md](./PAYMENTS_HARDENING_PLAN.md) — вынос приватного ключа
relay hot-wallet из `.env` во внешний signer (KMS/HSM/Vault).

Код-часть (рефакторинг под интерфейс `Signer` + адаптеры + тесты) я делаю сам и
локально. Ниже — то, что **невозможно сделать без вас**: решения, инфраструктура,
доступы и финальная приёмка в целевом окружении.

---

## Шаг 0. Решение — какой провайдер (нужно от вас ОДНО)

Выберите один вариант. От этого зависит адаптер и формат доступов.

| Вариант | Когда выбирать | Ключевое требование |
|---------|----------------|---------------------|
| **AWS KMS** | уже в AWS | ключ типа `ECC_SECG_P256K1`, usage `SIGN_VERIFY` |
| **GCP KMS** | уже в GCP | key purpose `ASYMMETRIC_SIGN`, алгоритм `EC_SIGN_SECP256K1_SHA256` |
| **HashiCorp Vault Transit** | self-hosted / мультиклауд | secret engine `transit`, ключ типа `ecdsa-p256k1` |

> ⚠️ Критично: ключ должен быть на кривой **secp256k1** (Ethereum). Обычный
> RSA-ключ KMS **не подойдёт**. У GCP/AWS secp256k1 доступен не во всех регионах —
> проверьте заранее.

**Отметьте выбор:** ☐ AWS KMS ☐ GCP KMS ☐ Vault Transit

---

## Шаг 1. Провижининг ключа (инфраструктура — от вас)

Общее для всех:
- ☐ Создать **несохраняемый** (non-exportable) secp256k1-ключ. Приватная часть
  никогда не покидает KMS/Vault.
- ☐ Получить **публичный адрес** этого ключа (Ethereum-адрес) — он станет новым
  адресом relay hot-wallet.
- ☐ Завести ключ **отдельно на каждое окружение** (staging / prod) — не переиспользовать.
- ☐ Настроить **ротацию** и процедуру отзыва (runbook: что делать при подозрении на компрометацию).

AWS KMS:
- ☐ `aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY`
- ☐ Alias (напр. `alias/relay-signer-prod`), запомнить `KeyId` / ARN.

GCP KMS:
- ☐ KeyRing + CryptoKey, purpose `ASYMMETRIC_SIGN`, алгоритм `EC_SIGN_SECP256K1_SHA256`.
- ☐ Запомнить полный resource name версии ключа.

Vault:
- ☐ Включить transit: `vault secrets enable transit`.
- ☐ `vault write transit/keys/relay-signer type=ecdsa-p256k1 exportable=false`.
- ☐ Адрес Vault (`VAULT_ADDR`) и путь ключа.

---

## Шаг 2. Доступы для сервиса (от вас)

Выдать сервису **минимальные** права: только подпись, без экспорта ключа.

- ☐ **AWS:** IAM-роль/политика с `kms:Sign`, `kms:GetPublicKey` на конкретный key ARN
  (`Resource` = только этот ключ). Предпочтительно IRSA / instance role, **не**
  долгоживущие ключи. Если без роли — `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- ☐ **GCP:** service account с ролью `roles/cloudkms.signerVerifier` на этот ключ;
  Workload Identity или JSON-ключ SA.
- ☐ **Vault:** policy с `update` на `transit/sign/relay-signer` и `read` на
  `transit/keys/relay-signer`; AppRole (`role_id`/`secret_id`) или k8s-auth.
- ☐ Включить **аудит-лог** обращений к операции подписи.

Эти креды дают только право *попросить подпись*, но не выдают сам приватный ключ —
компрометация пода больше не означает кражу средств.

---

## Шаг 3. Значения env для целевого окружения (от вас)

После шагов 1–2 подготовьте значения (я задам финальные имена переменных при
реализации кода; ориентировочно):

Общее:
- ☐ `RELAY_SIGNER=aws-kms | gcp-kms | vault` — выбранный провайдер.
- ☐ Убрать `BLOCKCHAIN_PRIVATE_KEY` из целевого окружения (остаётся только в
  локальном dev при `RELAY_SIGNER=local`).

AWS: ☐ `AWS_REGION` ☐ `KMS_KEY_ID` (+ креды/роль)
GCP: ☐ `GCP_KMS_KEY_RESOURCE` (+ SA)
Vault: ☐ `VAULT_ADDR` ☐ `VAULT_TRANSIT_KEY=relay-signer` (+ AppRole/token)

---

## Шаг 4. Пополнение нового hot-wallet (от вас)

- ☐ Перевести на **новый** адрес (из шага 1) POL/MATIC на газ.
- ☐ Перевести USDT-float, необходимый для `forwardAndFund` (см. `TON_MIN_FLOAT_USDT`).
- ☐ Обновить `PLATFORM_TREASURY_ADDRESS` / права, если старый relay-адрес был где-то
  прописан как owner/relay в контрактах (проверю со стороны кода и подскажу список).

---

## Шаг 5. Приёмка в sandbox (совместно; запуск — от вас)

Локально это **не проверяется** (нужен реальный KMS). В целевом окружении:
- ☐ Старт сервиса: в логах `BlockchainProvider connected … signer=<новый адрес>`
  — адрес совпадает с адресом KMS-ключа из шага 1.
- ☐ Тестовая сеть (Amoy/Polygon): пройти `createEscrow` и `forwardAndFund` —
  транзакции подписаны и приняты сетью (проверка recovery `v` и low-s подписи KMS).
- ☐ Негатив: при отозванных правах KMS сервис **не падает молча**, а логирует
  ошибку подписи и не теряет платёж (уходит в retry).

---

## Что делаю я (для справки — от вас не требуется)

- Замена типа `_signer: ethers.Wallet` → `ethers.Signer` в `blockchain.provider.ts`.
- Абстракция `SignerFactory` + реализации `LocalWalletSigner` (dev/test) и
  KMS-адаптер(ы); выбор по `RELAY_SIGNER`.
- Unit-тесты фабрики и graceful-fallback в stub-mode; мок KMS-клиента.

---

## Итог: минимальный набор от вас

1. Выбрать провайдера (Шаг 0).
2. Создать secp256k1-ключ и выдать сервису права только на подпись (Шаги 1–2).
3. Передать мне публичный адрес ключа + значения env (Шаг 3).
4. Пополнить новый hot-wallet газом и USDT-float (Шаг 4).
5. Запустить приёмку в sandbox и подтвердить чек-пункты (Шаг 5).
