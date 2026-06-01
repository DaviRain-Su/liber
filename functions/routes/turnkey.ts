// Turnkey embedded-wallet PROTOTYPE route (admin-gated, off until configured).
// POST /api/turnkey/spike runs the full live loop end to end:
//   create a sub-org with a Sui wallet → fetch its ed25519 pubkey → sign a Sui
//   login challenge via Turnkey signRawPayload → assemble Sui's serialized
//   signature → verify it with Liber's own verifyPersonalMessageSignature.
// It echoes the raw Turnkey responses (debug) so any field-name drift can be fixed
// against the real API on the first run. Creating sub-orgs is gated behind
// ADMIN_TOKEN so it can't be triggered by the public.
import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { bearerToken, hasAdminToken, createSession, getUser } from "../lib/auth";
import { id, now, run, first } from "../lib/db";
import { turnkeyConfigured, createSubOrgWithSuiWallet, getWalletAccount, signRawPayload } from "../lib/turnkey";
import { suiAddressFromEd25519Pubkey, suiPersonalMessageDigestHex, assembleSuiSignature } from "../lib/turnkey-sui";
import { upsertTurnkeyUser, ensureTurnkeyWallet } from "../lib/turnkey-auth";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

const turnkey = new Hono<{ Bindings: Env; Variables: Variables }>();

turnkey.post("/spike", async (c) => {
  const env = c.env;
  if (!hasAdminToken(env, bearerToken(c))) return c.json({ error: "unauthorized" }, 401);
  if (!turnkeyConfigured(env)) {
    return c.json({ error: "turnkey_not_configured", need: ["TURNKEY_ORG_ID", "TURNKEY_API_PUBLIC_KEY", "TURNKEY_API_PRIVATE_KEY (secret)"] }, 501);
  }

  const debug: any = {};
  try {
    // 1. Create a per-user sub-organization holding a Sui (ed25519) wallet.
    const created = await createSubOrgWithSuiWallet(env, `liber-spike-${Date.now()}`);
    debug.create = created.result;
    const r = created.result?.createSubOrganizationResultV7 || created.result?.createSubOrganizationResult || created.result || {};
    const subOrgId = r.subOrganizationId;
    const walletId = r.wallet?.walletId;
    const suiAddress = (r.wallet?.addresses || [])[0];
    if (!subOrgId || !walletId || !suiAddress) return c.json({ ok: false, step: "create_sub_org", error: "missing subOrgId/walletId/address — check field names", debug }, 502);

    // 2. Fetch the wallet account to get its raw ed25519 public key (needed to assemble).
    const acct = await getWalletAccount(env, subOrgId, walletId, suiAddress);
    debug.account = acct;
    const pubkeyHex = acct?.account?.publicKey || acct?.publicKey;
    if (!pubkeyHex) return c.json({ ok: false, step: "get_wallet_account", error: "missing publicKey — check field names", debug }, 502);
    const derivedAddr = suiAddressFromEd25519Pubkey(pubkeyHex);

    // 3. Build a Sui login challenge, compute its digest, sign it via Turnkey.
    const challenge = `Liber 登录确认\ndomain: liber-99x.pages.dev\nsub: ${subOrgId}\nnonce: ${crypto.randomUUID()}`;
    const digestHex = suiPersonalMessageDigestHex(challenge);
    const signed = await signRawPayload(env, subOrgId, suiAddress, digestHex);
    debug.sign = signed.result;
    const sr = signed.result?.signRawPayloadResult || signed.result || {};
    if (!sr.r || !sr.s) return c.json({ ok: false, step: "sign_raw_payload", error: "missing r/s — check field names", debug }, 502);

    // 4. Assemble Sui's serialized signature and verify it with Liber's own verifier.
    const signature = assembleSuiSignature(sr.r, sr.s, pubkeyHex);
    const recovered = await verifyPersonalMessageSignature(new TextEncoder().encode(challenge), signature);
    const recoveredAddr = recovered.toSuiAddress();

    // 5. Bridge to a Liber account: find/create the user, link the sub-org, mint a
    // Liber session (proves the Phase 0 foundation: Turnkey sub-org → Liber session).
    const { user, isNew } = await upsertTurnkeyUser(env, { identityKey: suiAddress, subOrgId, suiAddress });
    const liberToken = await createSession(env, user.id);

    return c.json({
      ok: true,
      verified: recoveredAddr === suiAddress && derivedAddr === suiAddress,
      subOrgId,
      suiAddress,
      derivedAddr,
      recoveredAddr,
      pubkeyHex,
      challenge,
      signature,
      liberToken,
      liberUserId: user.id,
      isNewUser: isNew,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e), debug }, 500);
  }
});

// Give the logged-in user a Turnkey embedded Sui wallet if they don't have one
// (idempotent). The frontend calls this once after login. Wallet-connect users and
// guests are no-ops.
turnkey.post("/ensure", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  try {
    const res = await ensureTurnkeyWallet(c.env, user);
    return c.json({ ok: true, provisioned: !!res, suiAddress: res?.suiAddress ?? (user as any).turnkey_sui_address ?? null });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// Admin self-test: make a synthetic wallet-less email user, then provision. Proves
// the bolt-on path without an interactive login.
turnkey.post("/ensure-test", async (c) => {
  const env = c.env;
  if (!hasAdminToken(env, bearerToken(c))) return c.json({ error: "unauthorized" }, 401);
  if (!turnkeyConfigured(env)) return c.json({ error: "turnkey_not_configured" }, 501);
  const uid = id("u_");
  const identityKey = `email:tk-test-${uid}@example.com`;
  await run(
    env.DB,
    `INSERT INTO users (id, sui_address, handle, name, color, seal, bio, is_guest, created_at) VALUES (?,?,?,?,?,?,?,0,?)`,
    uid, identityKey, `@${uid}`, "Turnkey 测试用户", "#2e7d57", "测", "", now(),
  );
  try {
    const user = await getUser(env, uid);
    const res = await ensureTurnkeyWallet(env, user!);
    const after = await first<any>(env.DB, `SELECT turnkey_sub_org_id, turnkey_sui_address FROM users WHERE id = ?`, uid);
    return c.json({ ok: true, identityKey, provisioned: !!res, suiAddress: res?.suiAddress ?? null, linked: after });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

export default turnkey;
