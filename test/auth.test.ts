// Behavioral tests for the security-critical auth helpers in functions/lib/auth.ts.
// Run via tsx (node --import tsx) so the .ts is loaded directly. A Map-backed KV
// stub lets us exercise the real logic without a live Cloudflare binding.
import test from "node:test";
import assert from "node:assert/strict";
import {
  issueNonce,
  consumeNonce,
  hasAdminToken,
  isPlatformAdmin,
  createCliPublishToken,
  getCliPublishToken,
} from "../functions/lib/auth.ts";

function fakeKV() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

test("nonce is single-use (anti-replay)", async () => {
  const env = { KV: fakeKV() };
  const nonce = await issueNonce(env);
  assert.equal(await consumeNonce(env, nonce), true); // first use accepted
  assert.equal(await consumeNonce(env, nonce), false); // replay rejected — already consumed
  assert.equal(await consumeNonce(env, "never-issued"), false);
  assert.equal(await consumeNonce(env, null), false);
  assert.equal(await consumeNonce(env, undefined), false);
});

test("hasAdminToken: matches only the configured ADMIN_TOKEN", () => {
  assert.equal(hasAdminToken({ ADMIN_TOKEN: "s3cret" }, "s3cret"), true);
  assert.equal(hasAdminToken({ ADMIN_TOKEN: "s3cret" }, "wrong"), false);
  assert.equal(hasAdminToken({ ADMIN_TOKEN: "s3cret" }, "s3cre"), false); // length mismatch
  assert.equal(hasAdminToken({ ADMIN_TOKEN: "" }, ""), false); // unset → never admin
  assert.equal(hasAdminToken({}, "anything"), false);
  assert.equal(hasAdminToken({ ADMIN_TOKEN: "s3cret" }, null), false);
});

test("getCliPublishToken round-trips through KV", async () => {
  const env = { KV: fakeKV() };
  const { token } = await createCliPublishToken(env, { id: "u1", sui_address: "0xABC" });
  const got = await getCliPublishToken(env, token);
  assert.equal(got?.userId, "u1");
  assert.equal(got?.wallet, "0xABC");
  assert.equal(await getCliPublishToken(env, "not-a-token"), null);
  assert.equal(await getCliPublishToken(env, null), null);
});

test("isPlatformAdmin: admin token or ADMIN_WALLETS-listed CLI token only", async () => {
  const env = { KV: fakeKV(), ADMIN_TOKEN: "adm", ADMIN_WALLETS: "0xAAA, 0xCCC" };

  // the platform admin token
  assert.equal(await isPlatformAdmin(env, "adm"), true);

  // a self-minted CLI token from a NON-listed wallet is NOT admin (the
  // privilege-escalation hole the audit fixed)
  const { token: tB } = await createCliPublishToken(env, { id: "uB", sui_address: "0xBBB" });
  assert.equal(await isPlatformAdmin(env, tB), false);

  // a CLI token from an allow-listed wallet IS admin (case-insensitive)
  const { token: tA } = await createCliPublishToken(env, { id: "uA", sui_address: "0xAAA" });
  assert.equal(await isPlatformAdmin(env, tA), true);

  assert.equal(await isPlatformAdmin(env, "garbage"), false);
  assert.equal(await isPlatformAdmin(env, null), false);
});

test("isPlatformAdmin: with no ADMIN_WALLETS, only the admin token works", async () => {
  const env = { KV: fakeKV(), ADMIN_TOKEN: "adm" };
  const { token } = await createCliPublishToken(env, { id: "u", sui_address: "0xAAA" });
  assert.equal(await isPlatformAdmin(env, token), false); // no allowlist → CLI token never admin
  assert.equal(await isPlatformAdmin(env, "adm"), true);
});
