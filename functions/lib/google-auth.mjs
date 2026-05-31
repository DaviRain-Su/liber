// Verify a Google ID token (the JWT that Google Identity Services hands the
// browser). Pure-ish + unit-testable (test/google-auth.test.mjs): the JWKS fetch
// and clock are injectable. Workers' Web Crypto verifies RS256 natively, so this
// needs no extra dependency. Fails CLOSED — any problem returns null.
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISS = ["https://accounts.google.com", "accounts.google.com"];

function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// Best-effort per-isolate JWKS cache (1h) so we don't fetch Google's certs on
// every login. Stale keys just fall through to a re-fetch on the next miss.
let jwksCache = { at: 0, keys: null };
async function getGoogleJwks(nowSec) {
  if (jwksCache.keys && nowSec - jwksCache.at < 3600) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`google jwks ${res.status}`);
  const j = await res.json();
  jwksCache = { at: nowSec, keys: j.keys || [] };
  return jwksCache.keys;
}

// Returns { sub, email, emailVerified, name, picture } when the token is a valid,
// unexpired Google ID token issued for `clientId`; otherwise null.
// opts.jwks / opts.now are test seams.
export async function verifyGoogleIdToken(idToken, clientId, opts = {}) {
  try {
    if (!idToken || !clientId) return null;
    const parts = String(idToken).split(".");
    if (parts.length !== 3) return null;
    const header = b64urlToJson(parts[0]);
    const payload = b64urlToJson(parts[1]);
    if (header.alg !== "RS256") return null;

    const now = opts.now || Math.floor(Date.now() / 1000);
    if (!GOOGLE_ISS.includes(payload.iss)) return null;
    if (payload.aud !== clientId) return null;
    if (typeof payload.exp !== "number" || payload.exp < now - 5) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now + 5) return null;
    if (!payload.sub) return null;

    const keys = opts.jwks || (await getGoogleJwks(now));
    const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
    if (!ok) return null;

    return {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : "",
      emailVerified: payload.email_verified === true,
      name: payload.name ? String(payload.name) : "",
      picture: payload.picture ? String(payload.picture) : "",
    };
  } catch {
    return null;
  }
}
