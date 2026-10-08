# Bottle at Sea

Write an anonymous message, seal it in a glass bottle and throw it into a 3D ocean. Other people's bottles drift by; tap one to read a stranger's message. No accounts, no names, no tracking.

Vite, TypeScript and Three.js on the front; Express and SQLite on the back. One Node process serves the website and the API, so it fits on a small VPS.

## Quick start

```bash
git clone git@github.com:S0NES/bottle-at-sea.git
cd bottle-at-sea
npm install
npm run dev
```

The website runs on <http://localhost:5173> and the API on port 8787, proxied at `/api`. Requires Node 22 or newer.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Website and API together, with reloading |
| `npm run typecheck` | Strict `tsc` for the website, server and Worker |
| `npm run test:api` | Contract tests against the real API on an in-memory database |
| `npm run build:prod` | Typecheck, build the website to `dist/` and bundle the server to `dist-server/` |
| `npm start` | Run the production bundle |

## Configuration

Copy `deploy/bottle-at-sea.env.example` to `deploy/bottle-at-sea.env` and fill it in.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SALT_SECRET` | yes | Salts the daily IP hash used by the rate limiter. Generate one with `openssl rand -hex 32`. The server refuses to start in production without it |
| `COFFEE_URL` | no | Target of the "Buy me a coffee" button. Leave empty to hide it |
| `MAIL_FROM` + `SMTP_URL` | no | Send reply emails through an SMTP server, for example `smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` + `RESEND_API_KEY` | no | Send reply emails through [Resend](https://resend.com) instead |
| `TRUST_PROXY=1` | recommended | Behind nginx or Caddy, take the visitor address from `X-Forwarded-For` |
| `PORT`, `HOST`, `DB_PATH` | no | Defaults: 8787, 127.0.0.1 (0.0.0.0 in Docker), a SQLite file |

Without a mail transport, replies to a bottle are kept as notes on that bottle.

## Deploy on a VPS

You need a Linux server and a domain pointing at it. Use Docker or systemd; nginx provides HTTPS in both cases.

### Docker

```bash
docker compose up -d --build
```

The container listens on 127.0.0.1:8787 and stores the database in the `bottle-data` volume.

### systemd

```bash
sudo useradd --system --home /opt/bottle-at-sea bottle
sudo mkdir -p /opt/bottle-at-sea && sudo chown $USER /opt/bottle-at-sea
git clone git@github.com:S0NES/bottle-at-sea.git /opt/bottle-at-sea && cd /opt/bottle-at-sea
npm ci && npm run build:prod && npm prune --omit=dev
sudo cp deploy/bottle-at-sea.env /etc/bottle-at-sea.env && sudo chmod 600 /etc/bottle-at-sea.env
sudo cp deploy/bottle-at-sea.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bottle-at-sea
```

### nginx and HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/bottle-at-sea   # replace YOUR_DOMAIN inside
sudo ln -s /etc/nginx/sites-available/bottle-at-sea /etc/nginx/sites-enabled/
sudo certbot --nginx -d your.domain
sudo nginx -t && sudo systemctl reload nginx
```

The config disables buffering for the live stream at `/api/live`; keep that if you use another proxy.

### Updating and backups

```bash
git pull && npm ci && npm run build:prod && sudo systemctl restart bottle-at-sea
```

With Docker, use `git pull && docker compose up -d --build`. The server upgrades an older database file in place on start.

The database uses WAL, so back it up with `sqlite3 bottles.db ".backup backup.db"` rather than copying the file.

## How it works

- **Write:** the **+** button opens a parchment scroll (500 characters, five glass colours, optional email). Sending rolls it into the bottle, which is thrown into the sea.
- **Read:** tap a drifting bottle, it floats to you, and the note unrolls. You can rate it, write back, find another, throw it back or report it.
- **Replies are one way.** If the writer left an email, the reply is mailed to them once and cannot be answered. The address is never sent to any browser. Without an email, or without a mail transport, the reply becomes a note on the bottle.
- **Live updates** arrive over Server-Sent Events: new bottles splash into view, the count updates, and ratings on the bottle you are reading change as others add them. Events carry only a glass colour and numbers.
- **The page is rendered by the server** with the title, coffee link and bottle count already filled in; WebGL draws the ocean in the browser.
- **The sky follows the visitor's clock**: dawn, day, golden hour, dusk, and night with moon and stars.

`prefers-reduced-motion` shortens transitions and slows the sea. Low-power mode switches on automatically when the frame rate stays low. The interface is keyboard accessible and the notes are real text.

## API

JSON over HTTP. Errors look like `{ "error": "message", "code": "machine_code" }`.

| Endpoint | Body or query | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/bottles` | `{ text, tint: 0-4, email? }` | `201 { id }` | `400`, `413`, `415`, `429` with `Retry-After` |
| `GET /api/bottles/random?exclude=a,b` | up to 80 ids | `200 { id, text, tint, createdAt, up, down, commentCount }` | `404` when the sea is empty |
| `POST /api/bottles/:id/report` | | `204` | `404`, `429` |
| `POST /api/bottles/:id/reply` | `{ text }` | `202 { status: "accepted" }`, identical whether mailed or kept as a note | `400`, `404`, `409`, `429` |
| `POST /api/bottles/:id/rating` | `{ value: 1 or -1, comment? }` | `200 { up, down }` | `400`, `404`, `409`, `429` |
| `GET /api/bottles/:id/comments` | | `200 { comments }` | `404` |
| `GET /api/live?watch=:id` | | event stream: `bottle`, `count`, `update` | `503` when crowded |
| `GET /api/health` | | `200 { ok: true }` | |

Text is trimmed and must be 1 to 500 characters; links and a small profanity list are rejected. A bottle with 3 reports is no longer served. Bottles expire after 30 days, together with their email and notes. Per client per hour: 5 bottles, 10 replies, 30 ratings, 20 reports.

## Privacy

- A bottle stores its text, glass colour, time, counters and, only if the writer opted in, an email address. That address is used solely to forward replies, is never returned by any endpoint and is deleted with the bottle. No IPs, user agents, cookies or accounts are stored with it.
- The rate limiter keeps a daily-rotating, salted hash of the client address for one hour. Nothing else about visitors is kept.
- The browser stores only the ids of bottles you wrote, read or rated, and a low-power preference.
- User text is always rendered as plain text. The server sends a strict Content-Security-Policy and security headers. There is no analytics; the only third party is Google Fonts.
- The limiter is per IP, so a shared network shares a budget, and the word list is small. **Report** is the real moderation tool.

## Project layout

```
index.html      page shell, filled in by the server with live data
src/            website: scene (ocean, sky, bottle, day cycle), ui, sequences, live feed
shared/         validation rules, API logic, live stream, mail, security headers
server/         Express and SQLite server
worker/         optional Cloudflare Worker and D1 version of the same API
deploy/         nginx config, systemd unit, environment template
scripts/        API contract tests
```

## Cloudflare instead of a VPS

`worker/` is the same API on Cloudflare Workers and D1. Run `npx wrangler d1 create bottle-at-sea`, put the database id in `worker/wrangler.toml`, then run `npm run db:init:remote`. Set the secrets (`SALT_SECRET`, optionally `RESEND_API_KEY`) and the `MAIL_FROM` and `COFFEE_URL` variables, then run `npm run deploy`. A database from an older version needs `worker/migration-0002.sql` applied first. Live updates poll D1 every 4 seconds per open page, so prefer the VPS for heavy traffic.

## License

[MIT](LICENSE)
