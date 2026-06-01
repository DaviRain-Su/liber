// Turnkey → Liber identity bridge. After Turnkey verifies a user (embedded-wallet
// signup or external-wallet/email/OAuth/passkey login), this maps them onto a Liber
// user row and links the Turnkey sub-org. Liber keeps its own session + user model
// (see functions/lib/auth.ts, which is NOT edited here); this only find-or-creates
// the user and records the linkage, then routes mint a Liber session as usual.
import type { Env } from "./types";
import { first, run, id, now } from "./db";
import { getUser, type UserRow } from "./auth";
import { provisionWallets, turnkeyConfigured } from "./turnkey";

export interface TurnkeyWallets { sui: string | null; ethereum: string | null; solana: string | null; }
const safeParse = (s: string | null | undefined): any => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export interface TurnkeyUserInput {
  // The Liber identity key stored in users.sui_address — UNCHANGED for existing users
  // so they map to their original account: "email:<addr>" | "google:<sub>" |
  // "<evm/solana/ wallet addr>" | the embedded Sui address (pure embedded-wallet users).
  identityKey: string;
  subOrgId: string;
  suiAddress: string; // the Turnkey embedded Sui address (the on-chain identity)
  handle?: string;
  name?: string;
  color?: string;
  seal?: string;
}

// Find-or-create the Liber user for a Turnkey-authenticated identity and link the
// sub-org + embedded Sui address. Idempotent: re-linking is a no-op.
export async function upsertTurnkeyUser(env: Env, input: TurnkeyUserInput): Promise<{ user: UserRow; isNew: boolean }> {
  const existing = await first<UserRow>(env.DB, `SELECT * FROM users WHERE sui_address = ?`, input.identityKey);
  if (existing) {
    if (!(existing as any).turnkey_sub_org_id) {
      await run(
        env.DB,
        `UPDATE users SET turnkey_sub_org_id = ?, turnkey_sui_address = ? WHERE id = ?`,
        input.subOrgId, input.suiAddress, existing.id,
      );
    }
    return { user: (await getUser(env, existing.id))!, isNew: false };
  }
  const uid = id("u_");
  const short = input.suiAddress.slice(2, 4).toUpperCase();
  await run(
    env.DB,
    `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at, turnkey_sub_org_id, turnkey_sui_address)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`,
    uid,
    input.identityKey,
    input.handle || `@${input.suiAddress.slice(0, 8)}`,
    input.name || `读者 ${short}`,
    input.color || "#3a4fb0",
    input.seal || "读",
    "",
    now(),
    input.subOrgId,
    input.suiAddress,
  );
  return { user: (await getUser(env, uid))!, isNew: true };
}

// Lazily give a user a Turnkey embedded Sui wallet (the product win: a real
// non-custodial on-chain address for every reader). Idempotent. Only provisions for
// wallet-less users (email:/google:/passkey-NULL); wallet-connect users already
// brought their own address, and guests are skipped. The server (parent API key) is
// a root user of the sub-org, so it can sign Sui actions for the user (custodial,
// see plan): exactly what work-registration needs.
export async function ensureTurnkeyWallet(env: Env, user: UserRow): Promise<{ subOrgId: string; addresses: TurnkeyWallets } | null> {
  const u = user as any;
  const existing: TurnkeyWallets | null = safeParse(u.turnkey_addresses);
  // Already has the full multi-chain set → done.
  if (u.turnkey_sub_org_id && existing?.sui && existing?.ethereum && existing?.solana) {
    return { subOrgId: u.turnkey_sub_org_id, addresses: existing };
  }
  if (!turnkeyConfigured(env) || user.is_guest) return null;
  const key = user.sui_address || "";
  const ownWallet = !!key && !key.startsWith("email:") && !key.startsWith("google:") && !key.startsWith("guest:");
  if (ownWallet) return null; // wallet-connect users already control their own wallet

  // Provision (or re-provision an incomplete Sui-only wallet — the old address is
  // unused, so replacing it with a full Sui+ETH+SOL wallet is safe).
  const p = await provisionWallets(env, `liber-${user.id}`);
  if (!p.subOrgId || !p.addresses.sui) return null;
  await run(
    env.DB,
    `UPDATE users SET turnkey_sub_org_id = ?, turnkey_wallet_id = ?, turnkey_sui_address = ?, turnkey_addresses = ? WHERE id = ?`,
    p.subOrgId, p.walletId, p.addresses.sui, JSON.stringify(p.addresses), user.id,
  );
  return { subOrgId: p.subOrgId, addresses: p.addresses };
}
