import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env, Variables } from "../lib/types";
import {
  issueNonce, consumeNonce, verifyWalletSignature, createSession, deleteSession,
  upsertWalletUser, createGuestUser, getUser,
} from "../lib/auth";
import { first } from "../lib/db";
import * as S from "../lib/seed";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const cookieOpts = { httpOnly: true, secure: true, sameSite: "Lax" as const, maxAge: 60 * 60 * 24 * 30, path: "/" };

// 1) request a nonce + the message the wallet should sign
auth.post("/nonce", async (c) => {
  const nonce = await issueNonce(c.env);
  return c.json({ nonce, message: `Liber 登录\nnonce: ${nonce}` });
});

// 2) verify a wallet signature (P4) — wired but verification stubbed for now
auth.post("/verify", async (c) => {
  const { address, message, signature, nonce } = await c.req.json();
  if (!(await consumeNonce(c.env, nonce))) return c.json({ error: "nonce 无效或已过期" }, 400);
  const signer = await verifyWalletSignature(c.env, message, signature, address);
  if (!signer || (address && signer !== address)) {
    return c.json({ error: "签名验证失败：地址与签名不匹配" }, 401);
  }
  const user = await upsertWalletUser(c.env, signer);
  const token = await createSession(c.env, user.id);
  setCookie(c, "liber_session", token, cookieOpts);
  return c.json({ token, user });
});

// guest session — the working login path today
auth.post("/guest", async (c) => {
  const user = await createGuestUser(c.env);
  const token = await createSession(c.env, user.id);
  setCookie(c, "liber_session", token, cookieOpts);
  return c.json({ token, user });
});

auth.post("/logout", async (c) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  await deleteSession(c.env, token);
  setCookie(c, "liber_session", "", { ...cookieOpts, maxAge: 0 });
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ user: null });
  const user = await getUser(c.env, uid);
  if (!user) return c.json({ user: null });
  const hl = await first(c.env.DB, `SELECT COUNT(*) AS n FROM highlights WHERE user_id = ?`, uid);
  const nt = await first(c.env.DB, `SELECT COUNT(*) AS n FROM notes WHERE user_id = ?`, uid);
  const stats = { ...S.ME.stats, lines: hl?.n || 0, notes: nt?.n || 0 };
  return c.json({ user: { ...user, wallet: user.sui_address, stats } });
});

export default auth;
