-- Liber backend schema (Cloudflare D1 / SQLite).
-- Static reference data (books, chapters, base annotations, agents, lenses,
-- chart baselines) is served from the shared seed (src/data/product-data.js).
-- These tables hold the dynamic, per-user, growing data, merged with the seed
-- on read.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  sui_address TEXT UNIQUE,
  handle      TEXT,
  name        TEXT,
  color       TEXT,
  seal        TEXT,
  bio         TEXT,
  is_guest    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- per-user highlights (one color per sentence)
CREATE TABLE IF NOT EXISTS highlights (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  book_id    TEXT NOT NULL,
  sid        TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'hl-user',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, book_id, sid)
);
CREATE INDEX IF NOT EXISTS idx_hl_user_book ON highlights (user_id, book_id);

-- annotations / notes on a sentence (public ones are shown to other readers)
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  book_id    TEXT NOT NULL,
  sid        TEXT NOT NULL,
  text       TEXT NOT NULL,
  public     INTEGER NOT NULL DEFAULT 1,
  color      TEXT,
  up         INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user_book ON notes (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_notes_sentence ON notes (book_id, sid);

-- reading position per user/book
CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT NOT NULL,
  book_id    TEXT NOT NULL,
  chapter_n  INTEGER,
  percent    REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

-- discussion thread replies, keyed by "<book_id>:<sid>"
CREATE TABLE IF NOT EXISTS thread_replies (
  id         TEXT PRIMARY KEY,
  thread_key TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  up         INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread ON thread_replies (thread_key, created_at);

-- shared AI conversations (对话卡 / 金句卡), with fork lineage
CREATE TABLE IF NOT EXISTS shares (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  book_id    TEXT,
  sid        TEXT,
  form       TEXT NOT NULL DEFAULT 'card',
  title      TEXT,
  insight    TEXT,
  quote      TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  parent_id  TEXT,
  data       TEXT NOT NULL,
  agree      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_created ON shares (created_at);
CREATE INDEX IF NOT EXISTS idx_shares_parent ON shares (parent_id);

CREATE TABLE IF NOT EXISTS convo_saves (
  user_id  TEXT NOT NULL,
  share_id TEXT NOT NULL,
  PRIMARY KEY (user_id, share_id)
);

-- CC0 re-creations (导读) published back to the library
CREATE TABLE IF NOT EXISTS works (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  addr       TEXT NOT NULL,
  license    TEXT NOT NULL DEFAULT 'CC0-1.0',
  cited      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- AI companion conversations + messages
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  book_id    TEXT,
  sid        TEXT,
  lens       TEXT NOT NULL DEFAULT 'companion',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  text            TEXT NOT NULL,
  ref             TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages (conversation_id, created_at);

-- co-reading group membership + posts
CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_posts (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  chap       TEXT,
  up         INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_posts ON group_posts (group_id, created_at);

-- raw signals powering the rankings (merged on top of the seed baselines)
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  book_id    TEXT NOT NULL,
  sid        TEXT,
  user_id    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events ON events (type, book_id, created_at);

-- content blobs registered through the storage abstraction (R2 now → Walrus later)
CREATE TABLE IF NOT EXISTS blobs (
  key         TEXT PRIMARY KEY,
  walrus      TEXT,
  arweave     TEXT,
  sui_index   TEXT,
  size        INTEGER,
  content_type TEXT,
  created_at  INTEGER NOT NULL
);
