-- 书单 (Booklists): user-curated, named collections of books.
-- Backend home for the shelf's "我的书单" section and the "加入书单" action,
-- replacing the previous frontend-only seed collections. Public lists are
-- shareable and forkable — each list is an addressable, forkable object, in the
-- same spirit as shared conversations (shares) and works.

CREATE TABLE IF NOT EXISTS booklists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT 'ink',
  visibility  TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'private'
  parent_id   TEXT,                              -- forked from this booklist (lineage)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booklists_user ON booklists (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_booklists_parent ON booklists (parent_id);

-- Books inside a booklist (ordered; one row per book per list).
CREATE TABLE IF NOT EXISTS booklist_items (
  booklist_id TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  note        TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (booklist_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_booklist_items ON booklist_items (booklist_id, sort, created_at);

-- Collects/saves of another reader's booklist (收藏书单).
CREATE TABLE IF NOT EXISTS booklist_saves (
  user_id     TEXT NOT NULL,
  booklist_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, booklist_id)
);
CREATE INDEX IF NOT EXISTS idx_booklist_saves_list ON booklist_saves (booklist_id);
