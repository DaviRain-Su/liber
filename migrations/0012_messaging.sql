-- Direct messages (私信) between readers + a notifications feed.
-- The existing conversations/messages tables are AI-chat persistence; these are
-- user ↔ user. A DM may optionally quote a passage / annotation (JSON in `quote`).

CREATE TABLE IF NOT EXISTS dm_messages (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  quote       TEXT,                 -- optional JSON { q, note, book, chap }
  created_at  INTEGER NOT NULL,
  read_at     INTEGER               -- when the recipient first read it
);
CREATE INDEX IF NOT EXISTS idx_dm_pair  ON dm_messages (from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_inbox ON dm_messages (to_id, read_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,        -- recipient
  kind        TEXT NOT NULL,        -- follow | reply | agree | dm | agent
  actor_id    TEXT,                 -- who triggered it
  actor_name  TEXT,
  actor_color TEXT,
  text        TEXT NOT NULL DEFAULT '',
  book_id     TEXT,
  target      TEXT,                 -- optional ref (e.g. share/note id)
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications (user_id, read_at);
