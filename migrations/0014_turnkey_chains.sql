-- Multi-chain Turnkey embedded wallets. One Turnkey HD wallet derives accounts on
-- several chains from the same seed; we now provision Sui + Ethereum + Solana (was
-- Sui only). turnkey_addresses is a JSON map {"sui":..,"ethereum":..,"solana":..};
-- turnkey_wallet_id is the HD wallet id (for deriving more accounts / signing).
ALTER TABLE users ADD COLUMN turnkey_addresses TEXT;
ALTER TABLE users ADD COLUMN turnkey_wallet_id TEXT;
