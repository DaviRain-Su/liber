-- On-chain registrations made via the embedded wallet (liber::registry::register).
-- Tracks what a user has put on Sui — annotations, 藏书证书, Walrus blobs — so the UI
-- can show "已上链" and link the record, without re-querying chain events every time.
CREATE TABLE IF NOT EXISTS onchain_records (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,          -- 'annotation' | 'certificate' | 'storage' | 'work'
  content_id TEXT NOT NULL,          -- the registered reference (e.g. liber:note:<book>#<sid>)
  digest     TEXT,                   -- Sui transaction digest
  record_id  TEXT,                   -- the created Record object id
  network    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_onchain_user ON onchain_records (user_id);
CREATE INDEX IF NOT EXISTS idx_onchain_content ON onchain_records (user_id, content_id);
