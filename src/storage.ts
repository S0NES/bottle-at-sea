/**
 * The only thing kept in the browser: ids of bottles this device has written
 * or already read, so "Find a bottle" never repeats. Never sent anywhere but
 * the `exclude` query of the random endpoint.
 */
const SEEN_KEY = 'bas:seen';
const MINE_KEY = 'bas:mine';
const POWER_KEY = 'bas:lowpower';
const RATED_KEY = 'bas:rated';
const CAP = 200;

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushList(key: string, id: string): void {
  try {
    const list = readList(key).filter((x) => x !== id);
    list.push(id);
    localStorage.setItem(key, JSON.stringify(list.slice(-CAP)));
  } catch {
    /* private mode: fall back to in-session memory only */
    memory.add(id);
  }
}

const memory = new Set<string>();

export const seen = {
  add: (id: string): void => pushList(SEEN_KEY, id),
};

export const rated = {
  add: (id: string): void => pushList(RATED_KEY, id),
  has: (id: string): boolean => readList(RATED_KEY).includes(id),
};

interface MineEntry {
  id: string;
  t: number;
}

function readMine(): MineEntry[] {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): MineEntry[] => {
      if (typeof x === 'string') return [{ id: x, t: Date.now() }];
      if (typeof x === 'object' && x !== null && typeof (x as MineEntry).id === 'string') {
        const t = Number((x as MineEntry).t);
        return [{ id: (x as MineEntry).id, t: Number.isFinite(t) ? t : Date.now() }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export const mine = {
  add(id: string): void {
    try {
      const list = readMine().filter((m) => m.id !== id);
      list.push({ id, t: Date.now() });
      localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(-CAP)));
    } catch {
      memory.add(id);
    }
  },
  activeCount(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return readMine().filter((m) => m.t >= cutoff).length;
  },
};

export function excludedIds(): string[] {
  return [...new Set([...readList(SEEN_KEY), ...readMine().map((m) => m.id), ...memory])];
}

export function loadLowPower(): boolean | null {
  try {
    const v = localStorage.getItem(POWER_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function saveLowPower(on: boolean): void {
  try {
    localStorage.setItem(POWER_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
