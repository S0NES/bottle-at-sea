export interface FoundBottle {
  id: string;
  text: string;
  tint: number;
  createdAt: string;
  up: number;
  down: number;
  commentCount: number;
}

export interface BottleNote {
  text: string;
  kind: 'reply' | 'rating';
  rating: number | null;
  createdAt: string;
}

export class NetworkError extends Error {
  constructor(message = 'Could not reach the sea.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE: string = import.meta.env.VITE_API_BASE ?? '';
const TIMEOUT_MS = 12_000;

interface ErrorBody {
  error?: string;
  code?: string;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(BASE + path, { ...init, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new NetworkError();
  } finally {
    window.clearTimeout(timer);
  }
}

async function failure(res: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* non-JSON error page from a proxy */
  }
  const retry = Number(res.headers.get('Retry-After'));
  return new ApiError(
    res.status,
    body.code ?? 'error',
    body.error ?? 'Something went wrong out at sea.',
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}

export async function sendBottle(text: string, tint: number, email?: string): Promise<string> {
  const res = await request('/api/bottles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, tint, ...(email ? { email } : {}) }),
  });
  if (res.status !== 201) throw await failure(res);
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== 'string') throw new ApiError(res.status, 'bad_response', 'Unexpected reply from the sea.', null);
  return data.id;
}

export async function fetchRandomBottle(exclude: readonly string[]): Promise<FoundBottle | null> {
  const qs = exclude.length ? `?exclude=${encodeURIComponent(exclude.slice(-70).join(','))}` : '';
  const res = await request(`/api/bottles/random${qs}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as Partial<FoundBottle>;
  if (typeof data.id !== 'string' || typeof data.text !== 'string' || typeof data.tint !== 'number') {
    throw new ApiError(res.status, 'bad_response', 'Unexpected reply from the sea.', null);
  }
  return {
    id: data.id,
    text: data.text,
    tint: data.tint,
    createdAt: String(data.createdAt ?? ''),
    up: Number(data.up ?? 0),
    down: Number(data.down ?? 0),
    commentCount: Number(data.commentCount ?? 0),
  };
}

export async function reportBottle(id: string): Promise<void> {
  const res = await request(`/api/bottles/${encodeURIComponent(id)}/report`, { method: 'POST' });
  if (res.status !== 204) throw await failure(res);
}

/** Answers a bottle. The server emails the writer if they opted in, otherwise it is left as a note. Same reply either way. */
export async function sendReply(id: string, text: string): Promise<void> {
  const res = await request(`/api/bottles/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status !== 202) throw await failure(res);
}

export async function rateBottle(id: string, value: 1 | -1, comment?: string): Promise<{ up: number; down: number }> {
  const res = await request(`/api/bottles/${encodeURIComponent(id)}/rating`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, ...(comment ? { comment } : {}) }),
  });
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as { up?: number; down?: number };
  return { up: Number(data.up ?? 0), down: Number(data.down ?? 0) };
}

export async function fetchNotes(id: string): Promise<BottleNote[]> {
  const res = await request(`/api/bottles/${encodeURIComponent(id)}/comments`);
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as { comments?: BottleNote[] };
  return Array.isArray(data.comments) ? data.comments : [];
}
