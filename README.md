
# Workspace Telegram Worker

A Cloudflare Worker that handles Telegram integration for the Workspace web application.

It manages account linking, profile information, incoming tasks, messaging and scheduled agenda notifications through the Telegram Bot API.

## Tech Stack

- Cloudflare Workers
- Cloudflare KV
- Telegram Bot API

## Configuration

The worker requires the following bindings, secrets and environment variables.

| Name | Type | Description |
|---|---|---|
| `TG` | KV Namespace | Stores user profiles, connection tokens, inbox items and agenda data. |
| `BOT_TOKEN` | Secret | Telegram bot authentication token. |
| `WEBHOOK_SECRET` | Secret | Validates incoming Telegram webhook requests. |
| `ALLOW_ORIGIN` | Variable | Allowed origin for workspace API requests. |

## API Routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/webhook` | Handles incoming Telegram updates. |
| `GET` | `/health` | Checks worker configuration. |
| `GET` | `/status` | Completes Telegram account linking. |
| `GET` | `/me` | Retrieves the linked Telegram profile. |
| `GET` | `/inbox` | Fetches pending tasks from Telegram. |
| `POST` | `/agenda` | Updates agenda data for scheduled notifications. |
| `POST` | `/send` | Sends a Telegram message. |
| `POST` | `/unlink` | Disconnects the account and clears stored user data. |

## Scheduled Tasks

A cron trigger runs every 15 minutes to check saved agendas and deliver daily task summaries to linked Telegram accounts.

## Security

- Keep `BOT_TOKEN` and `WEBHOOK_SECRET` in Cloudflare Worker Secrets.
- Never commit credentials or private tokens to the repository.
- Restrict `ALLOW_ORIGIN` to the workspace domain in production.

## License

[MIT](LICENSE)