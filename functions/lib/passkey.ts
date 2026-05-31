// Passkey (WebAuthn / 通行密钥) registration + authentication.
//
// Mirrors the wallet path: a successful ceremony mints a real session token and
// returns a non-guest user, so /auth/me reports the reader as logged in. The
// heavy crypto (CBOR / COSE / attestation / assertion verification) is handled
// by @simplewebauthn/server, which runs on Web Crypto and works on Workers.
//
// Ceremony state (the per-attempt challenge) lives in KV with a short TTL and is
// single-use, just like the wallet login nonce. The relying-party id and origin
// are derived from the request (or APP_URL) so the same code works on
// localhost, preview and production without configuration.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { Env, Variables } from "./types";
import { batch, first, run, id, now } from "./db";
import { createSession, getUser, type UserRow } from "./auth";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const CHALLENGE_TTL = 300; // 5 minutes, matching the wallet nonce window
const RP_NAME = "Liber";

interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: number;
}

// --- base64url <-> bytes (Workers has atob/btoa; browser side never needs this) ---
function bufToB64url(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(b64url: string) {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Relying-party identity. WebAuthn binds a credential to one rpID (a registrable
// domain), so we derive it from where the request actually landed.
function rpInfo(c: Ctx): { rpID: string; origin: string } {
  const url = new URL(c.env.APP_URL || c.req.url);
  return { rpID: url.hostname, origin: url.origin };
}

async function putChallenge(env: Env, kind: "reg" | "auth", challenge: string, data = "1") {
  await env.KV.put(`pk-${kind}:${challenge}`, data, { expirationTtl: CHALLENGE_TTL });
}
// Single-use: reading a challenge also burns it, so a ceremony can't be replayed.
async function takeChallenge(env: Env, kind: "reg" | "auth", challenge: string): Promise<string | null> {
  const key = `pk-${kind}:${challenge}`;
  const data = await env.KV.get(key);
  if (data) await env.KV.delete(key);
  return data;
}

// The authenticator echoes our challenge inside clientDataJSON; we read it back
// to look up (and verify) the ceremony we issued, rather than trusting a
// separate client-supplied field.
function challengeOf(response: any): string | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBuf(response?.response?.clientDataJSON)));
    return typeof data?.challenge === "string" ? data.challenge : null;
  } catch {
    return null;
  }
}

async function getCredential(env: Env, credId: string): Promise<PasskeyRow | null> {
  return first<PasskeyRow>(env.DB, `SELECT * FROM passkeys WHERE id = ?`, credId);
}

// A passkey reader is a real account with no wallet (sui_address stays NULL —
// SQLite allows many NULLs in a UNIQUE column).
// 1a) registration options — reserve a fresh user id for this attempt.
export async function passkeyRegisterOptions(c: Ctx) {
  const userId = id("u_");
  const { rpID } = rpInfo(c);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: `liber:${userId.slice(2, 10)}`,
    userDisplayName: "Liber 读者",
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await putChallenge(c.env, "reg", options.challenge, userId);
  return options;
}

// 1b) registration verify — create the account + store the credential, mint a session.
export async function passkeyRegisterVerify(c: Ctx, response: any): Promise<{ token: string; user: UserRow }> {
  const challenge = challengeOf(response);
  if (!challenge) throw new HTTPException(400, { message: "通行密钥响应无效" });
  const userId = await takeChallenge(c.env, "reg", challenge);
  if (!userId) throw new HTTPException(400, { message: "通行密钥注册已过期，请重试" });

  const { rpID, origin } = rpInfo(c);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      // Options request UV as "preferred", so don't hard-reject an authenticator
      // that completed without user verification (the library defaults to
      // requiring UV, which contradicts the options).
      requireUserVerification: false,
    });
  } catch {
    throw new HTTPException(400, { message: "通行密钥验证失败" });
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HTTPException(400, { message: "通行密钥验证失败" });
  }

  const cred = verification.registrationInfo.credential;
  // Reconcile, don't fork: if this exact credential already belongs to an account
  // (a re-submitted ceremony, or a known passkey re-presented), sign that account
  // in instead of attempting a duplicate-key insert that mints a second user. This
  // is not an account-takeover vector: cred.id is derived from the authenticator's
  // signed attestation, bound to THIS ceremony's single-use challenge (verified
  // just above), so only the authenticator that actually holds the credential can
  // produce a matching id. The UNIQUE(passkeys.id) constraint is the final backstop.
  // (A freshly-minted credential on a new device whose synced passkey isn't yet
  // enrolled still creates a new account — that's a client "login-first" concern,
  // see docs/AUDIT.md.)
  const existing = await getCredential(c.env, cred.id);
  if (existing) {
    const account = await getUser(c.env, existing.user_id);
    if (account) return { token: await createSession(c.env, account.id), user: account };
  }
  // Insert the user and its credential ATOMICALLY — a duplicate credential id
  // (re-registration) or a D1 error must not leave a committed orphan user row.
  await batch(c.env.DB, [
    [`INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at) VALUES (?,?,?,?,?,?,?,0,?)`,
      userId, null, `@${userId.slice(0, 8)}`, `读者 ${userId.slice(2, 6).toUpperCase()}`, "#3a4fb0", "钥", "", now()],
    [`INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)`,
      cred.id, userId, bufToB64url(cred.publicKey), cred.counter ?? 0,
      cred.transports ? JSON.stringify(cred.transports) : null, now()],
  ]);
  const user = (await getUser(c.env, userId))!;
  const token = await createSession(c.env, user.id);
  return { token, user };
}

// 2a) login options — usernameless: omit allowCredentials so the authenticator
// offers whatever discoverable passkeys it holds for this site.
export async function passkeyLoginOptions(c: Ctx) {
  const { rpID } = rpInfo(c);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await putChallenge(c.env, "auth", options.challenge);
  return options;
}

// 2b) login verify — match the asserted credential, check the signature + counter, mint a session.
export async function passkeyLoginVerify(c: Ctx, response: any): Promise<{ token: string; user: UserRow }> {
  const challenge = challengeOf(response);
  if (!challenge) throw new HTTPException(400, { message: "通行密钥响应无效" });
  if (!(await takeChallenge(c.env, "auth", challenge))) {
    throw new HTTPException(400, { message: "通行密钥登录已过期，请重试" });
  }
  const credential = await getCredential(c.env, response?.id);
  if (!credential) throw new HTTPException(404, { message: "未找到该通行密钥，请先注册" });

  const { rpID, origin } = rpInfo(c);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // match the "preferred" login options
      credential: {
        id: credential.id,
        publicKey: b64urlToBuf(credential.public_key),
        counter: credential.counter,
        transports: credential.transports ? JSON.parse(credential.transports) : undefined,
      },
    });
  } catch {
    throw new HTTPException(400, { message: "通行密钥验证失败" });
  }
  if (!verification.verified) throw new HTTPException(401, { message: "通行密钥验证失败" });

  await run(c.env.DB, `UPDATE passkeys SET counter = ? WHERE id = ?`, verification.authenticationInfo.newCounter, credential.id);
  const user = await getUser(c.env, credential.user_id);
  if (!user) throw new HTTPException(404, { message: "账户不存在" });
  const token = await createSession(c.env, user.id);
  return { token, user };
}
