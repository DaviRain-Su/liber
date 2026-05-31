-- Cloudflare Paid platform layer: background jobs, semantic search, AI cache,
-- generated assets, and coarse operational metrics.

CREATE TABLE IF NOT EXISTS platform_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  target_type TEXT,
  target_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  run_after INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_status ON platform_jobs(status, run_after, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_type ON platform_jobs(type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_target ON platform_jobs(target_type, target_id);

CREATE TABLE IF NOT EXISTS semantic_documents (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_n INTEGER,
  sid TEXT,
  title TEXT,
  text TEXT NOT NULL,
  lang TEXT,
  vector_id TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'chapter',
  indexed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_semantic_documents_book ON semantic_documents(book_id, chapter_n);
CREATE INDEX IF NOT EXISTS idx_semantic_documents_vector ON semantic_documents(vector_id);
CREATE INDEX IF NOT EXISTS idx_semantic_documents_sid ON semantic_documents(sid);

CREATE TABLE IF NOT EXISTS ai_translation_cache (
  cache_key TEXT PRIMARY KEY,
  book_id TEXT,
  chapter_n INTEGER,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  corrected_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_book ON ai_translation_cache(book_id, chapter_n);
CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_updated ON ai_translation_cache(updated_at);

CREATE TABLE IF NOT EXISTS share_assets (
  id TEXT PRIMARY KEY,
  share_id TEXT,
  kind TEXT NOT NULL,
  r2_key TEXT,
  content_type TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_assets_share ON share_assets(share_id, kind);
CREATE INDEX IF NOT EXISTS idx_share_assets_status ON share_assets(status, created_at);

CREATE TABLE IF NOT EXISTS platform_metrics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope TEXT,
  value REAL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_metrics_kind ON platform_metrics(kind, scope, created_at);
