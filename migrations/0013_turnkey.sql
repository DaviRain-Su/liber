-- Turnkey embedded-wallet linkage (login migration, see plan + functions/lib/turnkey-auth.ts).
-- Each user that authenticates via Turnkey gets a non-custodial sub-organization with an
-- embedded Sui wallet. The Liber identity key (users.sui_address: email:/google:/<wallet addr>)
-- is UNCHANGED so existing users map seamlessly; these columns link the Turnkey sub-org and
-- record its embedded Sui address (the on-chain identity every reader now gets).
ALTER TABLE users ADD COLUMN turnkey_sub_org_id TEXT;
ALTER TABLE users ADD COLUMN turnkey_sui_address TEXT;
CREATE INDEX IF NOT EXISTS idx_users_turnkey_sub ON users (turnkey_sub_org_id);
