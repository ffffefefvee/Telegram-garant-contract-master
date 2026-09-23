# Offline staging identity fixture

From the repository root in PowerShell:

```powershell
npm --prefix services/user-service run idp:staging
```

Leave that terminal running. The command creates a 30-day self-signed HTTPS
certificate, an RSA signing key, two random test passwords and an introspection
bearer token under `services/user-service/.local-e2e/mock-idp/`. This directory
is ignored by Git. Existing valid fixture material is reused on restart.
Nothing is downloaded and no Docker service is required.

The provider listens only on `127.0.0.1:9443`. It prints the generated passwords,
token and certificate path. It also writes ready-to-copy backend IdP variables to
`services/user-service/.local-e2e/mock-idp/staging-idp.env`. Keep that file
private. Before starting the backend, run the printed `NODE_EXTRA_CA_CERTS`
PowerShell assignment in the backend's terminal. Node reads this variable at
process startup; adding it to `.env` after startup does not establish TLS trust.
Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

The fixed non-secret values are:

| Field | Value |
| --- | --- |
| Issuer | `https://127.0.0.1:9443` |
| Admin audience | `garant-admin` |
| Arbitrator audience | `garant-arbitrator` |
| JWKS | `https://127.0.0.1:9443/jwks` |
| Introspection | `https://127.0.0.1:9443/introspect` |
| Admin test user | `admin@local.test`, subject `11111111-1111-4111-8111-111111111111` |
| Arbitrator test user | `arbitrator@local.test`, subject `22222222-2222-4222-8222-222222222222` |
| MFA claim | `amr=["pwd","mfa"]`, `acr=urn:garant:acr:phishing-resistant` (simulated) |

Verify the server from a second PowerShell terminal:

```powershell
npm --prefix services/user-service run idp:check
```

Expected output: `{"status":"ok","fixture":"staging-mock-idp"}`.
The check uses Node's HTTPS client and the generated certificate as its trust
anchor. On this Windows host, `curl.exe` and `Invoke-RestMethod` fail in the
system TLS client before they reach the fixture, so the checked command is the
reliable copy-paste verification path.

The `POST /token` endpoint accepts JSON `{"username":"...","password":"..."}`
with the generated passwords. It issues five-minute RS256 assertions. The
`POST /introspect` endpoint requires the generated bearer token and reports
`active: true` only for unexpired tokens issued by the current process. A restart
invalidates outstanding tokens. The provider also exposes JWKS and discovery
metadata. Its MFA claims are synthetic; this fixture cannot demonstrate actual
factor enrollment, revocation or recovery and cannot close the external IdP
release gate. The fixture refuses `NODE_ENV=production`, and production
configuration rejects loopback IdP URLs.

For backend admin/arbitrator routes, the bearer-authenticated application's
user ID must equal the fixture token's `sub` above. The identity verifier's
integration test supplies these IDs directly; it does not seed application
users or create backend login sessions.

## Local backend stack on Windows

From the repository root, the single launcher command is:

```powershell
npm --prefix services/user-service run staging:local
```

It builds the backend, starts a dedicated PostgreSQL 15 cluster, Redis 7.4.9,
this HTTPS IdP, and the API. PostgreSQL and Redis listen only on loopback ports
55432 and 56379; the API listens only on `127.0.0.1:3001`. It creates random
local database, Redis, and JWT secrets. Money egress, native TON ingestion,
reconciliation, Polygon indexing, and evidence processing stay disabled. It
does not launch a Telegram bot without a bot token. Press Ctrl+C to stop the
stack. No real payment or production workflow should use these fixtures.

The first run needs `npm install` and downloads a portable Windows Redis ZIP
into the Git-ignored `.local-e2e` directory. The launcher verifies the ZIP
against the SHA-256 published in the [Redis-for-Windows 7.4.9 release](https://github.com/redis-windows/redis-windows/releases/tag/7.4.9).
This is an unofficial Windows build for local staging only, not a production
Redis distribution. Later runs use cached files and require no network. The
PostgreSQL files are copied to an ASCII-only path under Windows TEMP because
the bundled initializer cannot handle this machine's Cyrillic workspace path.

Verify API availability in another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

Expected: `status: ok`, `db: up`. This health check proves connectivity, not
that every legacy API query matches the migration schema. The mock IdP remains
independently verifiable with `npm --prefix services/user-service run idp:check`.

The launcher seeds two fixed-ID fixture users in its isolated database and
enables dev-login only for this localhost stack. To exercise both privileged
routes with real HTTP requests, backend sessions, IdP tokens, and online
introspection, run:

```powershell
npm --prefix services/user-service run staging:check:privileged
```

Expected: `{"status":"ok","admin":200,"arbitrator":200,"adminListings":4,"missingStepUp":401,"swappedRole":"denied"}`.
The read-only column-drift diagnostic is
`npm --prefix services/user-service run staging:check:schema`; no output means
every mapped entity column exists in the local migrated database. Neither
check proves real MFA enrollment: the IdP's MFA claim remains synthetic.
