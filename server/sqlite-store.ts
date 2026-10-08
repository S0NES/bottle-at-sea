import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BottleRecord, CommentRecord, Store } from '../shared/core';

interface BottleRow {
  id: string;
  text: string;
  tint: number;
  created_at: number;
  up_count: number;
  down_count: number;
  comment_count: number;
}

const schemaPath = fileURLToPath(new URL('../worker/schema.sql', import.meta.url));

function migrate(db: Database.Database): void {
  const cols = new Set((db.prepare("SELECT name FROM pragma_table_info('bottles')").all() as { name: string }[]).map((c) => c.name));
  const add: [string, string][] = [
    ['email', 'TEXT'],
    ['up_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['down_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['reply_count', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, def] of add) if (!cols.has(name)) db.exec(`ALTER TABLE bottles ADD COLUMN ${name} ${def}`);
}

export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  const schema = readFileSync(schemaPath, 'utf8');
  // Create tables first (old databases keep theirs), then bring columns up to date, then indexes.
  db.exec(schema.replace(/CREATE INDEX[^;]*;/g, ''));
  migrate(db);
  db.exec(schema);
  return db;
}

export function sqliteStore(db: Database.Database): Store {
  const deleteNotes = db.prepare('DELETE FROM comments WHERE bottle_id IN (SELECT id FROM bottles WHERE created_at < ?)');
  const deleteBottles = db.prepare('DELETE FROM bottles WHERE created_at < ?');
  const insert = db.prepare('INSERT INTO bottles (id, text, tint, created_at, report_count, email) VALUES (?, ?, ?, ?, 0, ?)');
  const report = db.prepare('UPDATE bottles SET report_count = report_count + 1 WHERE id = ?');
  const target = db.prepare('SELECT id, email, created_at, reply_count FROM bottles WHERE id = ? AND created_at >= ? AND report_count < ?');
  const addNote = db.prepare('INSERT INTO comments (id, bottle_id, text, kind, rating, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const bump = db.prepare('UPDATE bottles SET reply_count = reply_count + 1 WHERE id = ?');
  const up = db.prepare('UPDATE bottles SET up_count = up_count + 1 WHERE id = ?');
  const down = db.prepare('UPDATE bottles SET down_count = down_count + 1 WHERE id = ?');
  const totals = db.prepare('SELECT up_count, down_count FROM bottles WHERE id = ?');
  const notes = db.prepare('SELECT id, text, kind, rating, created_at FROM comments WHERE bottle_id = ? ORDER BY created_at DESC LIMIT ?');
  const since = db.prepare('SELECT created_at, tint FROM bottles WHERE created_at > ? AND created_at >= ? AND report_count < ? ORDER BY created_at ASC LIMIT ?');
  const live = db.prepare('SELECT COUNT(*) AS n FROM bottles WHERE created_at >= ? AND report_count < ?');
  const stats = db.prepare('SELECT up_count, down_count, (SELECT COUNT(*) FROM comments c WHERE c.bottle_id = bottles.id) AS cc FROM bottles WHERE id = ? AND created_at >= ? AND report_count < ?');
  const hits = db.prepare('SELECT ts FROM rate_limits WHERE key = ? AND ts >= ? ORDER BY ts ASC');
  const addHit = db.prepare('INSERT INTO rate_limits (key, ts) VALUES (?, ?)');
  const purgeHits = db.prepare('DELETE FROM rate_limits WHERE ts < ?');

  return {
    async purgeExpired(cutoff) {
      deleteNotes.run(cutoff);
      deleteBottles.run(cutoff);
    },
    async insertBottle(b) {
      insert.run(b.id, b.text, b.tint, b.createdAt, b.email);
    },
    async randomBottle(exclude, minCreatedAt, maxReports) {
      const placeholders = exclude.map(() => '?').join(',');
      const sql = `SELECT id, text, tint, created_at, up_count, down_count,
          (SELECT COUNT(*) FROM comments c WHERE c.bottle_id = bottles.id) AS comment_count
        FROM bottles
        WHERE created_at >= ? AND report_count < ?${exclude.length ? ` AND id NOT IN (${placeholders})` : ''}
        ORDER BY RANDOM() LIMIT 1`;
      const row = db.prepare(sql).get(minCreatedAt, maxReports, ...exclude) as BottleRow | undefined;
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
      return report.run(id).changes > 0;
    },
    async replyTarget(id, minCreatedAt, maxReports) {
      const row = target.get(id, minCreatedAt, maxReports) as { id: string; email: string | null; created_at: number; reply_count: number } | undefined;
      return row ? { id: row.id, email: row.email, createdAt: row.created_at, noteCount: row.reply_count } : null;
    },
    async addComment(c) {
      addNote.run(c.id, c.bottleId, c.text, c.kind, c.rating, c.createdAt);
      bump.run(c.bottleId);
    },
    async bumpNotes(bottleId) {
      bump.run(bottleId);
    },
    async rate(id, value) {
      (value === 1 ? up : down).run(id);
      const row = totals.get(id) as { up_count: number; down_count: number };
      return { up: row.up_count, down: row.down_count };
    },
    async listComments(bottleId, limit) {
      return (notes.all(bottleId, limit) as { id: string; text: string; kind: 'reply' | 'rating'; rating: number | null; created_at: number }[]).map(
        (r): CommentRecord => ({ id: r.id, text: r.text, kind: r.kind, rating: r.rating, createdAt: r.created_at }),
      );
    },
    async bottlesSince(sinceTs, minCreatedAt, maxReports, limit) {
      return (since.all(sinceTs, minCreatedAt, maxReports, limit) as { created_at: number; tint: number }[]).map((r) => ({ createdAt: r.created_at, tint: r.tint }));
    },
    async liveCount(minCreatedAt, maxReports) {
      return (live.get(minCreatedAt, maxReports) as { n: number }).n;
    },
    async bottleStats(id, minCreatedAt, maxReports) {
      const r = stats.get(id, minCreatedAt, maxReports) as { up_count: number; down_count: number; cc: number } | undefined;
      return r ? { up: r.up_count, down: r.down_count, commentCount: r.cc } : null;
    },
    async hits(key, since) {
      return (hits.all(key, since) as { ts: number }[]).map((r) => r.ts);
    },
    async addHit(key, ts) {
      addHit.run(key, ts);
    },
    async purgeHits(before) {
      purgeHits.run(before);
    },
  };
}
