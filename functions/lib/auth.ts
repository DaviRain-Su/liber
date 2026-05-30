// Identity & sessions.
//
// PRAGMATIC-FIRST: identity in D1, sessions in KV, no chain writes. Guest auth
// works today; real Sui wallet-signature verification (ed25519 personal message)
// lands in P4 with @mysten/dapp-kit — kept out for now to keep the Worker lean.
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { Env, Variables } from "./types";
import { first, run, id, now } from "./db";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const NONCE_TTL = 300; // 5 minutes

export async function issueNonce(env: Env): Promise<string> {
  const nonce = crypto.randomUUID();
  await env.KV.put(`nonce:${nonce}`, "1", { expirationTtl: NONCE_TTL });
  return nonce;
}

export async function consumeNonce(env: Env, nonce?: string | null): Promise<boolean> {
  if (!nonce) return false;
  const ok = await env.KV.get(`nonce:${nonce}`);
  if (ok) await env.KV.delete(`nonce:${nonce}`);
  return !!ok;
}

// Verify a Sui personal-message signature; returns the signer's Sui address or
// null. Uses the official SDK so the intent bytes / serialization are correct by
// construction (supports ed25519, secp256k1/r1, multisig, zkLogin).
export async function verifySuiSignature(message: string, signature: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(message);
    const pubkey = await verifyPersonalMessageSignature(bytes, signature);
    return pubkey.toSuiAddress();
  } catch {
    return null;
  }
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.KV.put(`sess:${token}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}

export async function deleteSession(env: Env, token?: string | null): Promise<void> {
  if (token) await env.KV.delete(`sess:${token}`);
}

function tokenFrom(c: Ctx): string | null {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return getCookie(c, "liber_session") || null;
}

// Resolves the session (if any) into c.var.userId — never throws.
export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const token = tokenFrom(c);
  const userId = token ? await c.env.KV.get(`sess:${token}`) : null;
  c.set("userId", userId);
  c.set("isGuest", false);
  await next();
};

export function requireUser(c: Ctx): string {
  const uid = c.get("userId");
  if (!uid) throw new HTTPException(401, { message: "登录后才能进行此操作" });
  return uid;
}

export interface UserRow {
  id: string;
  sui_address: string | null;
  handle: string | null;
  name: string | null;
  color: string | null;
  seal: string | null;
  bio: string | null;
  is_guest: number;
  created_at: number;
}

export async function getUser(env: Env, userId: string): Promise<UserRow | null> {
  return first<UserRow>(env.DB, `SELECT * FROM users WHERE id = ?`, userId);
}

// Find-or-create a user by Sui address.
export async function upsertWalletUser(env: Env, address: string): Promise<UserRow> {
  const existing = await first<UserRow>(env.DB, `SELECT * FROM users WHERE sui_address = ?`, address);
  if (existing) return existing;
  const uid = id("u_");
  const seal = "读";
  const short = address.slice(2, 4).toUpperCase();
  await run(
    env.DB,
    `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at)
     VALUES (?,?,?,?,?,?,?,0,?)`,
    uid, address, `@${address.slice(0, 8)}`, `读者 ${short}`, "#3a4fb0", seal, "", now(),
  );
  return (await getUser(env, uid))!;
}

export async function createGuestUser(env: Env): Promise<UserRow> {
  const uid = id("g_");
  await run(
    env.DB,
    `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at)
     VALUES (?,?,?,?,?,?,?,1,?)`,
    uid, `guest:${uid}`, `@guest`, "访客读者", "#9a5b2e", "客", "以访客身份浏览", now(),
  );
  return (await getUser(env, uid))!;
}
