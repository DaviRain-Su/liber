// Identity & sessions.
//
// PRAGMATIC-FIRST: identity in D1, sessions in KV, no chain writes. Guest auth
// works today; Sui wallet-signature verification is handled server-side through
// the chain adapter, while wallet UI stays in the frontend Wallet Standard layer.
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { Env, Variables } from "./types";
import { first, run, id, now } from "./db";
import { chain } from "./chains";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const NONCE_TTL = 300; // 5 minutes
const CLI_DEVICE_TTL = 10 * 60; // 10 minutes
const CLI_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

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

// Verify a wallet login signature via the active chain adapter; returns the
// signer's canonical address or null. Chain-agnostic — switch chains with CHAIN.
export async function verifyWalletSignature(env: Env, message: string, signature: string, address?: string): Promise<string | null> {
  return chain(env).verifySignature(message, signature, address);
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.KV.put(`sess:${token}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}

function userCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export interface CliDevice {
  deviceCode: string;
  userCode: string;
  createdAt: number;
  expiresAt: number;
}

export async function createCliDevice(env: Env): Promise<CliDevice> {
  const deviceCode = crypto.randomUUID();
  const nowMs = Date.now();
  const device = { deviceCode, userCode: userCode(), createdAt: nowMs, expiresAt: nowMs + CLI_DEVICE_TTL * 1000 };
  await env.KV.put(`cli-device:${deviceCode}`, JSON.stringify(device), { expirationTtl: CLI_DEVICE_TTL });
  return device;
}

export interface CliPublishToken {
  userId: string;
  wallet: string | null;
  createdAt: number;
}

export async function getCliPublishToken(env: Env, token?: string | null): Promise<CliPublishToken | null> {
  if (!token) return null;
  const raw = await env.KV.get(`cli-publish:${token}`);
  return raw ? JSON.parse(raw) : null;
}

export async function createCliPublishToken(env: Env, user: UserRow): Promise<{ token: string; expiresIn: number }> {
  const token = crypto.randomUUID();
  const payload = { userId: user.id, wallet: user.sui_address, createdAt: Date.now() };
  await env.KV.put(`cli-publish:${token}`, JSON.stringify(payload), { expirationTtl: CLI_TOKEN_TTL });
  return { token, expiresIn: CLI_TOKEN_TTL };
}

// Constant-time string compare — avoids leaking ADMIN_TOKEN via response timing.
export function constantTimeEqual(a?: string | null, b?: string | null): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Extract a Bearer token from the Authorization header, or null.
export function bearerToken(c: Ctx): string | null {
  const auth = c.req.header("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

// True when the token is the platform ADMIN_TOKEN (constant-time).
export function hasAdminToken(env: Env, token?: string | null): boolean {
  return !!env.ADMIN_TOKEN && constantTimeEqual(token, env.ADMIN_TOKEN);
}

// Authorization for infra/cost endpoints (platform jobs, graph backfill/maintenance):
// the ADMIN_TOKEN, or a CLI publish token whose wallet is allow-listed in
// ADMIN_WALLETS. A self-minted CLI token from an arbitrary wallet user is NOT
// admin — that was the privilege-escalation hole. CLI *book publishing* is gated
// separately (see books.ingestAuth) and still accepts any CLI token.
export async function isPlatformAdmin(env: Env, token?: string | null): Promise<boolean> {
  if (hasAdminToken(env, token)) return true;
  const allow = new Set(
    (env.ADMIN_WALLETS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  if (!allow.size) return false;
  const cli = await getCliPublishToken(env, token);
  return !!(cli && cli.wallet && allow.has(cli.wallet.toLowerCase()));
}

export async function approveCliDevice(env: Env, deviceCode: string, user: UserRow): Promise<{ token: string; expiresIn: number }> {
  const raw = await env.KV.get(`cli-device:${deviceCode}`);
  if (!raw) throw new Error("CLI 授权请求不存在或已过期");
  const { token, expiresIn } = await createCliPublishToken(env, user);
  await env.KV.put(
    `cli-device-result:${deviceCode}`,
    JSON.stringify({ status: "approved", token, expiresIn, user: { id: user.id, wallet: user.sui_address, name: user.name } }),
    { expirationTtl: CLI_DEVICE_TTL },
  );
  return { token, expiresIn };
}

export async function pollCliDevice(env: Env, deviceCode: string): Promise<any> {
  const result = await env.KV.get(`cli-device-result:${deviceCode}`);
  if (result) return JSON.parse(result);
  const pending = await env.KV.get(`cli-device:${deviceCode}`);
  if (pending) return { status: "pending" };
  return { status: "expired" };
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
