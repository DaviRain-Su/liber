-- Real book content + billing integration.
-- Books/chapters live in D1 metadata and R2/Walrus blobs, so the frontend can
-- read actual imported CC0 texts instead of relying on seed-only demo data.

CREATE TABLE IF NOT EXISTS library_books (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  author       TEXT,
  category     TEXT NOT NULL DEFAULT '文学 · 诗',
  lang         TEXT NOT NULL DEFAULT '中文',
  year         TEXT,
  pages        INTEGER NOT NULL DEFAULT 0,
  words        INTEGER NOT NULL DEFAULT 0,
  cover_class  TEXT NOT NULL DEFAULT 'ink',
  seal         TEXT,
  blurb        TEXT,
  description  TEXT,
  license      TEXT NOT NULL DEFAULT 'CC0-1.0',
  source_url   TEXT,
  featured     INTEGER NOT NULL DEFAULT 0,
  manifest_key TEXT,
  walrus       TEXT,
  arweave      TEXT,
  sui_index    TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_books_category ON library_books (category);
CREATE INDEX IF NOT EXISTS idx_library_books_created ON library_books (created_at);

CREATE TABLE IF NOT EXISTS library_chapters (
  book_id      TEXT NOT NULL,
  n            INTEGER NOT NULL,
  title        TEXT NOT NULL,
  blob_key     TEXT NOT NULL,
  walrus       TEXT,
  arweave      TEXT,
  sui_index    TEXT,
  text_preview TEXT NOT NULL DEFAULT '',
  text_size    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (book_id, n)
);
CREATE INDEX IF NOT EXISTS idx_library_chapters_book ON library_chapters (book_id, n);

CREATE TABLE IF NOT EXISTS subscription_links (
  user_id         TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  customer_id     TEXT,
  subscription_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  type        TEXT NOT NULL,
  user_id     TEXT,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
