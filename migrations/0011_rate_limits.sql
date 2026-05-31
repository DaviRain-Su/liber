-- Per-key fixed-window rate-limit counters (functions/lib/ratelimit.ts).
-- D1/SQLite is strongly consistent, so an atomic upsert here actually throttles
-- bursts — unlike KV, whose eventually-consistent reads make a counter useless.
-- One row per (key, window); old windows are cleaned opportunistically.
CREATE TABLE IF NOT EXISTS rate_counters (
  k TEXT NOT NULL,
  w INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, w)
);
