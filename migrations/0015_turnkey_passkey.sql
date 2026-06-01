-- Passkey-signed transactions (non-custodial). To add a user's WebAuthn passkey as
-- an authenticator on their Turnkey sub-org we need the sub-org's root user id; and
-- we record when a wallet passkey was enrolled (NULL = not yet set up).
ALTER TABLE users ADD COLUMN turnkey_root_user_id TEXT;
ALTER TABLE users ADD COLUMN turnkey_passkey_at INTEGER;
