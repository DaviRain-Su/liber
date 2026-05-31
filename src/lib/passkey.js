// Passkey (通行密钥 / WebAuthn) sign-in — the browser half of the ceremony.
// Imperative, like wallet.js: run the WebAuthn ritual, POST the result to the
// backend, and persist the returned session token so /auth/me reports the
// reader as logged in. @simplewebauthn/browser handles the ArrayBuffer<->base64url
// plumbing around navigator.credentials.{create,get}.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api, setToken } from "./api.js";

// Remembers that this device has a Liber passkey, so returning readers go
// straight to the sign-in ritual instead of minting a second account.
const SEEN_KEY = "liber.passkey";

export function passkeySupported() {
  try { return browserSupportsWebAuthn(); } catch { return false; }
}

// Create a brand-new passkey + account, then sign in with it.
async function register() {
  const optionsJSON = await api.auth.passkey.registerOptions();
  const response = await startRegistration({ optionsJSON });
  const res = await api.auth.passkey.registerVerify(response);
  if (res?.token) setToken(res.token);
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
  return { user: res?.user, token: res?.token };
}

// Sign in with a passkey already registered to this account (incl. ones synced
// across the reader's devices via iCloud Keychain / Google Password Manager).
async function authenticate() {
  const optionsJSON = await api.auth.passkey.loginOptions();
  const response = await startAuthentication({ optionsJSON });
  const res = await api.auth.passkey.loginVerify(response);
  if (res?.token) setToken(res.token);
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
  return { user: res?.user, token: res?.token };
}

// One button, two intents. A device that has never made a Liber passkey creates
// one; a returning device signs in. We only auto-create after a sign-in attempt
// when the server no longer knows the credential (404) — never on a plain
// cancel — so a returning reader can't accidentally fork a second account.
export async function passkeyLogin() {
  if (!passkeySupported()) throw new Error("当前浏览器或环境不支持通行密钥");
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* ignore */ }
  if (!seen) return register();
  try {
    return await authenticate();
  } catch (err) {
    if (err?.status === 404) {
      try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
      return register();
    }
    throw err;
  }
}
