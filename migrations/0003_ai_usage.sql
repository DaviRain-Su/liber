-- AI usage metering + subscription foundation (for a future 包月 / monthly plan).
-- Per-user, per-month counters so a free tier can be quota-limited and paid
-- tiers unlimited. No payment integration yet — `subscriptions` is the seam
-- a Stripe/wallet flow plugs into later.

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id    TEXT NOT NULL,
  period     TEXT NOT NULL,            -- "YYYY-MM"
  requests   INTEGER NOT NULL DEFAULT 0,
  tokens     INTEGER NOT NULL DEFAULT 0,  -- estimated
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    TEXT PRIMARY KEY,
  plan       TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  status     TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'canceled' | 'expired'
  expires_at INTEGER,                          -- epoch ms; null = no expiry
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
