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
import { turnkeyConfigured, createSubOrgWithSuiWallet, provisionWallets, getWalletAccount, signRawPayload, getSubOrgRootUserId, createPasskeyAuthenticator, getSignRawPayloadResult } from "../lib/turnkey";
import { suiAddressFromEd25519Pubkey, suiPersonalMessageDigestHex, suiTransactionDigestHex, assembleSuiSignature } from "../lib/turnkey-sui";
import { upsertTurnkeyUser, ensureTurnkeyWallet } from "../lib/turnkey-auth";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { evmAddressFromSignature, verifyEd25519, verifySecp256k1 } from "../lib/turnkey-verify";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { relTime } from "../lib/time";

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

// Real on-chain balances for the logged-in user's 4 addresses + live prices.
// Best-effort per chain (a failed RPC returns null → the UI shows "—").
turnkey.get("/balances", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  let tk: any = null;
  try { tk = user?.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { tk = null; }
  if (!tk) return c.json({ ok: true, tokens: [], total: 0 });

  const jrpc = async (url: string, method: string, params: any[]) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j: any = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
  };
  const suiBal = async (a: string) => { try { const cl = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" as any }); const b: any = await cl.getBalance({ owner: a }); return Number(b.totalBalance) / 1e9; } catch { return null; } };
  const evmBal = async (a: string) => { try { const r = await jrpc("https://ethereum-rpc.publicnode.com", "eth_getBalance", [a, "latest"]); return r ? parseInt(r, 16) / 1e18 : null; } catch { return null; } };
  const solBal = async (a: string) => { try { const r: any = await jrpc("https://api.mainnet-beta.solana.com", "getBalance", [a]); return r ? Number(r.value) / 1e9 : null; } catch { return null; } };
  const btcBal = async (a: string) => { try { const r = await fetch(`https://blockstream.info/api/address/${a}`); const j: any = await r.json(); const s = j.chain_stats; return s ? (Number(s.funded_txo_sum) - Number(s.spent_txo_sum)) / 1e8 : null; } catch { return null; } };

  const [btc, eth, sol, sui] = await Promise.all([btcBal(tk.bitcoin), evmBal(tk.ethereum), solBal(tk.solana), suiBal(tk.sui)]);
  let prices: any = {};
  try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,sui&vs_currencies=usd"); prices = await r.json(); } catch { prices = {}; }

  const META = [
    { key: "bitcoin", sym: "BTC", chain: "Bitcoin", cls: "btc", cg: "bitcoin", amt: btc },
    { key: "ethereum", sym: "ETH", chain: "Ethereum", cls: "eth", cg: "ethereum", amt: eth },
    { key: "solana", sym: "SOL", chain: "Solana", cls: "sol", cg: "solana", amt: sol },
    { key: "sui", sym: "SUI", chain: "Sui", cls: "sui", cg: "sui", amt: sui },
  ];
  const tokens = META.map((m) => {
    const price = prices?.[m.cg]?.usd ?? null;
    const value = m.amt != null && price != null ? m.amt * price : m.amt != null ? 0 : null;
    return { sym: m.sym, name: m.chain, chain: m.chain, cls: m.cls, glyph: { BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "S" }[m.sym], amt: m.amt, price, value, address: tk[m.key] };
  });
  const total = tokens.reduce((s, t) => s + (t.value || 0), 0);
  return c.json({ ok: true, tokens, total });
});

// Enroll a WebAuthn passkey as an authenticator on the logged-in user's wallet
// sub-org, so they (not the server) can authorize signing. The attestation is
// created client-side via navigator.credentials.create / the Turnkey SDK.
turnkey.post("/passkey/enroll", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  if (!user.turnkey_sub_org_id) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const att = body?.attestation;
  if (!att?.credentialId || !att?.clientDataJson || !att?.attestationObject || !body?.challenge) {
    return c.json({ ok: false, error: "bad_attestation" }, 400);
  }
  try {
    let rootUserId = user.turnkey_root_user_id;
    if (!rootUserId) {
      rootUserId = await getSubOrgRootUserId(c.env, user.turnkey_sub_org_id);
      if (rootUserId) await run(c.env.DB, `UPDATE users SET turnkey_root_user_id = ? WHERE id = ?`, rootUserId, uid);
    }
    if (!rootUserId) return c.json({ ok: false, error: "no_root_user" }, 502);
    await createPasskeyAuthenticator(c.env, user.turnkey_sub_org_id, rootUserId, {
      authenticatorName: String(body.authenticatorName || "Liber Wallet Passkey").slice(0, 64),
      challenge: String(body.challenge),
      attestation: {
        credentialId: att.credentialId,
        clientDataJson: att.clientDataJson,
        attestationObject: att.attestationObject,
        transports: Array.isArray(att.transports) && att.transports.length ? att.transports : ["AUTHENTICATOR_TRANSPORT_INTERNAL"],
      },
    });
    await run(c.env.DB, `UPDATE users SET turnkey_passkey_at = ? WHERE id = ?`, now(), uid);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// --- Real passkey-signed Sui transfer (non-custodial) ---------------------------
// The split is deliberate: the SIGNING step happens in the browser, stamped by the
// user's own passkey (Face ID), talking straight to Turnkey — our server never holds
// the signing key. The server only (1) builds the unsigned transaction and (2) reads
// the user-signed result and broadcasts it. Sui rejects any tx whose bytes don't
// match the signed digest, so a tampered broadcast can't succeed.
function suiNetworkOf(url: string): string {
  return /devnet/.test(url) ? "devnet" : /testnet/.test(url) ? "testnet" : /localnet|127\.0\.0\.1|localhost/.test(url) ? "localnet" : "mainnet";
}
function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 1) Build the unsigned transfer + the digest the user's passkey must sign.
turnkey.post("/sui/prepare", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null;
  try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const subOrgId = user.turnkey_sub_org_id;
  const suiAddress = user.turnkey_sui_address || addrs?.sui;
  if (!subOrgId || !suiAddress) return c.json({ ok: false, error: "no_wallet" }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  const amount = Number(body?.amount);
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(to)) return c.json({ ok: false, error: "bad_recipient", message: "请填写有效的 Sui 地址（0x…）" }, 400);
  if (!(amount > 0)) return c.json({ ok: false, error: "bad_amount", message: "金额无效" }, 400);
  try {
    const url = c.env.SUI_RPC || getJsonRpcFullnodeUrl("mainnet");
    const network = suiNetworkOf(url);
    const client = new SuiJsonRpcClient({ url, network: network as any });
    const coins = await client.getCoins({ owner: suiAddress });
    if (!coins.data?.length) return c.json({ ok: false, error: "no_gas", message: "该 Sui 地址暂无余额，无法支付转账与矿工费" }, 400);

    const mist = BigInt(Math.round(amount * 1e9));
    const tx = new Transaction();
    tx.setSender(suiAddress);
    tx.setGasBudget(5_000_000);
    const [coin] = tx.splitCoins(tx.gas, [mist]);
    tx.transferObjects([coin], to);
    const bytes = await tx.build({ client });
    const digestHex = suiTransactionDigestHex(bytes);
    return c.json({ ok: true, txBytesB64: b64encode(bytes), digestHex, signWith: suiAddress, organizationId: subOrgId, network });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// 2) Read the user's passkey-signed activity and broadcast the transfer on Sui.
turnkey.post("/sui/broadcast", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null;
  try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const subOrgId = user.turnkey_sub_org_id;
  const suiAddress = user.turnkey_sui_address || addrs?.sui;
  const walletId = user.turnkey_wallet_id;
  if (!subOrgId || !suiAddress || !walletId) return c.json({ ok: false, error: "no_wallet" }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const txBytesB64 = String(body?.txBytesB64 || "");
  const activityId = String(body?.activityId || "");
  if (!txBytesB64 || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const pubkeyHex = (await getWalletAccount(c.env, subOrgId, walletId, suiAddress))?.account?.publicKey;
    if (!pubkeyHex) return c.json({ ok: false, error: "no_pubkey" }, 502);
    const signature = assembleSuiSignature(sr.r, sr.s, pubkeyHex);
    const bytes = Uint8Array.from(atob(txBytesB64), (ch) => ch.charCodeAt(0));

    const url = c.env.SUI_RPC || getJsonRpcFullnodeUrl("mainnet");
    const network = suiNetworkOf(url);
    const client = new SuiJsonRpcClient({ url, network: network as any });
    const res = await client.executeTransactionBlock({ transactionBlock: bytes, signature, options: { showEffects: true } });
    return c.json({ ok: true, digest: res.digest, status: res.effects?.status?.status, network, explorer: `https://suiscan.xyz/${network}/tx/${res.digest}` });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

// Real on-chain activity ledger for the user's Sui address. Queries the fullnode for
// transactions where the address is sender OR recipient, reduces each to the net SUI
// balance change for the address, and returns them newest-first. This is genuinely
// real: a passkey transfer made above shows up here once confirmed. (Other chains'
// history is a follow-up; Sui is the platform's main chain + the one with real sends.)
turnkey.get("/activity", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: true, items: [] });
  let addrs: any = null;
  try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const suiAddress = user.turnkey_sui_address || addrs?.sui;
  if (!suiAddress) return c.json({ ok: true, items: [] });

  try {
    const url = c.env.SUI_RPC || getJsonRpcFullnodeUrl("mainnet");
    const network = suiNetworkOf(url);
    const client = new SuiJsonRpcClient({ url, network: network as any });
    const options = { showBalanceChanges: true, showEffects: true } as any;
    const [sent, recvd] = await Promise.all([
      client.queryTransactionBlocks({ filter: { FromAddress: suiAddress }, options, limit: 15, order: "descending" }).catch(() => ({ data: [] as any[] })),
      client.queryTransactionBlocks({ filter: { ToAddress: suiAddress }, options, limit: 15, order: "descending" }).catch(() => ({ data: [] as any[] })),
    ]);

    const seen = new Map<string, { digest: string; amt: number; status: string; ts: number }>();
    for (const t of [...((sent as any).data || []), ...((recvd as any).data || [])]) {
      if (!t?.digest || seen.has(t.digest)) continue;
      let delta = 0n;
      for (const bc of (t.balanceChanges || [])) {
        const ownerAddr = bc?.owner?.AddressOwner;
        if (ownerAddr === suiAddress && bc?.coinType === "0x2::sui::SUI") delta += BigInt(bc.amount);
      }
      seen.set(t.digest, { digest: t.digest, amt: Number(delta) / 1e9, status: t.effects?.status?.status || "", ts: Number(t.timestampMs || 0) });
    }
    const items = [...seen.values()].sort((a, b) => b.ts - a.ts).slice(0, 20).map((x) => {
      const kind = x.amt < 0 ? "send" : x.amt > 0 ? "recv" : "gas";
      return {
        id: x.digest,
        kind,
        title: kind === "send" ? "转账 · SUI" : kind === "recv" ? "收款 · SUI" : "链上操作 · SUI",
        sub: x.status === "success" ? "已确认 · 永久存证" : (x.status || "处理中"),
        sym: "SUI", chain: "Sui",
        amt: (x.amt >= 0 ? "+" : "") + x.amt.toFixed(x.amt === 0 ? 0 : 4),
        when: x.ts ? relTime(x.ts) : "—",
        hash: x.digest.slice(0, 6) + "…" + x.digest.slice(-4),
        explorer: `https://suiscan.xyz/${network}/tx/${x.digest}`,
      };
    });
    return c.json({ ok: true, items, network });
  } catch (e: any) {
    return c.json({ ok: true, items: [], error: String(e?.message || e).slice(0, 200) });
  }
});

export default turnkey;
