/**
 * Framework-agnostic API logic. The Cloudflare Worker (D1) and the local
 * Express server (SQLite) both adapt their requests into `handleApi`, so the
 * two backends share one contract by construction.
 */
import { composeReplyEmail, type Mailer } from './mail';
import {
  BOTTLE_TTL_MS,
  MAX_COMMENTS_SHOWN,
  MAX_REPLIES_PER_BOTTLE,
  MAX_REPORTS,
  RATE_LIMIT,
  RATING_RATE_LIMIT,
  REPLY_RATE_LIMIT,
  REPORT_RATE_LIMIT,
  validateBottle,
  validateRating,
  validateReply,
} from './rules';

export interface BottleRecord {
  id: string;
  text: string;
  tint: number;
  createdAt: number;
  up: number;
  down: number;
  commentCount: number;
}

export interface NewBottle {
  id: string;
  text: string;
  tint: number;
  createdAt: number;
  /** Optional, write-only: only the server ever reads it back. */
  email: string | null;
}

/** What the server needs to know to deliver or file a reply. Never serialised to clients. */
export interface ReplyTarget {
  id: string;
  email: string | null;
  createdAt: number;
  noteCount: number;
}

export interface CommentRecord {
  id: string;
  text: string;
  kind: 'reply' | 'rating';
  rating: number | null;
  createdAt: number;
}

export interface NewComment {
  id: string;
  bottleId: string;
  text: string;
  kind: 'reply' | 'rating';
  rating: number | null;
  createdAt: number;
}

export interface Store {
  purgeExpired(cutoff: number): Promise<void>;
  insertBottle(b: NewBottle): Promise<void>;
  randomBottle(exclude: string[], minCreatedAt: number, maxReports: number): Promise<BottleRecord | null>;
  reportBottle(id: string): Promise<boolean>;
  replyTarget(id: string, minCreatedAt: number, maxReports: number): Promise<ReplyTarget | null>;
  addComment(c: NewComment): Promise<void>;
  bumpNotes(bottleId: string): Promise<void>;
  rate(id: string, value: 1 | -1): Promise<{ up: number; down: number }>;
  listComments(bottleId: string, limit: number): Promise<CommentRecord[]>;
  /** Live feed: bottles thrown after `since`. Only the glass tint and time, never text or ids. */
  bottlesSince(since: number, minCreatedAt: number, maxReports: number, limit: number): Promise<{ createdAt: number; tint: number }[]>;
  liveCount(minCreatedAt: number, maxReports: number): Promise<number>;
  bottleStats(id: string, minCreatedAt: number, maxReports: number): Promise<{ up: number; down: number; commentCount: number } | null>;
  hits(key: string, since: number): Promise<number[]>;
  addHit(key: string, ts: number): Promise<void>;
  purgeHits(before: number): Promise<void>;
}

export interface CoreRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body: unknown;
  bodyState: 'ok' | 'none' | 'invalid_json' | 'too_large' | 'wrong_type';
  ip: string;
}

export interface CoreResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface CoreOptions {
  store: Store;
  secret: string;
  mailer?: Mailer;
  now?: () => number;
}

const ID_RE = /^[a-f0-9]{16}$/;
const MAX_EXCLUDE = 80;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function err(status: number, code: string, error: string, headers?: Record<string, string>): CoreResponse {
  return { status, body: { error, code }, ...(headers ? { headers } : {}) };
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A salted hash of the IP, rotating daily. It lives only in the limiter table
 * for the length of the limiter window and is never stored with a bottle.
 */
async function limiterKey(scope: string, ip: string, secret: string, now: number): Promise<string> {
  const day = Math.floor(now / DAY_MS);
  const data = new TextEncoder().encode(`${scope}|${day}|${secret}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function limit(
  store: Store,
  key: string,
  cfg: { max: number; windowMs: number },
  now: number,
): Promise<CoreResponse | null> {
  const hits = await store.hits(key, now - cfg.windowMs);
  if (hits.length >= cfg.max) {
    const oldest = hits[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + cfg.windowMs - now) / 1000));
    const minutes = Math.ceil(retryAfter / 60);
    return err(
      429,
      'rate_limited',
      `The sea needs a rest. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { 'Retry-After': String(retryAfter) },
    );
  }
  return null;
}

function bodyProblem(req: CoreRequest): CoreResponse | null {
  if (req.bodyState === 'wrong_type') return err(415, 'unsupported_media_type', 'Send application/json.');
  if (req.bodyState === 'too_large') return err(413, 'too_large', 'That message is too large.');
  if (req.bodyState === 'invalid_json' || req.bodyState === 'none') return err(400, 'invalid_body', 'The request body must be valid JSON.');
  return null;
}

export async function handleApi(req: CoreRequest, opts: CoreOptions): Promise<CoreResponse> {
  const { store, secret } = opts;
  const now = (opts.now ?? Date.now)();
  const path = req.pathname.replace(/\/+$/, '') || '/';
  const minCreated = now - BOTTLE_TTL_MS;

  if (path === '/api/health') {
    return req.method === 'GET' ? { status: 200, body: { ok: true } } : err(405, 'method_not_allowed', 'Use GET.', { Allow: 'GET' });
  }

  if (path === '/api/bottles') {
    if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Use POST.', { Allow: 'POST' });
    const bad = bodyProblem(req);
    if (bad) return bad;
    const v = validateBottle(req.body);
    if (!v.ok) return err(400, v.code, v.error);

    const key = await limiterKey('b', req.ip, secret, now);
    const limited = await limit(store, key, RATE_LIMIT, now);
    if (limited) return limited;

    const id = randomHex(8);
    await store.purgeExpired(minCreated);
    await store.purgeHits(now - HOUR_MS);
    await store.insertBottle({ id, text: v.text, tint: v.tint, createdAt: now, email: v.email });
    await store.addHit(key, now);
    return { status: 201, body: { id } };
  }

  if (path === '/api/bottles/random') {
    if (req.method !== 'GET') return err(405, 'method_not_allowed', 'Use GET.', { Allow: 'GET' });
    const exclude = (req.searchParams.get('exclude') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ID_RE.test(s))
      .slice(0, MAX_EXCLUDE);
    const b = await store.randomBottle(exclude, minCreated, MAX_REPORTS);
    if (!b) return err(404, 'none_found', 'The sea is quiet tonight.');
    return {
      status: 200,
      body: {
        id: b.id,
        text: b.text,
        tint: b.tint,
        createdAt: new Date(b.createdAt).toISOString(),
        up: b.up,
        down: b.down,
        commentCount: b.commentCount,
      },
    };
  }

  const m = /^\/api\/bottles\/([^/]+)\/(report|reply|rating|comments)$/.exec(path);
  if (m) {
    const id = m[1] ?? '';
    const action = m[2];
    const wantsGet = action === 'comments';
    if (req.method !== (wantsGet ? 'GET' : 'POST')) {
      return err(405, 'method_not_allowed', `Use ${wantsGet ? 'GET' : 'POST'}.`, { Allow: wantsGet ? 'GET' : 'POST' });
    }
    if (!ID_RE.test(id)) return err(404, 'not_found', 'No such bottle.');

    if (action === 'report') {
      const key = await limiterKey('r', req.ip, secret, now);
      const limited = await limit(store, key, REPORT_RATE_LIMIT, now);
      if (limited) return limited;
      const found = await store.reportBottle(id);
      if (!found) return err(404, 'not_found', 'No such bottle.');
      await store.addHit(key, now);
      return { status: 204 };
    }

    if (action === 'comments') {
      const target = await store.replyTarget(id, minCreated, MAX_REPORTS);
      if (!target) return err(404, 'not_found', 'No such bottle.');
      const list = await store.listComments(id, MAX_COMMENTS_SHOWN);
      return {
        status: 200,
        body: {
          comments: list.map((c) => ({
            text: c.text,
            kind: c.kind,
            rating: c.rating,
            createdAt: new Date(c.createdAt).toISOString(),
          })),
        },
      };
    }

    const bad = bodyProblem(req);
    if (bad) return bad;

    if (action === 'rating') {
      const v = validateRating(req.body);
      if (!v.ok) return err(400, v.code, v.error);
      const key = await limiterKey('v', req.ip, secret, now);
      const limited = await limit(store, key, RATING_RATE_LIMIT, now);
      if (limited) return limited;
      const target = await store.replyTarget(id, minCreated, MAX_REPORTS);
      if (!target) return err(404, 'not_found', 'No such bottle.');
      if (v.comment && target.noteCount >= MAX_REPLIES_PER_BOTTLE) {
        return err(409, 'bottle_full', 'This bottle has received all the notes it can carry.');
      }
      const totals = await store.rate(id, v.value);
      if (v.comment) {
        await store.addComment({ id: randomHex(8), bottleId: id, text: v.comment, kind: 'rating', rating: v.value, createdAt: now });
      }
      await store.addHit(key, now);
      return { status: 200, body: totals };
    }

    const v = validateReply(req.body);
    if (!v.ok) return err(400, v.code, v.error);
    const key = await limiterKey('p', req.ip, secret, now);
    const limited = await limit(store, key, REPLY_RATE_LIMIT, now);
    if (limited) return limited;
    const target = await store.replyTarget(id, minCreated, MAX_REPORTS);
    if (!target) return err(404, 'not_found', 'No such bottle.');
    if (target.noteCount >= MAX_REPLIES_PER_BOTTLE) {
      return err(409, 'bottle_full', 'This bottle has received all the replies it can carry.');
    }

    let delivered = false;
    if (target.email && opts.mailer) {
      const mail = composeReplyEmail(v.text, target.createdAt);
      delivered = await opts.mailer({ ...mail, to: target.email });
    }
    if (delivered) {
      await store.bumpNotes(id);
    } else {
      // Either way the client gets the same neutral answer, so it can't tell which.
      await store.addComment({ id: randomHex(8), bottleId: id, text: v.text, kind: 'reply', rating: null, createdAt: now });
    }
    await store.addHit(key, now);
    return { status: 202, body: { status: 'accepted' } };
  }

  return err(404, 'not_found', 'Unknown endpoint.');
}
