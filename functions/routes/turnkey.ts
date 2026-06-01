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
import { turnkeyConfigured, createSubOrgWithSuiWallet, provisionWallets, getWalletAccount, signRawPayload } from "../lib/turnkey";
import { suiAddressFromEd25519Pubkey, suiPersonalMessageDigestHex, suiTransactionDigestHex, assembleSuiSignature } from "../lib/turnkey-sui";
import { upsertTurnkeyUser, ensureTurnkeyWallet } from "../lib/turnkey-auth";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { evmAddressFromSignature, verifyEd25519, verifySecp256k1 } from "../lib/turnkey-verify";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";

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
    return c.json({ ok: true, provisioned: !!res, wallets: res?.addresses ?? null });
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
    const after = await first<any>(env.DB, `SELECT turnkey_sub_org_id, turnkey_wallet_id, turnkey_addresses FROM users WHERE id = ?`, uid);
    return c.json({ ok: true, identityKey, provisioned: !!res, wallets: res?.addresses ?? null, linked: after });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// Admin: provision a fresh embedded wallet and return its ids + addresses (so a
// testnet address can be funded out-of-band before the transfer test).
turnkey.post("/provision", async (c) => {
  const env = c.env;
  if (!hasAdminToken(env, bearerToken(c))) return c.json({ error: "unauthorized" }, 401);
  if (!turnkeyConfigured(env)) return c.json({ error: "turnkey_not_configured" }, 501);
  try {
    const p = await provisionWallets(env, `liber-prov-${Date.now()}`);
    return c.json({ ok: true, subOrgId: p.subOrgId, walletId: p.walletId, addresses: p.addresses });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// Admin demo: prove an embedded wallet can SIGN + EXECUTE a real transfer on Sui
// TESTNET. Pass a {subOrgId, walletId, suiAddress} (from /provision) whose Sui
// testnet address has already been funded; this builds a tiny self-transfer, signs
// it via Turnkey (server/custodial), and executes. Fast (no faucet/poll) so the
// request doesn't get retried.
turnkey.post("/sui-transfer-test", async (c) => {
  const env = c.env;
  if (!hasAdminToken(env, bearerToken(c))) return c.json({ error: "unauthorized" }, 401);
  if (!turnkeyConfigured(env)) return c.json({ error: "turnkey_not_configured" }, 501);
  const body: any = await c.req.json().catch(() => ({}));
  const subOrgId = String(body?.subOrgId || ""), walletId = String(body?.walletId || ""), suiAddress = String(body?.suiAddress || "");
  if (!subOrgId || !walletId || !suiAddress) return c.json({ ok: false, error: "need subOrgId, walletId, suiAddress (from /provision; fund the suiAddress on testnet first)" }, 400);
  try {
    const url = (body?.rpc && String(body.rpc)) || env.SUI_RPC || getJsonRpcFullnodeUrl("testnet");
    const network = /devnet/.test(url) ? "devnet" : /mainnet/.test(url) ? "mainnet" : /localnet|127\.0\.0\.1|localhost/.test(url) ? "localnet" : "testnet";
    const client = new SuiJsonRpcClient({ url, network: network as any });
    const coins = await client.getCoins({ owner: suiAddress });
    if (!coins.data?.length) return c.json({ ok: false, step: "gas", error: "address has no SUI on testnet — fund it first", suiAddress }, 400);

    const recipient = (body?.to && String(body.to)) || suiAddress;
    const tx = new Transaction();
    tx.setSender(suiAddress);
    tx.setGasBudget(5_000_000);
    const [coin] = tx.splitCoins(tx.gas, [1_000_000]);
    tx.transferObjects([coin], recipient);
    const bytes = await tx.build({ client });

    const acct = await getWalletAccount(env, subOrgId, walletId, suiAddress);
    const pubkeyHex = acct?.account?.publicKey;
    if (!pubkeyHex) return c.json({ ok: false, step: "pubkey", debug: { acct } }, 502);
    const digestHex = suiTransactionDigestHex(bytes);
    const signed = await signRawPayload(env, subOrgId, suiAddress, digestHex);
    const sr = signed.result?.signRawPayloadResult || signed.result || {};
    if (!sr.r || !sr.s) return c.json({ ok: false, step: "sign", debug: { sign: signed.result } }, 502);
    const signature = assembleSuiSignature(sr.r, sr.s, pubkeyHex);

    const res = await client.executeTransactionBlock({ transactionBlock: bytes, signature, options: { showEffects: true } });
    return c.json({ ok: true, network, suiAddress, recipient, digest: res.digest, status: res.effects?.status?.status, explorer: `https://suiscan.xyz/${network}/tx/${res.digest}` });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

// Admin: prove the embedded wallet signs valid signatures on EVM, Solana, and BTC
// (the foundation the send feature builds on). Signs a test digest per chain via
// Turnkey and verifies it recovers/matches the wallet's address/pubkey. No funds.
turnkey.post("/sign-test", async (c) => {
  const env = c.env;
  if (!hasAdminToken(env, bearerToken(c))) return c.json({ error: "unauthorized" }, 401);
  if (!turnkeyConfigured(env)) return c.json({ error: "turnkey_not_configured" }, 501);
  const enc = new TextEncoder();
  const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  try {
    const p = await provisionWallets(env, `liber-sign-${Date.now()}`);
    const results: any = {};

    // EVM (secp256k1, keccak digest → ecrecover → address must match).
    {
      const addr = p.addresses.ethereum!;
      const digestHex = toHex(keccak_256(enc.encode("Liber Turnkey EVM test")));
      const sr = (await signRawPayload(env, p.subOrgId, addr, digestHex, "HASH_FUNCTION_NO_OP")).result?.signRawPayloadResult || {};
      const recovered = evmAddressFromSignature(digestHex, sr.r, sr.s, Number(sr.v ?? 0));
      results.ethereum = { address: addr, recovered, valid: recovered.toLowerCase() === addr.toLowerCase() };
    }
    // Solana (ed25519, verify signature over the message against the account pubkey).
    {
      const addr = p.addresses.solana!;
      const pubkeyHex = (await getWalletAccount(env, p.subOrgId, p.walletId, addr))?.account?.publicKey;
      const msgHex = toHex(enc.encode("Liber Turnkey SOL test"));
      const sr = (await signRawPayload(env, p.subOrgId, addr, msgHex, "HASH_FUNCTION_NOT_APPLICABLE")).result?.signRawPayloadResult || {};
      results.solana = { address: addr, valid: verifyEd25519(msgHex, (sr.r || "") + (sr.s || ""), pubkeyHex) };
    }
    // Bitcoin (secp256k1, sha256 digest → ECDSA verify against the account pubkey).
    {
      const addr = p.addresses.bitcoin!;
      const pubkeyHex = (await getWalletAccount(env, p.subOrgId, p.walletId, addr))?.account?.publicKey;
      const digestHex = toHex(sha256(enc.encode("Liber Turnkey BTC test")));
      const sr = (await signRawPayload(env, p.subOrgId, addr, digestHex, "HASH_FUNCTION_NO_OP")).result?.signRawPayloadResult || {};
      results.bitcoin = { address: addr, valid: verifySecp256k1(digestHex, sr.r, sr.s, pubkeyHex) };
    }
    return c.json({ ok: true, subOrgId: p.subOrgId, results });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

export default turnkey;
