import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Mailer } from '../shared/mail';
import { resendMailer } from '../shared/mail';
import { BOTTLE_TTL_MS } from '../shared/rules';
import { createApp } from './app';
import { smtpMailer } from './smtp-mailer';
import { openDatabase, sqliteStore } from './sqlite-store';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? (production ? '127.0.0.1' : 'localhost');
const dbPath = resolve(process.env.DB_PATH ?? 'server/data/bottles.db');
mkdirSync(dirname(dbPath), { recursive: true });

if (production && !process.env.SALT_SECRET) {
  console.error('SALT_SECRET is required when NODE_ENV=production (any long random string).');
  process.exit(1);
}

function chooseMailer(): { mailer?: Mailer; label: string } {
  const from = process.env.MAIL_FROM;
  if (from && process.env.SMTP_URL) return { mailer: smtpMailer(process.env.SMTP_URL, from), label: 'SMTP' };
  if (from && process.env.RESEND_API_KEY) return { mailer: resendMailer(process.env.RESEND_API_KEY, from), label: 'Resend' };
  return { label: 'off (replies stay as notes on the bottle)' };
}

const { mailer, label } = chooseMailer();
const db = openDatabase(dbPath);
const app = createApp({
  db,
  ...(mailer ? { mailer } : {}),
  ...(process.env.SALT_SECRET ? { secret: process.env.SALT_SECRET } : {}),
  ...(process.env.ALLOWED_ORIGIN ? { allowedOrigin: process.env.ALLOWED_ORIGIN } : {}),
  ...(process.env.COFFEE_URL ? { coffeeUrl: process.env.COFFEE_URL } : {}),
  trustProxy: process.env.TRUST_PROXY === '1',
  serveStatic: true,
});

const store = sqliteStore(db);
const sweep = (): void => {
  const now = Date.now();
  void store.purgeExpired(now - BOTTLE_TTL_MS);
  void store.purgeHits(now - 60 * 60 * 1000);
};
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();

const server = app.listen(port, host, () => {
  console.log(`bottle-at-sea listening on http://${host}:${port}  (db: ${dbPath}; email replies: ${label})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
