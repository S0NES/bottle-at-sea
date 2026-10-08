import type { Store } from './core';
import { BOTTLE_TTL_MS, MAX_REPORTS } from './rules';

export const LIVE_POLL_MS = 4000;
/** Connections end after this long (keeps Worker subrequest budgets safe); EventSource reconnects with the last cursor. */
export const LIVE_MAX_MS = 40_000;
export const LIVE_RETRY_MS = 2000;

export interface LiveStats {
  up: number;
  down: number;
  commentCount: number;
}

export interface LiveState {
  since: number;
  watch: string | null;
  stats: LiveStats | null;
  count: number | null;
  ticks: number;
}

export type LiveEvent =
  | { event: 'bottle'; data: { tint: number }; id: number }
  | { event: 'count'; data: { bottles: number } }
  | { event: 'update'; data: LiveStats };

export function newLiveState(since: number, watch: string | null): LiveState {
  return { since, watch, stats: null, count: null, ticks: 0 };
}

export function formatSse(e: LiveEvent): string {
  const id = 'id' in e ? `id: ${e.id}\n` : '';
  return `${id}event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export async function pollLive(store: Store, state: LiveState, now: number): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [];
  const minCreated = now - BOTTLE_TTL_MS;

  const fresh = await store.bottlesSince(state.since, minCreated, MAX_REPORTS, 5);
  for (const b of fresh) {
    events.push({ event: 'bottle', data: { tint: b.tint }, id: b.createdAt });
    state.since = Math.max(state.since, b.createdAt);
  }

  // The total changes rarely, so it is only re-read now and then or after news.
  if (state.count === null || fresh.length > 0 || state.ticks % 10 === 0) {
    const count = await store.liveCount(minCreated, MAX_REPORTS);
    if (count !== state.count) {
      state.count = count;
      events.push({ event: 'count', data: { bottles: count } });
    }
  }

  if (state.watch) {
    const stats = await store.bottleStats(state.watch, minCreated, MAX_REPORTS);
    const prev = state.stats;
    if (stats && (!prev || prev.up !== stats.up || prev.down !== stats.down || prev.commentCount !== stats.commentCount)) {
      events.push({ event: 'update', data: stats });
    }
    state.stats = stats;
  }

  state.ticks++;
  return events;
}

const ID_RE = /^[a-f0-9]{16}$/;

export function liveStateFrom(searchParams: URLSearchParams, lastEventId: string | null, now: number): LiveState {
  const watchRaw = searchParams.get('watch') ?? '';
  const last = Number(lastEventId);
  const since = Number.isFinite(last) && last > 0 && last <= now ? last : now;
  return newLiveState(since, ID_RE.test(watchRaw) ? watchRaw : null);
}

/** An SSE comment that doubles as a cursor, so a reconnect never misses a bottle. */
export function heartbeat(state: LiveState): string {
  return `id: ${state.since}\n: ping\n\n`;
}

export interface ShellData {
  bottles: number;
  coffeeUrl?: string | undefined;
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const escapeAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderShell(html: string, data: ShellData): string {
  const n = Math.max(0, Math.floor(Number(data.bottles) || 0));
  let out = html
    .replace(new RegExp('<p class="adrift" id="adrift"[^>]*>'), '<p class="adrift" id="adrift">')
    .replace(new RegExp('(<span id="adrift-count">)[0-9]*(</span>)'), '$1' + n + '$2')
    .replace(new RegExp('(<span id="adrift-label">)[^<]*'), '$1' + (n === 1 ? 'bottle adrift' : 'bottles adrift'));
  const coffee = safeHttpUrl(data.coffeeUrl);
  out = coffee
    ? out.replace('{{COFFEE_URL}}', escapeAttr(coffee))
    : out.replace(new RegExp('<a[^>]*nav-coffee[^]*?</a>'), '');
  return out;
}
