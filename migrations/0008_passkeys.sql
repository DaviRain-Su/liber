-- WebAuthn passkeys (通行密钥). One row per registered authenticator credential.
-- A passkey is bound to a real (non-guest) user in `users`; logging in with it
-- mints a normal session, exactly like a wallet signature does.
CREATE TABLE IF NOT EXISTS passkeys (
  id          TEXT PRIMARY KEY,          -- credential ID (base64url)
  user_id     TEXT NOT NULL,             -- owning users.id
  public_key  TEXT NOT NULL,             -- COSE public key, base64url-encoded
  counter     INTEGER NOT NULL DEFAULT 0,-- signature counter (replay protection)
  transports  TEXT,                      -- JSON array, e.g. ["internal","hybrid"]
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);
