-- Bottle at Sea schema (Cloudflare D1 and the local SQLite fallback share this file).
--
-- A bottle holds: id, text, tint, created_at, report_count, rating counters and,
-- only if the writer opted in, an email address. The address is used by the
-- server to forward replies one-way and is never returned by any endpoint.
-- No IPs, no user agents.

CREATE TABLE IF NOT EXISTS bottles (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  tint         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 0,
  email        TEXT,
  up_count     INTEGER NOT NULL DEFAULT 0,
  down_count   INTEGER NOT NULL DEFAULT 0,
  reply_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bottles_created ON bottles (created_at);

-- Notes left on a bottle: ratings with a comment, and replies to bottles whose
-- writer left no email. They disappear with the bottle.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  bottle_id  TEXT NOT NULL,
  text       TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- 'reply' | 'rating'
  rating     INTEGER,         -- 1 | -1 for kind = 'rating'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_bottle ON comments (bottle_id, created_at);

-- Rate limiter: a salted, daily-rotating hash of the client address plus a
-- timestamp. Rows are deleted as soon as they leave the one-hour window.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_key_ts ON rate_limits (key, ts);
