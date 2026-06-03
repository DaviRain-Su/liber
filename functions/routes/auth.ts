import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env, Variables } from "../lib/types";
import {
  issueNonce,
  consumeNonce,
  verifyWalletSignature,
  createSession,
  deleteSession,
  upsertWalletUser,
  createGuestUser,
  getUser,
  createCliDevice,
  approveCliDevice,
  pollCliDevice,
  requireUser,
  createCliPublishToken,
} from "../lib/auth";
import {
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeyLoginOptions,
  passkeyLoginVerify,
} from "../lib/passkey";
import { readingStats } from "../lib/reading-summary";
import { chainById } from "../lib/chains";
import { verifyGoogleIdToken } from "../lib/google-auth.mjs";
import { sendOtpEmail } from "../lib/email";
import { loginMessage, sameSuiAddress } from "../lib/verify.mjs";
import { run, first, id, now } from "../lib/db";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const cookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

// 1) request a nonce + the message the wallet should sign
auth.post("/nonce", async (c) => {
  const nonce = await issueNonce(c.env);
  return c.json({ nonce, message: loginMessage(nonce) });
});

// 2) verify a wallet signature, then mint a session. `chain` selects which chain
// the wallet signed with (sui | evm | solana), defaulting to sui — so a Sui,
// Ethereum/EVM, or Solana wallet can all log in over the same endpoint. The same
// signed-message ⇄ nonce binding + single-use nonce guards apply to every chain.
auth.post("/verify", async (c) => {
  const { address, message, signature, nonce, chain } = await c.req.json();
  // Bind the signed message to the nonce: the signature must cover the exact
  // server-issued message template (see /nonce). Without this, message/nonce are
  // independent fields and a captured (message, signature) pair could be replayed
  // with a freshly requested nonce. The nonce itself is single-use (consumed).
  if (typeof message !== "string" || message !== loginMessage(nonce)) {
    return c.json({ error: "签名消息与 nonce 不匹配" }, 400);
  }
  if (!(await consumeNonce(c.env, nonce))) return c.json({ error: "nonce 无效或已过期" }, 400);
  const chainId = String(chain || "sui").toLowerCase();
  let signer: string | null;
  if (chainId === "evm" || chainId === "solana") {
    // The EVM/Solana adapters bind the recovered/verified signer to the claimed
    // address internally (ecrecover match / ed25519 verify), so a non-null return
    // already means "this address signed this message".
    signer = await chainById(chainId).verifySignature(message, signature, address);
    if (!signer) return c.json({ error: "签名验证失败：地址与签名不匹配" }, 401);
  } else {
    // Sui (default) — unchanged: verify via the active adapter, then normalize.
    signer = await verifyWalletSignature(c.env, message, signature, address);
    if (!signer || (address && !sameSuiAddress(signer, address))) {
      return c.json({ error: "签名验证失败：地址与签名不匹配" }, 401);
    }
  }
  const user = await upsertWalletUser(c.env, signer);
  const token = await createSession(c.env, user.id);
  setCookie(c, "liber_session", token, cookieOpts);
  return c.json({ token, user });
});

// Public config for the browser's Google Identity Services init. Null when Google
// login isn't configured (GOOGLE_CLIENT_ID unset) so the UI hides the button.
auth.get("/google/config", (c) => c.json({ clientId: c.env.GOOGLE_CLIENT_ID || null }));

// "Sign in with Google": the browser sends the ID token (a JWT) it got from GIS;
// we verify it against Google's keys (RS256) and our client id, then upsert a
// user keyed by the Google subject id and mint a session — same shape as /verify.
auth.post("/google", async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: "Google 登录未配置" }, 501);
  const { credential } = await c.req.json();
  const profile = await verifyGoogleIdToken(credential, clientId);
  if (!profile || !profile.sub) return c.json({ error: "Google 身份验证失败" }, 401);
  // The subject id is the stable identity; store it in the identity column (the
  // legacy `sui_address`, which already holds evm:/solana:/wallet ids — formats
  // can't collide). Profile fields are set only on first login, never overwritten.
  const key = `google:${profile.sub}`;
  let user = await first<any>(c.env.DB, `SELECT * FROM users WHERE sui_address = ?`, key);
  if (!user) {
    const uid = id("u_");
    const name = profile.name || (profile.email ? profile.email.split("@")[0] : "读者");
    const handle = (
      profile.email ? `@${profile.email.split("@")[0]}` : `@g_${profile.sub.slice(-8)}`
    ).slice(0, 24);
    await run(
      c.env.DB,
      `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at) VALUES (?,?,?,?,?,?,?,0,?)`,
      uid,
      key,
      handle,
      name,
      "#c0392b",
      [...name][0] || "G",
      "",
      now(),
    );
    user = await getUser(c.env, uid);
  }
  if (!user) return c.json({ error: "账户创建失败" }, 500);
  const token = await createSession(c.env, user.id);
  setCookie(c, "liber_session", token, cookieOpts);
  return c.json({ token, user });
});

// Email one-time-code login. /email/start sends a 6-digit code; /email/verify
// checks it and mints a session. Codes live in KV (single-use, 10-min TTL, with a
// per-email send throttle + attempt cap). When no email provider is configured
// (RESEND_API_KEY unset) the code is returned in `devCode` so the flow is testable.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

auth.post("/email/start", async (c) => {
  const { email } = await c.req.json();
  const addr = String(email || "")
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(addr) || addr.length > 200) return c.json({ error: "邮箱格式不正确" }, 400);
  if (await c.env.KV.get(`email-otp-rl:${addr}`))
    return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await c.env.KV.put(`email-otp:${addr}`, JSON.stringify({ code, attempts: 0 }), {
    expirationTtl: 600,
  });
  await c.env.KV.put(`email-otp-rl:${addr}`, "1", { expirationTtl: 60 }); // 60s = KV's TTL floor
  const mail = await sendOtpEmail(c.env, addr, code);
  // Only ever expose the code when nothing was actually emailed (binding absent).
  return c.json({
    ok: true,
    sent: mail.sent,
    devCode: mail.sent ? undefined : code,
    mailError: mail.error,
  });
});

auth.post("/email/verify", async (c) => {
  const { email, code } = await c.req.json();
  const addr = String(email || "")
    .trim()
    .toLowerCase();
  const raw = await c.env.KV.get(`email-otp:${addr}`);
  if (!raw) return c.json({ error: "验证码已过期，请重新获取" }, 400);
  let rec: any = null;
  try {
    rec = JSON.parse(raw);
  } catch {
    rec = null;
  }
  if (!rec) return c.json({ error: "验证码无效，请重新获取" }, 400);
  if (rec.attempts >= 5) {
    await c.env.KV.delete(`email-otp:${addr}`);
    return c.json({ error: "尝试次数过多，请重新获取" }, 429);
  }
  if (String(code || "").trim() !== rec.code) {
    await c.env.KV.put(
      `email-otp:${addr}`,
      JSON.stringify({ ...rec, attempts: (rec.attempts || 0) + 1 }),
      { expirationTtl: 600 },
    );
    return c.json({ error: "验证码不正确" }, 401);
  }
  await c.env.KV.delete(`email-otp:${addr}`);
  // Upsert a user keyed by the email (stored in the legacy identity column).
  const key = `email:${addr}`;
  let user = await first<any>(c.env.DB, `SELECT * FROM users WHERE sui_address = ?`, key);
  if (!user) {
    const uid = id("u_");
    const name = addr.split("@")[0] || "读者";
    await run(
      c.env.DB,
      `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at) VALUES (?,?,?,?,?,?,?,0,?)`,
      uid,
      key,
      `@${name}`.slice(0, 24),
      name,
      "#2e7d57",
      ([...name][0] || "M").toUpperCase(),
      "",
      now(),
    );
    user = await getUser(c.env, uid);
  }
  if (!user) return c.json({ error: "账户创建失败" }, 500);
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
  if (!user || user.is_guest || !user.sui_address)
    return c.json({ error: "需要钱包登录后才能授权 CLI" }, 401);
  const { deviceCode } = await c.req.json();
  if (!deviceCode) return c.json({ error: "缺少 CLI 授权码" }, 400);
  const result = await approveCliDevice(c.env, deviceCode, user);
  return c.json({ ok: true, expiresIn: result.expiresIn, wallet: user.sui_address });
});

auth.post("/cli/token", async (c) => {
  const uid = requireUser(c);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest || !user.sui_address)
    return c.json({ error: "需要钱包登录后才能签发 CLI 发布令牌" }, 401);
  const result = await createCliPublishToken(c.env, user);
  return c.json({
    ok: true,
    token: result.token,
    expiresIn: result.expiresIn,
    wallet: user.sui_address,
  });
});

auth.get("/me", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ user: null });
  const user = await getUser(c.env, uid);
  if (!user) return c.json({ user: null });
  if (user.is_guest) return c.json({ user: null });
  const stats = await readingStats(c.env, uid);
  // Parse the Turnkey embedded multi-chain addresses (Sui/Ethereum/Solana) for the UI.
  let turnkeyWallets: any = null;
  try {
    turnkeyWallets = (user as any).turnkey_addresses
      ? JSON.parse((user as any).turnkey_addresses)
      : null;
  } catch {
    /* ignore */
  }
  return c.json({
    user: { ...user, wallet: user.sui_address || "通行密钥", turnkeyWallets, stats },
  });
});

auth.put("/me", async (c) => {
  const uid = requireUser(c);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ error: "需要登录后才能编辑资料" }, 401);
  const body = await c.req.json();
  const clean = (v: unknown, max: number) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const name = clean(body.name, 32) || user.name || "读者";
  const handleRaw = clean(body.handle, 32).replace(/^@+/, "");
  const handleSlug = handleRaw.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 24);
  const handle = handleSlug ? `@${handleSlug}` : user.handle || `@${uid.slice(0, 8)}`;
  const bio = clean(body.bio, 160);
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || ""))
    ? String(body.color)
    : user.color || "#3a4fb0";
  const seal = clean(body.seal, 2).slice(0, 2) || name.slice(0, 1) || "读";
  await run(
    c.env.DB,
    `UPDATE users SET name = ?, handle = ?, bio = ?, color = ?, seal = ? WHERE id = ?`,
    name,
    handle,
    bio,
    color,
    seal,
    uid,
  );
  const next = await getUser(c.env, uid);
  const stats = await readingStats(c.env, uid);
  return c.json({ user: { ...next, wallet: next?.sui_address || "通行密钥", stats } });
});

export default auth;
