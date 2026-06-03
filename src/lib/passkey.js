// Passkey (通行密钥 / WebAuthn) sign-in — the browser half of the ceremony.
// Imperative, like wallet.js: run the WebAuthn ritual, POST the result to the
// backend, and persist the returned session token so /auth/me reports the
// reader as logged in. @simplewebauthn/browser handles the ArrayBuffer<->base64url
// plumbing around navigator.credentials.{create,get}.
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { api, setToken } from "./api.js";

// Remembers that this device has a Liber passkey, so returning readers go
// straight to the sign-in ritual instead of minting a second account.
const SEEN_KEY = "liber.passkey";

export function passkeySupported() {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

// Create a brand-new passkey + account, then sign in with it.
async function register() {
  const optionsJSON = await api.auth.passkey.registerOptions();
  const response = await startRegistration({ optionsJSON });
  const res = await api.auth.passkey.registerVerify(response);
  if (res?.token) setToken(res.token);
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
  return { user: res?.user, token: res?.token };
}

// Sign in with a passkey already registered to this account (incl. ones synced
// across the reader's devices via iCloud Keychain / Google Password Manager).
async function authenticate() {
  const optionsJSON = await api.auth.passkey.loginOptions();
  const response = await startAuthentication({ optionsJSON });
  const res = await api.auth.passkey.loginVerify(response);
  if (res?.token) setToken(res.token);
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
  return { user: res?.user, token: res?.token };
}

// Sign in with an EXISTING passkey (including iCloud/Google-synced ones). Uses
// discoverable credentials, so a returning reader on a brand-new device — even one
// whose localStorage was never set — signs into their existing account instead of
// forking a second one. Throws if there's no usable passkey (caller offers create).
export async function passkeySignIn() {
  if (!passkeySupported()) throw new Error("当前浏览器或环境不支持通行密钥");
  return authenticate();
}

// Explicitly create a new passkey + account. For first-time readers — this is the
// only path that should ever mint a new account, so it can't be hit by accident.
export async function passkeyCreate() {
  if (!passkeySupported()) throw new Error("当前浏览器或环境不支持通行密钥");
  return register();
}

// Back-compat single-button entry: try a discoverable sign-in FIRST so a synced
// passkey logs into its existing account (no fork); only create when there's
// genuinely no passkey to use. The UI prefers the explicit passkeySignIn /
// passkeyCreate pair so the user's intent (sign in vs. create) is never guessed.
export async function passkeyLogin() {
  if (!passkeySupported()) throw new Error("当前浏览器或环境不支持通行密钥");
  try {
    return await authenticate();
  } catch (err) {
    // No usable passkey for this site (none enrolled, or the empty picker was
    // dismissed) → create one. The server reconciles a duplicate credential id to
    // its existing account, so even a re-presented passkey can't fork.
    if (err?.status === 404 || err?.name === "NotAllowedError") return register();
    throw err;
  }
}
