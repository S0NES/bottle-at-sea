-- Upgrade an existing database created from the first schema.sql:
--   npx wrangler d1 execute bottle-at-sea -c worker/wrangler.toml --remote --file=worker/migration-0002.sql
-- (Fresh installs should just run schema.sql, which already includes all of this.)

ALTER TABLE bottles ADD COLUMN email TEXT;
ALTER TABLE bottles ADD COLUMN up_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN down_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  bottle_id  TEXT NOT NULL,
  text       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  rating     INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_bottle ON comments (bottle_id, created_at);
