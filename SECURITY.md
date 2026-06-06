# Security

## Telegram bot token

If a bot token was ever committed, pasted into chat, or shared: revoke it immediately in [@BotFather](https://t.me/BotFather) (Revoke current token) and set the new token only in `.env` (never commit `.env`).

## Secrets

- Use `.env.example` as a template only; real secrets belong in `.env` or your secret manager.
- `JWT_SECRET`, `CRYPTOMUS_*`, `BLOCKCHAIN_PRIVATE_KEY`, `TELEGRAM_TEST_INJECT_SECRET` must be strong random values in production.

## Webhooks

Set `BACKEND_URL` to a public HTTPS URL so Cryptomus can reach `/api/webhook/cryptomus`. Without it, payments stay unconfirmed on the server.
