// Pure security/verification helpers, shared by the routes and unit-tested in
// test/verify.test.mjs. Written as plain ESM JS (not .ts) so `node --test` on
// CI (node 20, no type-stripping) can import it directly; the .ts routes import
// it via allowJs. These are the app's highest-value money/auth checks, so they
// live in one tested place rather than inline in route handlers.
import { normalizeSuiAddress } from "@mysten/sui/utils";

// Constant-time string compare — avoids leaking a secret (ADMIN_TOKEN, an HMAC)
// via response timing. Returns false for non-strings or length mismatch.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function hmacHex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe webhook signature: HMAC-SHA256 over `${t}.${body}`, compared in
// constant time against any v1 signature in the stripe-signature header.
export async function validStripeSignature(secret, header, body) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !sigs.length) return false;
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return sigs.some((sig) => timingSafeEqual(sig, expected));
}

export function ownerAddress(owner) {
  if (typeof owner === "string") return owner;
  if (owner?.AddressOwner) return owner.AddressOwner;
  if (owner?.addressOwner) return owner.addressOwner;
  return null;
}

export function sameSuiAddress(a, b) {
  if (!a || !b) return false;
  try {
    return normalizeSuiAddress(a) === normalizeSuiAddress(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

// True when `balanceChanges` shows at least `amount` (atomic units) of
// `coinType` credited to `treasury`. Mirrors the /crypto/confirm payment check
// so a forged/short/wrong-coin transfer cannot unlock Pro.
export function paymentReceived(balanceChanges, { coinType, treasury, amount }) {
  let need;
  try { need = BigInt(amount); } catch { return false; }
  return (balanceChanges || []).some((bc) => {
    if (bc.coinType !== coinType) return false;
    if (!sameSuiAddress(ownerAddress(bc.owner), treasury)) return false;
    try { return BigInt(bc.amount) >= need; } catch { return false; }
  });
}

// The exact message a wallet must sign to log in. Issued by /auth/nonce and
// re-derived by /auth/verify, which rejects a signature whose message does not
// equal this — binding the signature to the single-use nonce (anti-replay).
export function loginMessage(nonce) {
  return `Liber 登录\nnonce: ${nonce}`;
}
