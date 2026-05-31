// Behavioral tests for the Google ID-token verifier (functions/lib/google-auth.mjs).
// Auth boundary: a regression here either locks out real Google users or, worse,
// accepts forged tokens. We mint real RS256 JWTs with a throwaway key and inject
// the public JWK, so no live Google call is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleIdToken } from "../functions/lib/google-auth.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const enc = (obj) => b64url(Buffer.from(JSON.stringify(obj)));

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}
async function sign(payload, priv, kid = "test-kid") {
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc(payload);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, priv, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const CLIENT = "1021328086145-test.apps.googleusercontent.com";
const NOW = 1_700_000_000;
const base = () => ({ iss: "https://accounts.google.com", aud: CLIENT, sub: "117823", exp: NOW + 3600, email: "reader@gmail.com", email_verified: true, name: "读者 Ada", picture: "https://x/p.png" });

test("accepts a valid Google ID token and returns the profile", async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey); jwk.kid = "test-kid";
  const r = await verifyGoogleIdToken(await sign(base(), kp.privateKey), CLIENT, { jwks: [jwk], now: NOW });
  assert.equal(r?.sub, "117823");
  assert.equal(r.email, "reader@gmail.com");
  assert.equal(r.name, "读者 Ada");
  assert.equal(r.emailVerified, true);
});

test("rejects wrong audience, wrong issuer, and expired tokens", async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey); jwk.kid = "test-kid";
  const v = (p) => verifyGoogleIdToken(p, CLIENT, { jwks: [jwk], now: NOW });
  assert.equal(await v(await sign({ ...base(), aud: "someone-else.apps.googleusercontent.com" }, kp.privateKey)), null);
  assert.equal(await v(await sign({ ...base(), iss: "https://evil.example" }, kp.privateKey)), null);
  assert.equal(await v(await sign({ ...base(), exp: NOW - 3600 }, kp.privateKey)), null);
});

test("rejects a token signed by a DIFFERENT key (forgery)", async () => {
  const real = await makeKeyPair();
  const attacker = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", real.publicKey); jwk.kid = "test-kid";
  // signed by attacker, but verified against the real key's JWKS → must fail
  const forged = await sign(base(), attacker.privateKey);
  assert.equal(await verifyGoogleIdToken(forged, CLIENT, { jwks: [jwk], now: NOW }), null);
});

test("malformed inputs return null, never throw", async () => {
  assert.equal(await verifyGoogleIdToken("", CLIENT, { jwks: [], now: NOW }), null);
  assert.equal(await verifyGoogleIdToken("a.b", CLIENT, { jwks: [], now: NOW }), null);
  assert.equal(await verifyGoogleIdToken("not-a-jwt", CLIENT, { jwks: [], now: NOW }), null);
  assert.equal(await verifyGoogleIdToken("x.y.z", CLIENT, { jwks: [], now: NOW }), null);
});
