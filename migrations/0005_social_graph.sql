-- Reader graph: real follows between authenticated users.
-- This replaces the old frontend-only FOLLOW_SEED/localStorage behavior for
-- production accounts while still allowing local demo fallback in the UI.

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee_id);
