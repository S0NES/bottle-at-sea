import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handleApi, type CoreRequest } from '../shared/core';
import { LIVE_MAX_MS, LIVE_POLL_MS, LIVE_RETRY_MS, formatSse, heartbeat, liveStateFrom, pollLive, renderShell } from '../shared/live';
import { BOTTLE_TTL_MS, MAX_REPORTS } from '../shared/rules';
import type { Mailer } from '../shared/mail';
import { API_SECURITY_HEADERS, PAGE_SECURITY_HEADERS, corsHeaders } from '../shared/security';
import { sqliteStore } from './sqlite-store';

export interface AppOptions {
  db: Database.Database;
  secret?: string;
  allowedOrigin?: string;
  /** Honour X-Forwarded-For (only enable behind a trusted proxy). */
  trustProxy?: boolean;
  coffeeUrl?: string;
  serveStatic?: boolean;
  mailer?: Mailer;
}

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp(opts: AppOptions): Express {
  const app = express();
  const secret = opts.secret ?? randomBytes(16).toString('hex');
  const cors = corsHeaders(opts.allowedOrigin ?? '*');
  const store = sqliteStore(opts.db);

  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', true);

  app.use('/api', (req, res, next) => {
    res.set({ ...API_SECURITY_HEADERS, ...cors });
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const MAX_LIVE = 400;
  let liveClients = 0;
  app.get('/api/live', (req, res) => {
    if (liveClients >= MAX_LIVE) {
      res.status(503).json({ error: 'The sea is crowded right now.', code: 'busy' });
      return;
    }
    liveClients++;
    const url = new URL(req.originalUrl, 'http://local');
    const state = liveStateFrom(url.searchParams, req.header('last-event-id') ?? null, Date.now());
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`retry: ${LIVE_RETRY_MS}\n\n`);
    const started = Date.now();
    let closed = false;
    let polling = false;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      liveClients--;
      res.end();
    };
    const tick = async (): Promise<void> => {
      if (closed || polling) return;
      polling = true;
      try {
        const events = await pollLive(store, state, Date.now());
        for (const e of events) res.write(formatSse(e));
        res.write(heartbeat(state));
      } catch {
        /* a failed poll just skips this beat */
      }
      polling = false;
      if (Date.now() - started > LIVE_MAX_MS) finish();
    };
    const timer = setInterval(() => void tick(), LIVE_POLL_MS);
    req.on('close', finish);
    void tick();
  });

  app.use('/api', express.text({ type: () => true, limit: '4kb' }));

  app.use('/api', async (req: Request, res: Response) => {
    const type = req.headers['content-type'] ?? '';
    let bodyState: CoreRequest['bodyState'] = 'none';
    let body: unknown;
    if (req.method === 'POST') {
      if (!/^application\/json\b/i.test(type)) {
        bodyState = 'wrong_type';
      } else if (typeof req.body === 'string' && req.body.length > 0) {
        try {
          body = JSON.parse(req.body) as unknown;
          bodyState = 'ok';
        } catch {
          bodyState = 'invalid_json';
        }
      }
    }
    try {
      const url = new URL(req.originalUrl, 'http://local');
      const out = await handleApi(
        {
          method: req.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          body,
          bodyState,
          ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        },
        { store, secret, ...(opts.mailer ? { mailer: opts.mailer } : {}) },
      );
      if (out.headers) res.set(out.headers);
      if (out.body === undefined) res.status(out.status).end();
      else res.status(out.status).type('application/json').send(JSON.stringify(out.body));
    } catch (e) {
      console.error('api error', e instanceof Error ? e.message : 'unknown');
      res.status(500).json({ error: 'The tide pulled that one under. Please try again.', code: 'server_error' });
    }
  });

  const apiErrors: ErrorRequestHandler = (err: { type?: string }, _req, res, _next) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'That message is too large.', code: 'too_large' });
      return;
    }
    res.status(400).json({ error: 'Bad request.', code: 'invalid_body' });
  };
  app.use('/api', apiErrors);

  if (opts.serveStatic && existsSync(distDir)) {
    const indexPath = join(distDir, 'index.html');
    app.get(['/', '/index.html'], async (_req, res) => {
      let bottles = 0;
      try {
        bottles = await store.liveCount(Date.now() - BOTTLE_TTL_MS, MAX_REPORTS);
      } catch {
        /* serve the page anyway */
      }
      res.set({ ...PAGE_SECURITY_HEADERS, 'Cache-Control': 'no-store' });
      res.type('html').send(renderShell(readFileSync(indexPath, 'utf8'), { bottles, coffeeUrl: opts.coffeeUrl }));
    });
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res) => res.set(PAGE_SECURITY_HEADERS),
      }),
    );
  }

  return app;
}
