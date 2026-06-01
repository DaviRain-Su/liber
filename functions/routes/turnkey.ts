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
import { bearerToken, hasAdminToken, createSession } from "../lib/auth";
import { turnkeyConfigured, createSubOrgWithSuiWallet, getWalletAccount, signRawPayload } from "../lib/turnkey";
import { suiAddressFromEd25519Pubkey, suiPersonalMessageDigestHex, assembleSuiSignature } from "../lib/turnkey-sui";
import { upsertTurnkeyUser } from "../lib/turnkey-auth";
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

export default turnkey;
