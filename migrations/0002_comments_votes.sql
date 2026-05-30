-- Comments + votes (P-social). Generic over targets so the same tables serve
-- shared conversations now and works/books later. Traditional storage (D1)
-- first; the `walrus` column is reserved for an optional later move to
-- decentralized permanent storage (left NULL for now).

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,            -- 'share' | 'work' | 'book' | …
  target_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  up          INTEGER NOT NULL DEFAULT 0,
  walrus      TEXT,                      -- reserved: decentralized address (step 2)
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, created_at);

-- One row per (user, target) = an upvote/agree; presence is the toggle, so a
-- user can't inflate a count. Counts are derived by COUNT(*).
CREATE TABLE IF NOT EXISTS votes (
  user_id     TEXT NOT NULL,
  target_type TEXT NOT NULL,            -- 'share' | 'comment' | 'note' | …
  target_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes (target_type, target_id);
