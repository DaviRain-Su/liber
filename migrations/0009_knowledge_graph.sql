-- Knowledge graph: living cross-book echoes. get_echoes reads echo_edges first
-- and falls back to the seed ECHOES dictionary when empty. Populated by the
-- embedding pipeline (functions/lib/graph/*) behind GRAPH_ENABLED + Vectorize.

-- Auto-discovered (and human-curated) cross-book echo edges. Pairs are stored
-- once, normalized so src_sid < dst_sid; queried bidirectionally by sentence.
CREATE TABLE IF NOT EXISTS echo_edges (
  id          TEXT PRIMARY KEY,
  src_sid     TEXT NOT NULL,                 -- global sid: ${bookId}-c${n}-s${i}
  dst_sid     TEXT NOT NULL,
  src_book    TEXT NOT NULL,
  dst_book    TEXT NOT NULL,
  score       REAL NOT NULL,                 -- cosine similarity 0..1 (rank/threshold/debug)
  why         TEXT,                          -- LLM "why these connect"; lazily filled, may be null
  theme       TEXT,                          -- cluster theme (Cron-produced, may be null)
  status      TEXT NOT NULL DEFAULT 'auto',  -- auto | curated | hidden
  hits        INTEGER NOT NULL DEFAULT 0,    -- times surfaced (heat / decay signal)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- unordered de-dup: application normalizes src_sid < dst_sid before writing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_echo_pair ON echo_edges (src_sid, dst_sid);
-- echoes of a sentence may sit on either side, so index both columns.
CREATE INDEX IF NOT EXISTS idx_echo_src ON echo_edges (src_sid, score DESC);
CREATE INDEX IF NOT EXISTS idx_echo_dst ON echo_edges (dst_sid, score DESC);

-- Idempotency ledger for embeddings: which sids are vectorized, by which model.
-- Vectors themselves live in Vectorize; this table only answers "already done?".
CREATE TABLE IF NOT EXISTS embeddings (
  sid         TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL,
  model       TEXT NOT NULL,                 -- e.g. @cf/baai/bge-m3 (changing model = re-embed)
  dim         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings (book_id);
