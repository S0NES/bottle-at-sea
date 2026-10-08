export interface LiveStats {
  up: number;
  down: number;
  commentCount: number;
}

export interface LiveHandlers {
  onBottle: (tint: number) => void;
  onCount: (bottles: number) => void;
  onUpdate: (stats: LiveStats) => void;
}

const BASE: string = import.meta.env.VITE_API_BASE ?? '';

function parse(data: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(data);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class LiveFeed {
  private source: EventSource | null = null;
  private watching: string | null = null;
  private retry = 0;
  private started = false;
  private readonly onVisibility = (): void => {
    if (!this.started) return;
    if (document.hidden) this.close();
    else this.open();
  };

  constructor(private readonly handlers: LiveHandlers) {}

  start(): void {
    if (this.started || typeof EventSource === 'undefined') return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!document.hidden) this.open();
  }

  watch(id: string | null): void {
    if (id === this.watching) return;
    this.watching = id;
    if (this.started && !document.hidden) {
      this.close();
      this.open();
    }
  }

  stop(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.close();
  }

  private open(): void {
    if (this.source) return;
    const qs = this.watching ? `?watch=${encodeURIComponent(this.watching)}` : '';
    const es = new EventSource(`${BASE}/api/live${qs}`);
    this.source = es;

    es.addEventListener('bottle', (e) => {
      const d = parse((e as MessageEvent<string>).data);
      if (d) this.handlers.onBottle(Math.max(0, Math.min(4, Math.round(num(d.tint)))));
    });
    es.addEventListener('count', (e) => {
      const d = parse((e as MessageEvent<string>).data);
      if (d) this.handlers.onCount(Math.max(0, Math.round(num(d.bottles))));
    });
    es.addEventListener('update', (e) => {
      const d = parse((e as MessageEvent<string>).data);
      if (d) this.handlers.onUpdate({ up: num(d.up), down: num(d.down), commentCount: num(d.commentCount) });
    });
    es.addEventListener('open', () => {
      this.retry = 0;
    });
    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        this.close();
        const wait = Math.min(60_000, 5_000 * 2 ** this.retry++);
        window.setTimeout(() => {
          if (this.started && !document.hidden) this.open();
        }, wait);
      }
    });
  }

  private close(): void {
    this.source?.close();
    this.source = null;
  }
}
