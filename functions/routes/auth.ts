import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env, Variables } from "../lib/types";
import {
  issueNonce, consumeNonce, verifyWalletSignature, createSession, deleteSession,
  upsertWalletUser, createGuestUser, getUser, createCliDevice, approveCliDevice,
  pollCliDevice, requireUser, createCliPublishToken,
} from "../lib/auth";
import {
  passkeyRegisterOptions, passkeyRegisterVerify, passkeyLoginOptions, passkeyLoginVerify,
} from "../lib/passkey";
import { readingStats } from "../lib/reading-summary";
import { loginMessage } from "../lib/verify.mjs";
import { run } from "../lib/db";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const cookieOpts = { httpOnly: true, secure: true, sameSite: "Lax" as const, maxAge: 60 * 60 * 24 * 30, path: "/" };

// 1) request a nonce + the message the wallet should sign
auth.post("/nonce", async (c) => {
  const nonce = await issueNonce(c.env);
  return c.json({ nonce, message: loginMessage(nonce) });
});

// 2) verify a wallet signature via the active chain adapter, then mint a session.
auth.post("/verify", async (c) => {
  const { address, message, signature, nonce } = await c.req.json();
  // Bind the signed message to the nonce: the signature must cover the exact
  // server-issued message template (see /nonce). Without this, message/nonce are
  // independent fields and a captured (message, signature) pair could be replayed
  // with a freshly requested nonce. The nonce itself is single-use (consumed).
  if (typeof message !== "string" || message !== loginMessage(nonce)) {
    return c.json({ error: "签名消息与 nonce 不匹配" }, 400);
  }
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

// passkey (通行密钥 / WebAuthn) — register a new credential+account, or log in
// with an existing one. Both verify paths mint a session like /verify above.
auth.post("/passkey/register/options", async (c) => c.json(await passkeyRegisterOptions(c)));

auth.post("/passkey/register/verify", async (c) => {
  const { response } = await c.req.json();
  const { token, user } = await passkeyRegisterVerify(c, response);
  setCookie(c, "liber_session", token, cookieOpts);
  return c.json({ token, user });
});

auth.post("/passkey/login/options", async (c) => c.json(await passkeyLoginOptions(c)));

auth.post("/passkey/login/verify", async (c) => {
  const { response } = await c.req.json();
  const { token, user } = await passkeyLoginVerify(c, response);
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

auth.post("/cli/start", async (c) => {
  const device = await createCliDevice(c.env);
  const origin = new URL(c.req.url).origin;
  return c.json({
    ...device,
    interval: 2,
    authorizeUrl: `${origin}/?cli_auth=${encodeURIComponent(device.deviceCode)}&code=${encodeURIComponent(device.userCode)}`,
  });
});

auth.get("/cli/poll/:device", async (c) => {
  return c.json(await pollCliDevice(c.env, c.req.param("device")));
});

auth.post("/cli/approve", async (c) => {
  const uid = requireUser(c);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest || !user.sui_address) return c.json({ error: "需要钱包登录后才能授权 CLI" }, 401);
  const { deviceCode } = await c.req.json();
  if (!deviceCode) return c.json({ error: "缺少 CLI 授权码" }, 400);
  const result = await approveCliDevice(c.env, deviceCode, user);
  return c.json({ ok: true, expiresIn: result.expiresIn, wallet: user.sui_address });
});

auth.post("/cli/token", async (c) => {
  const uid = requireUser(c);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest || !user.sui_address) return c.json({ error: "需要钱包登录后才能签发 CLI 发布令牌" }, 401);
  const result = await createCliPublishToken(c.env, user);
  return c.json({ ok: true, token: result.token, expiresIn: result.expiresIn, wallet: user.sui_address });
});

auth.get("/me", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ user: null });
  const user = await getUser(c.env, uid);
  if (!user) return c.json({ user: null });
  if (user.is_guest) return c.json({ user: null });
  const stats = await readingStats(c.env, uid);
  return c.json({ user: { ...user, wallet: user.sui_address || "通行密钥", stats } });
});

auth.put("/me", async (c) => {
  const uid = requireUser(c);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ error: "需要登录后才能编辑资料" }, 401);
  const body = await c.req.json();
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(body.name, 32) || user.name || "读者";
  const handleRaw = clean(body.handle, 32).replace(/^@+/, "");
  const handleSlug = handleRaw.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 24);
  const handle = handleSlug ? `@${handleSlug}` : user.handle || `@${uid.slice(0, 8)}`;
  const bio = clean(body.bio, 160);
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || "")) ? String(body.color) : user.color || "#3a4fb0";
  const seal = clean(body.seal, 2).slice(0, 2) || name.slice(0, 1) || "读";
  await run(
    c.env.DB,
    `UPDATE users SET name = ?, handle = ?, bio = ?, color = ?, seal = ? WHERE id = ?`,
    name, handle, bio, color, seal, uid,
  );
  const next = await getUser(c.env, uid);
  const stats = await readingStats(c.env, uid);
  return c.json({ user: { ...next, wallet: next?.sui_address || "通行密钥", stats } });
});

export default auth;
