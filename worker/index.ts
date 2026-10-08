/// <reference types="@cloudflare/workers-types" />
import { handleApi, type BottleRecord, type CommentRecord, type CoreRequest, type Store } from '../shared/core';
import { LIVE_MAX_MS, LIVE_POLL_MS, LIVE_RETRY_MS, formatSse, heartbeat, liveStateFrom, pollLive, renderShell } from '../shared/live';
import { resendMailer } from '../shared/mail';
import { BOTTLE_TTL_MS, MAX_REPORTS } from '../shared/rules';
import { API_SECURITY_HEADERS, PAGE_SECURITY_HEADERS, corsHeaders } from '../shared/security';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  SALT_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  COFFEE_URL?: string;
}

const MAX_BODY_BYTES = 4096;

interface BottleRow {
  id: string;
  text: string;
  tint: number;
  created_at: number;
  up_count: number;
  down_count: number;
  comment_count: number;
}

function d1Store(db: D1Database): Store {
  return {
    async purgeExpired(cutoff) {
      await db.batch([
        db.prepare('DELETE FROM comments WHERE bottle_id IN (SELECT id FROM bottles WHERE created_at < ?)').bind(cutoff),
        db.prepare('DELETE FROM bottles WHERE created_at < ?').bind(cutoff),
      ]);
    },
    async insertBottle(b) {
      await db
        .prepare('INSERT INTO bottles (id, text, tint, created_at, report_count, email) VALUES (?, ?, ?, ?, 0, ?)')
        .bind(b.id, b.text, b.tint, b.createdAt, b.email)
        .run();
    },
    async randomBottle(exclude, minCreatedAt, maxReports) {
      const placeholders = exclude.map(() => '?').join(',');
      const sql = `SELECT id, text, tint, created_at, up_count, down_count,
          (SELECT COUNT(*) FROM comments c WHERE c.bottle_id = bottles.id) AS comment_count
        FROM bottles
        WHERE created_at >= ? AND report_count < ?${exclude.length ? ` AND id NOT IN (${placeholders})` : ''}
        ORDER BY RANDOM() LIMIT 1`;
      const row = await db
        .prepare(sql)
        .bind(minCreatedAt, maxReports, ...exclude)
        .first<BottleRow>();
      if (!row) return null;
      const out: BottleRecord = {
        id: row.id,
        text: row.text,
        tint: row.tint,
        createdAt: row.created_at,
        up: row.up_count,
        down: row.down_count,
        commentCount: row.comment_count,
      };
      return out;
    },
    async reportBottle(id) {
      const res = await db.prepare('UPDATE bottles SET report_count = report_count + 1 WHERE id = ?').bind(id).run();
      return (res.meta.changes ?? 0) > 0;
    },
    async replyTarget(id, minCreatedAt, maxReports) {
      const row = await db
        .prepare('SELECT id, email, created_at, reply_count FROM bottles WHERE id = ? AND created_at >= ? AND report_count < ?')
        .bind(id, minCreatedAt, maxReports)
        .first<{ id: string; email: string | null; created_at: number; reply_count: number }>();
      return row ? { id: row.id, email: row.email, createdAt: row.created_at, noteCount: row.reply_count } : null;
    },
    async addComment(c) {
      await db.batch([
        db
          .prepare('INSERT INTO comments (id, bottle_id, text, kind, rating, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(c.id, c.bottleId, c.text, c.kind, c.rating, c.createdAt),
        db.prepare('UPDATE bottles SET reply_count = reply_count + 1 WHERE id = ?').bind(c.bottleId),
      ]);
    },
    async bumpNotes(bottleId) {
      await db.prepare('UPDATE bottles SET reply_count = reply_count + 1 WHERE id = ?').bind(bottleId).run();
    },
    async rate(id, value) {
      const column = value === 1 ? 'up_count' : 'down_count';
      await db.prepare(`UPDATE bottles SET ${column} = ${column} + 1 WHERE id = ?`).bind(id).run();
      const row = await db.prepare('SELECT up_count, down_count FROM bottles WHERE id = ?').bind(id).first<{ up_count: number; down_count: number }>();
      return { up: row?.up_count ?? 0, down: row?.down_count ?? 0 };
    },
    async listComments(bottleId, limit) {
      const res = await db
        .prepare('SELECT id, text, kind, rating, created_at FROM comments WHERE bottle_id = ? ORDER BY created_at DESC LIMIT ?')
        .bind(bottleId, limit)
        .all<{ id: string; text: string; kind: 'reply' | 'rating'; rating: number | null; created_at: number }>();
      return res.results.map((r): CommentRecord => ({ id: r.id, text: r.text, kind: r.kind, rating: r.rating, createdAt: r.created_at }));
    },
    async bottlesSince(sinceTs, minCreatedAt, maxReports, limit) {
      const res = await db
        .prepare('SELECT created_at, tint FROM bottles WHERE created_at > ? AND created_at >= ? AND report_count < ? ORDER BY created_at ASC LIMIT ?')
        .bind(sinceTs, minCreatedAt, maxReports, limit)
        .all<{ created_at: number; tint: number }>();
      return res.results.map((r) => ({ createdAt: r.created_at, tint: r.tint }));
    },
    async liveCount(minCreatedAt, maxReports) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM bottles WHERE created_at >= ? AND report_count < ?').bind(minCreatedAt, maxReports).first<{ n: number }>();
      return r?.n ?? 0;
    },
    async bottleStats(id, minCreatedAt, maxReports) {
      const r = await db
        .prepare('SELECT up_count, down_count, (SELECT COUNT(*) FROM comments c WHERE c.bottle_id = bottles.id) AS cc FROM bottles WHERE id = ? AND created_at >= ? AND report_count < ?')
        .bind(id, minCreatedAt, maxReports)
        .first<{ up_count: number; down_count: number; cc: number }>();
      return r ? { up: r.up_count, down: r.down_count, commentCount: r.cc } : null;
    },
    async hits(key, since) {
      const res = await db
        .prepare('SELECT ts FROM rate_limits WHERE key = ? AND ts >= ? ORDER BY ts ASC')
        .bind(key, since)
        .all<{ ts: number }>();
      return res.results.map((r) => r.ts);
    },
    async addHit(key, ts) {
      await db.prepare('INSERT INTO rate_limits (key, ts) VALUES (?, ?)').bind(key, ts).run();
    },
    async purgeHits(before) {
      await db.prepare('DELETE FROM rate_limits WHERE ts < ?').bind(before).run();
    },
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  extra: Record<string, string>,
  cors: Record<string, string>,
): Response {
  const headers = new Headers({ ...API_SECURITY_HEADERS, ...cors, ...extra });
  if (body === undefined) return new Response(null, { status, headers });
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request: Request): Promise<Pick<CoreRequest, 'body' | 'bodyState'>> {
  if (request.method !== 'POST') return { body: undefined, bodyState: 'none' };
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { body: undefined, bodyState: 'wrong_type' };
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { body: undefined, bodyState: 'too_large' };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { body: undefined, bodyState: 'too_large' };
  if (!text) return { body: undefined, bodyState: 'none' };
  try {
    return { body: JSON.parse(text) as unknown, bodyState: 'ok' };
  } catch {
    return { body: undefined, bodyState: 'invalid_json' };
  }
}

function liveResponse(request: Request, env: Env, ctx: ExecutionContext, cors: Record<string, string>): Response {
  const url = new URL(request.url);
  const state = liveStateFrom(url.searchParams, request.headers.get('Last-Event-ID'), Date.now());
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const store = d1Store(env.DB);
  ctx.waitUntil(
    (async () => {
      const started = Date.now();
      try {
        await writer.write(enc.encode(`retry: ${LIVE_RETRY_MS}\n\n`));
        while (Date.now() - started < LIVE_MAX_MS) {
          const events = await pollLive(store, state, Date.now());
          await writer.write(enc.encode(events.map(formatSse).join('') + heartbeat(state)));
          await new Promise((r) => setTimeout(r, LIVE_POLL_MS));
        }
      } catch {
        /* the visitor went away */
      } finally {
        await writer.close().catch(() => undefined);
      }
    })(),
  );
  const headers = new Headers({ ...API_SECURITY_HEADERS, ...cors });
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  return new Response(readable, { headers });
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(env.ALLOWED_ORIGIN ?? '*');

  if (!url.pathname.startsWith('/api/')) {
    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(k, v);
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if ((res.headers.get('Content-Type') ?? '').includes('text/html')) {
      try {
        const bottles = await d1Store(env.DB).liveCount(Date.now() - BOTTLE_TTL_MS, MAX_REPORTS);
        const html = renderShell(await res.text(), { bottles, coffeeUrl: env.COFFEE_URL });
        headers.set('Cache-Control', 'no-store');
        headers.delete('Content-Length');
        headers.delete('ETag');
        return new Response(html, { status: res.status, statusText: res.statusText, headers });
      } catch {
        /* fall through and serve the static page */
      }
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...API_SECURITY_HEADERS, ...cors } });
  }

  if (url.pathname === '/api/live' && request.method === 'GET') return liveResponse(request, env, ctx, cors);

  if (!env.SALT_SECRET) {
    return jsonResponse(503, { error: 'This sea is not configured yet.', code: 'misconfigured' }, {}, cors);
  }

  const { body, bodyState } = await readBody(request);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  try {
    const mailer = env.RESEND_API_KEY && env.MAIL_FROM ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : undefined;
    const res = await handleApi(
      { method: request.method, pathname: url.pathname, searchParams: url.searchParams, body, bodyState, ip },
      { store: d1Store(env.DB), secret: env.SALT_SECRET, ...(mailer ? { mailer } : {}) },
    );
    return jsonResponse(res.status, res.body, { ...(res.headers ?? {}) }, cors);
  } catch (e) {
    console.error('api error', e instanceof Error ? e.message : 'unknown');
    return jsonResponse(500, { error: 'The tide pulled that one under. Please try again.', code: 'server_error' }, {}, cors);
  }
}

export default {
  fetch: handleRequest,

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    const store = d1Store(env.DB);
    await store.purgeExpired(now - BOTTLE_TTL_MS);
    await store.purgeHits(now - 60 * 60 * 1000);
  },
} satisfies ExportedHandler<Env>;
