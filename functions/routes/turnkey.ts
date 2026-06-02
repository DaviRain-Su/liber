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
import { id, now, run, first, all } from "../lib/db";
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
import { evmSigningDigestHex, evmSignedRawTx, erc20TransferData, toBaseUnits, type EvmTx } from "../lib/turnkey-evm";
import { solTransferMessage, solMessageHex, solSignedTxBase64, solParseForSigning, solInjectSignature } from "../lib/turnkey-solana";
import { p2wpkhProgram, p2wpkhScript, bip143Sighashes, derLowS, buildSignedTx, hash160, estVsize, DUST_P2WPKH, bytesToHex as btcBytesToHex, type TxOutput, type TxInput } from "../lib/turnkey-bitcoin";

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
  // USDC (ERC-20) balanceOf on mainnet: 0x70a08231 + 32-byte address.
  const usdcBal = async (a: string) => { try { const data = "0x70a08231" + a.replace(/^0x/, "").toLowerCase().padStart(64, "0"); const r = await jrpc("https://ethereum-rpc.publicnode.com", "eth_call", [{ to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", data }, "latest"]); return r && r !== "0x" ? parseInt(r, 16) / 1e6 : null; } catch { return null; } };
  const solBal = async (a: string) => { try { const r: any = await jrpc("https://api.mainnet-beta.solana.com", "getBalance", [a]); return r ? Number(r.value) / 1e9 : null; } catch { return null; } };
  const btcBal = async (a: string) => { try { const r = await fetch(`https://blockstream.info/api/address/${a}`); const j: any = await r.json(); const s = j.chain_stats; return s ? (Number(s.funded_txo_sum) - Number(s.spent_txo_sum)) / 1e8 : null; } catch { return null; } };

  const [btc, eth, sol, sui, usdc] = await Promise.all([btcBal(tk.bitcoin), evmBal(tk.ethereum), solBal(tk.solana), suiBal(tk.sui), tk.ethereum ? usdcBal(tk.ethereum) : Promise.resolve(null)]);
  let prices: any = {};
  try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,sui,usd-coin&vs_currencies=usd"); prices = await r.json(); } catch { prices = {}; }

  const META = [
    { key: "bitcoin", sym: "BTC", chain: "Bitcoin", cls: "btc", cg: "bitcoin", amt: btc, addr: tk.bitcoin },
    { key: "ethereum", sym: "ETH", chain: "Ethereum", cls: "eth", cg: "ethereum", amt: eth, addr: tk.ethereum },
    { key: "usdc", sym: "USDC", chain: "Ethereum", cls: "usdc", cg: "usd-coin", amt: usdc, addr: tk.ethereum },
    { key: "solana", sym: "SOL", chain: "Solana", cls: "sol", cg: "solana", amt: sol, addr: tk.solana },
    { key: "sui", sym: "SUI", chain: "Sui", cls: "sui", cg: "sui", amt: sui, addr: tk.sui },
  ];
  const tokens = META.map((m) => {
    const price = prices?.[m.cg]?.usd ?? null;
    const value = m.amt != null && price != null ? m.amt * price : m.amt != null ? 0 : null;
    return { sym: m.sym, name: m.sym === "USDC" ? "USD Coin" : m.chain, chain: m.chain, cls: m.cls, glyph: { BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "S", USDC: "$" }[m.sym], amt: m.amt, price, value, address: m.addr };
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

// --- Real passkey-signed Ethereum transfer (ETH + USDC, non-custodial) -----------
// Same split as Sui: the browser passkey-signs the keccak digest directly with
// Turnkey (secp256k1, NO_OP); the server builds the legacy tx and broadcasts the
// signed raw tx. The signature binds to the exact tx fields, so a tampered broadcast
// recovers a different signer and is rejected by the network.
const USDC_MAINNET = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // 6 decimals
function evmRpcUrl(env: Env): string { return (env as any).EVM_RPC || "https://ethereum-rpc.publicnode.com"; }
async function ethCall(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}
const hexBig = (h: string): bigint => BigInt(h && h !== "0x" ? h : "0x0");

turnkey.post("/evm/prepare", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null;
  try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const from = (user.turnkey_addresses && addrs?.ethereum) || null;
  const subOrgId = user.turnkey_sub_org_id;
  if (!from || !subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  const amount = Number(body?.amount);
  const sym = String(body?.token || "ETH").toUpperCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return c.json({ ok: false, error: "bad_recipient", message: "请填写有效的以太坊地址（0x… 40 位）" }, 400);
  if (!(amount > 0)) return c.json({ ok: false, error: "bad_amount", message: "金额无效" }, 400);
  if (sym !== "ETH" && sym !== "USDC") return c.json({ ok: false, error: "bad_token" }, 400);
  try {
    const url = evmRpcUrl(c.env);
    const chainId = Number(hexBig(await ethCall(url, "eth_chainId", []))) || 1;
    const nonce = hexBig(await ethCall(url, "eth_getTransactionCount", [from, "pending"]));
    const gasPrice = hexBig(await ethCall(url, "eth_gasPrice", []));

    let txTo: string, value: bigint, data: string, gas: bigint;
    if (sym === "USDC") {
      const amt = toBaseUnits(amount, 6);
      txTo = USDC_MAINNET; value = 0n; data = erc20TransferData(to, amt);
      try { gas = (hexBig(await ethCall(url, "eth_estimateGas", [{ from, to: txTo, data }])) * 12n) / 10n; } catch { gas = 100000n; }
    } else {
      txTo = to; value = toBaseUnits(amount, 18); data = ""; gas = 21000n;
    }
    const ethBal = hexBig(await ethCall(url, "eth_getBalance", [from, "latest"]));
    const maxCost = (sym === "USDC" ? 0n : value) + gasPrice * gas;
    if (ethBal < maxCost) return c.json({ ok: false, error: "no_gas", message: "以太坊地址的 ETH 不足以支付" + (sym === "USDC" ? "矿工费" : "转账与矿工费") }, 400);

    const tx: EvmTx = { nonce: nonce.toString(), gasPrice: gasPrice.toString(), gas: gas.toString(), to: txTo, value: value.toString(), data, chainId };
    const digestHex = evmSigningDigestHex(tx);
    return c.json({ ok: true, digestHex, signWith: from, organizationId: subOrgId, hashFunction: "HASH_FUNCTION_NO_OP", tx });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

turnkey.post("/evm/broadcast", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  const subOrgId = user.turnkey_sub_org_id;
  if (!subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const tx = body?.tx as EvmTx | undefined;
  const activityId = String(body?.activityId || "");
  if (!tx || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const raw = evmSignedRawTx(tx, sr.r, sr.s, Number(sr.v ?? 0));
    const url = evmRpcUrl(c.env);
    const hash = await ethCall(url, "eth_sendRawTransaction", [raw]);
    return c.json({ ok: true, digest: hash, status: "success", network: "ethereum", explorer: `https://etherscan.io/tx/${hash}` });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

// --- Real passkey-signed Solana transfer (non-custodial) -------------------------
// Solana ed25519-signs the serialized message directly, so the passkey "payload" is
// the whole message (NOT_APPLICABLE) and r||s is the 64-byte signature.
const SOL_RPC = "https://api.mainnet-beta.solana.com";
async function solRpc(method: string, params: any[]): Promise<any> {
  const r = await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const jj: any = await r.json();
  if (jj.error) throw new Error(jj.error.message || "sol rpc error");
  return jj.result;
}
function hexToBytesLocal(h: string): Uint8Array { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return a; }

turnkey.post("/sol/prepare", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null; try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const from = addrs?.solana; const subOrgId = user.turnkey_sub_org_id;
  if (!from || !subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  const amount = Number(body?.amount);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) return c.json({ ok: false, error: "bad_recipient", message: "请填写有效的 Solana 地址" }, 400);
  if (!(amount > 0)) return c.json({ ok: false, error: "bad_amount", message: "金额无效" }, 400);
  try {
    const lamports = BigInt(Math.round(amount * 1e9));
    const bal: any = await solRpc("getBalance", [from]);
    const have = BigInt(bal?.value ?? 0);
    if (have < lamports + 5000n) return c.json({ ok: false, error: "no_gas", message: "Solana 余额不足以支付转账与手续费" }, 400);
    const bh: any = await solRpc("getLatestBlockhash", [{ commitment: "finalized" }]);
    const blockhash = bh?.value?.blockhash;
    if (!blockhash) return c.json({ ok: false, error: "no_blockhash" }, 502);
    const msg = solTransferMessage(from, to, lamports, blockhash);
    return c.json({ ok: true, digestHex: solMessageHex(msg), signWith: from, organizationId: subOrgId, hashFunction: "HASH_FUNCTION_NOT_APPLICABLE", sol: { messageHex: solMessageHex(msg) } });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

turnkey.post("/sol/broadcast", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  const subOrgId = user.turnkey_sub_org_id;
  if (!subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const messageHex = String(body?.sol?.messageHex || "");
  const activityId = String(body?.activityId || "");
  if (!messageHex || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const txB64 = solSignedTxBase64(hexToBytesLocal(messageHex), sr.r + sr.s);
    const sig = await solRpc("sendTransaction", [txB64, { encoding: "base64", preflightCommitment: "confirmed" }]);
    return c.json({ ok: true, digest: sig, status: "success", network: "solana", explorer: `https://solscan.io/tx/${sig}` });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

// --- Real passkey-signed Bitcoin transfer (P2WPKH, single-input, non-custodial) ----
// Turnkey secp256k1-signs the BIP143 sighash (NO_OP); we DER-encode (low-S) + assemble
// the witness tx. Single input keeps it to one signature (one Face ID) + simple change.
const BTC_API = "https://blockstream.info/api";

turnkey.post("/btc/prepare", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null; try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const from = addrs?.bitcoin; const subOrgId = user.turnkey_sub_org_id; const walletId = user.turnkey_wallet_id;
  if (!from || !subOrgId || !walletId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  const amount = Number(body?.amount);
  if (!/^bc1q[02-9ac-hj-np-z]{38,58}$/.test(to)) return c.json({ ok: false, error: "bad_recipient", message: "仅支持原生隔离见证地址（bc1q…）" }, 400);
  if (!(amount > 0)) return c.json({ ok: false, error: "bad_amount", message: "金额无效" }, 400);
  try {
    const amountSats = BigInt(Math.round(amount * 1e8));
    const utxos: any[] = await (await fetch(`${BTC_API}/address/${from}/utxo`)).json();
    const confirmed = (utxos || []).filter((u) => u?.status?.confirmed).sort((a, b) => a.value - b.value);
    if (!confirmed.length) return c.json({ ok: false, error: "no_utxo", message: "该比特币地址暂无已确认余额" }, 400);
    let feeRate = 8;
    try { const fe: any = await (await fetch(`${BTC_API}/fee-estimates`)).json(); feeRate = Math.max(2, Math.ceil(fe["6"] || fe["3"] || fe["1"] || 8)); } catch { /* fallback */ }
    const fee2 = BigInt(feeRate * estVsize(2));
    const utxo = confirmed.find((u) => BigInt(u.value) >= amountSats + fee2);
    if (!utxo) return c.json({ ok: false, error: "no_single_utxo", message: "没有单个 UTXO 能覆盖该金额（暂不支持合并多个 UTXO），可减小金额" }, 400);

    const inVal = BigInt(utxo.value);
    const ownProgram = p2wpkhProgram(from);
    const recScript = p2wpkhScript(p2wpkhProgram(to));
    let change = inVal - amountSats - fee2;
    const outputs: TxOutput[] = [{ script: recScript, value: amountSats }];
    if (change >= DUST_P2WPKH) outputs.push({ script: p2wpkhScript(ownProgram), value: change });
    else { // fold dust change into fee; recompute against the 1-output fee floor
      const fee1 = BigInt(feeRate * estVsize(1));
      if (inVal < amountSats + fee1) return c.json({ ok: false, error: "insufficient", message: "余额不足以覆盖金额与矿工费" }, 400);
    }
    const pubkeyHex = (await getWalletAccount(c.env, subOrgId, walletId, from))?.account?.publicKey;
    if (!pubkeyHex) return c.json({ ok: false, error: "no_pubkey" }, 502);
    const pubkeyHash = hash160(hexToBytesLocal(pubkeyHex));
    const input = { txid: utxo.txid, vout: utxo.vout, sequence: 0xffffffff };
    const sighash = bip143Sighashes([{ ...input, amount: inVal, pubkeyHash }], outputs, 2, 0)[0];
    return c.json({
      ok: true, digestHex: sighash, signWith: from, organizationId: subOrgId, hashFunction: "HASH_FUNCTION_NO_OP",
      btc: { input, outputs: outputs.map((o) => ({ scriptHex: btcBytesToHex(o.script), value: o.value.toString() })), pubkeyHex, version: 2, locktime: 0, feeRate },
    });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

turnkey.post("/btc/broadcast", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  const subOrgId = user.turnkey_sub_org_id;
  if (!subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const btc = body?.btc; const activityId = String(body?.activityId || "");
  if (!btc?.input || !btc?.outputs || !btc?.pubkeyHex || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const der = derLowS(sr.r, sr.s);
    const witnessSig = new Uint8Array(der.length + 1); witnessSig.set(der, 0); witnessSig[der.length] = 0x01; // SIGHASH_ALL
    const outputs: TxOutput[] = btc.outputs.map((o: any) => ({ script: hexToBytesLocal(o.scriptHex), value: BigInt(o.value) }));
    const input: TxInput = { txid: btc.input.txid, vout: btc.input.vout, sequence: btc.input.sequence >>> 0 };
    const rawHex = buildSignedTx([input], outputs, [[witnessSig, hexToBytesLocal(btc.pubkeyHex)]], btc.version || 2, btc.locktime || 0);
    const res = await fetch(`${BTC_API}/tx`, { method: "POST", headers: { "content-type": "text/plain" }, body: rawHex });
    const txt = await res.text();
    if (!res.ok) return c.json({ ok: false, error: "broadcast_rejected", message: txt.slice(0, 200) }, 502);
    return c.json({ ok: true, digest: txt, status: "success", network: "bitcoin", explorer: `https://mempool.space/tx/${txt}` });
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
        ok: x.status === "success",
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

// 通讯录 — real recipients: Liber readers you follow who have an embedded wallet, with
// their real per-chain addresses. The send flow resolves the address for the chosen chain.
turnkey.get("/contacts", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ ok: true, contacts: [] });
  const rows = await all<any>(
    c.env.DB,
    `SELECT DISTINCT u.id, u.name, u.handle, u.seal, u.color, u.turnkey_addresses
     FROM follows f JOIN users u ON u.id = f.followee_id
     WHERE f.follower_id = ? AND u.is_guest = 0 AND u.turnkey_addresses IS NOT NULL
     ORDER BY u.name LIMIT 60`,
    uid,
  );
  const contacts = rows.map((u) => {
    let a: any = {}; try { a = JSON.parse(u.turnkey_addresses) || {}; } catch { a = {}; }
    return { id: u.id, name: u.name, sub: u.handle || "", seal: u.seal || "读", cls: "ink", color: u.color || "#3a4fb0",
      addresses: { SUI: a.sui || null, ETH: a.ethereum || null, SOL: a.solana || null, BTC: a.bitcoin || null } };
  }).filter((x) => x.addresses.SUI || x.addresses.ETH || x.addresses.SOL || x.addresses.BTC);
  return c.json({ ok: true, contacts });
});

// 致谢墙 — real incoming SUI transfers (tips/payments received), with the sender named
// when their address maps to a Liber reader. Reflects actual on-chain receipts.
turnkey.get("/tips", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ ok: true, tips: [] });
  const user: any = await getUser(c.env, uid);
  let addrs: any = null; try { addrs = user?.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const suiAddress = user?.turnkey_sui_address || addrs?.sui;
  if (!suiAddress) return c.json({ ok: true, tips: [] });
  try {
    const url = c.env.SUI_RPC || getJsonRpcFullnodeUrl("mainnet");
    const network = suiNetworkOf(url);
    const client = new SuiJsonRpcClient({ url, network: network as any });
    const recvd: any = await client.queryTransactionBlocks({ filter: { ToAddress: suiAddress }, options: { showBalanceChanges: true, showInput: true } as any, limit: 25, order: "descending" }).catch(() => ({ data: [] }));
    const raw: { sender: string; amt: number; ts: number; hash: string }[] = [];
    for (const t of (recvd.data || [])) {
      const sender = t?.transaction?.data?.sender;
      if (!sender || sender === suiAddress) continue;
      let delta = 0n;
      for (const bc of (t.balanceChanges || [])) {
        if (bc?.owner?.AddressOwner === suiAddress && bc?.coinType === "0x2::sui::SUI") delta += BigInt(bc.amount);
      }
      if (delta <= 0n) continue;
      raw.push({ sender, amt: Number(delta) / 1e9, ts: Number(t.timestampMs || 0), hash: t.digest });
    }
    const seen: Record<string, any> = {};
    for (const r of raw) {
      if (seen[r.sender] === undefined) seen[r.sender] = await first<any>(c.env.DB, `SELECT name, seal, color FROM users WHERE turnkey_sui_address = ? LIMIT 1`, r.sender);
    }
    const tips = raw.slice(0, 12).map((r) => {
      const u = seen[r.sender];
      return { name: u?.name || (r.sender.slice(0, 6) + "…" + r.sender.slice(-4)), seal: u?.seal || "匿", color: u?.color || "#5b6478",
        amt: "+" + r.amt.toFixed(r.amt >= 1 ? 2 : 4), sym: "SUI", msg: "", when: r.ts ? relTime(r.ts) : "—",
        hash: r.hash.slice(0, 6) + "…" + r.hash.slice(-4), explorer: `https://suiscan.xyz/${network}/tx/${r.hash}` };
    });
    return c.json({ ok: true, tips });
  } catch (e: any) {
    return c.json({ ok: true, tips: [], error: String(e?.message || e).slice(0, 200) });
  }
});

// Real cross-chain swap via the LI.FI aggregator (li.quest, keyless). LI.FI returns a
// ready EVM `transactionRequest` for an Ethereum-source swap — same-chain (ETH↔USDC) or
// cross-chain (e.g. ETH/USDC → SOL, which LI.FI settles via its bridges). We build the
// EvmTx(s) and the user passkey-signs each; broadcast reuses /turnkey/evm/broadcast.
// ERC20 source (USDC) prepends an approve step (2 signatures). LI.FI doesn't cover Sui
// or native BTC, and SOL-source is a follow-up, so those are honestly gated client-side.
const pad32 = (hexNo0x: string): string => hexNo0x.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const LIFI_QUOTE = "https://li.quest/v1/quote";
const SWAP_TOKENS: Record<string, { chain: string; token: string; decimals: number; addrKey: "ethereum" | "solana"; native?: boolean }> = {
  ETH:  { chain: "1", token: "0x0000000000000000000000000000000000000000", decimals: 18, addrKey: "ethereum", native: true },
  USDC: { chain: "1", token: USDC_MAINNET, decimals: 6, addrKey: "ethereum" },
  SOL:  { chain: "1151111081099710", token: "11111111111111111111111111111111", decimals: 9, addrKey: "solana", native: true },
};

turnkey.post("/swap/prepare", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null; try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const subOrgId = user.turnkey_sub_org_id;
  if (!subOrgId || !addrs) return c.json({ ok: false, error: "no_wallet" }, 400);

  const body: any = await c.req.json().catch(() => ({}));
  const fromSym = String(body?.from || "").toUpperCase();
  const toSym = String(body?.to || "").toUpperCase();
  const amount = Number(body?.amount);
  const F = SWAP_TOKENS[fromSym], T = SWAP_TOKENS[toSym];
  if (!F || !T || fromSym === toSym) return c.json({ ok: false, error: "unsupported_pair", message: "暂不支持该兑换对" }, 400);
  if (!(amount > 0)) return c.json({ ok: false, error: "bad_amount", message: "金额无效" }, 400);
  const fromAddr = addrs[F.addrKey], toAddr = addrs[T.addrKey];
  if (!fromAddr || !toAddr) return c.json({ ok: false, error: "no_wallet" }, 400);
  try {
    const fromAmount = toBaseUnits(amount, F.decimals).toString();
    const params = new URLSearchParams({ fromChain: F.chain, toChain: T.chain, fromToken: F.token, toToken: T.token, fromAmount, fromAddress: fromAddr, toAddress: toAddr, slippage: "0.01" });
    const q: any = await (await fetch(`${LIFI_QUOTE}?${params.toString()}`)).json();
    const tr = q?.transactionRequest;
    const quote = { fromSym, toSym, amount, toAmount: Number(q?.estimate?.toAmount || 0) / 10 ** T.decimals, tool: q?.tool || "lifi", crossChain: F.chain !== T.chain };

    // Solana-source: LI.FI returns a base64 Solana tx with a zero signer placeholder.
    // We sign the message (ed25519) and splice the signature in on broadcast.
    if (F.chain === SWAP_TOKENS.SOL.chain) {
      if (!tr?.data) return c.json({ ok: false, error: "no_route", message: q?.message || "没有可用的兑换路径" }, 502);
      const { messageHex, sigOffset } = solParseForSigning(tr.data, fromAddr);
      return c.json({ ok: true, chainKind: "sol", organizationId: subOrgId, signWith: fromAddr, hashFunction: "HASH_FUNCTION_NOT_APPLICABLE", digestHex: messageHex, sol: { txB64: tr.data, sigOffset }, quote });
    }
    if (!tr?.to || !tr?.data) return c.json({ ok: false, error: "no_route", message: q?.message || "没有可用的兑换路径" }, 502);

    const url = evmRpcUrl(c.env);
    const chainId = Number(tr.chainId) || 1;
    let nonce = hexBig(await ethCall(url, "eth_getTransactionCount", [fromAddr, "pending"]));
    const gasPrice = hexBig(await ethCall(url, "eth_gasPrice", []));
    const steps: { kind: string; tx: EvmTx; digestHex: string }[] = [];

    if (!F.native) { // ERC20 source → ensure the LI.FI spender has allowance
      const spender = q?.estimate?.approvalAddress || tr.to;
      const cur = hexBig(await ethCall(url, "eth_call", [{ to: F.token, data: "0xdd62ed3e" + pad32(fromAddr) + pad32(spender) }, "latest"]));
      if (cur < BigInt(fromAmount)) {
        const approveData = "0x095ea7b3" + pad32(spender) + pad32(BigInt(fromAmount).toString(16));
        const atx: EvmTx = { nonce: nonce.toString(), gasPrice: gasPrice.toString(), gas: "80000", to: F.token, value: "0", data: approveData, chainId };
        steps.push({ kind: "approve", tx: atx, digestHex: evmSigningDigestHex(atx) });
        nonce = nonce + 1n;
      }
    }
    const swapGas = (BigInt(tr.gasLimit || "350000") * 13n) / 10n;
    const stx: EvmTx = { nonce: nonce.toString(), gasPrice: gasPrice.toString(), gas: swapGas.toString(), to: tr.to, value: BigInt(tr.value || "0").toString(), data: tr.data, chainId };
    const ethBal = hexBig(await ethCall(url, "eth_getBalance", [fromAddr, "latest"]));
    const gasCost = steps.reduce((s, st) => s + BigInt(st.tx.gas) * gasPrice, 0n) + BigInt(stx.gas) * gasPrice;
    if (ethBal < BigInt(stx.value) + gasCost) return c.json({ ok: false, error: "no_gas", message: "ETH 余额不足以支付兑换与矿工费" }, 400);
    steps.push({ kind: "swap", tx: stx, digestHex: evmSigningDigestHex(stx) });

    return c.json({ ok: true, chainKind: "evm", organizationId: subOrgId, signWith: fromAddr, hashFunction: "HASH_FUNCTION_NO_OP", steps, quote });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// Broadcast a Solana-source LI.FI swap: splice the passkey signature into the LI.FI tx
// and send it. (EVM-source swaps reuse /turnkey/evm/broadcast.)
turnkey.post("/swap/sol/broadcast", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  const subOrgId = user.turnkey_sub_org_id;
  if (!subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const txB64 = String(body?.sol?.txB64 || "");
  const sigOffset = Number(body?.sol?.sigOffset);
  const activityId = String(body?.activityId || "");
  if (!txB64 || !Number.isInteger(sigOffset) || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const signed = solInjectSignature(txB64, sr.r + sr.s, sigOffset);
    const sig = await solRpc("sendTransaction", [signed, { encoding: "base64", preflightCommitment: "confirmed" }]);
    return c.json({ ok: true, digest: sig, status: "success", network: "solana", explorer: `https://solscan.io/tx/${sig}` });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, 500);
  }
});

// Real message signing (non-custodial): passkey-sign a Sui personal message, then
// verify the signature server-side so the UI can show a genuine, verifiable result.
// No broadcast — this proves wallet ownership / consent, it isn't a transaction.
turnkey.post("/sign/message", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null; try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const suiAddress = user.turnkey_sui_address || addrs?.sui;
  const subOrgId = user.turnkey_sub_org_id;
  if (!suiAddress || !subOrgId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const message = String(body?.message || "");
  if (!message || message.length > 2000) return c.json({ ok: false, error: "bad_message" }, 400);
  return c.json({ ok: true, digestHex: suiPersonalMessageDigestHex(message), signWith: suiAddress, organizationId: subOrgId, hashFunction: "HASH_FUNCTION_NOT_APPLICABLE" });
});

turnkey.post("/sign/verify", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user: any = await getUser(c.env, uid);
  if (!user || user.is_guest) return c.json({ ok: false, error: "no_user" }, 401);
  let addrs: any = null; try { addrs = user.turnkey_addresses ? JSON.parse(user.turnkey_addresses) : null; } catch { addrs = null; }
  const suiAddress = user.turnkey_sui_address || addrs?.sui;
  const subOrgId = user.turnkey_sub_org_id;
  const walletId = user.turnkey_wallet_id;
  if (!suiAddress || !subOrgId || !walletId) return c.json({ ok: false, error: "no_wallet" }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const message = String(body?.message || "");
  const activityId = String(body?.activityId || "");
  if (!message || !activityId) return c.json({ ok: false, error: "bad_request" }, 400);
  try {
    const sr = await getSignRawPayloadResult(c.env, subOrgId, activityId);
    if (!sr) return c.json({ ok: false, error: "sign_incomplete", message: "未能取得签名结果，请重试" }, 502);
    const pubkeyHex = (await getWalletAccount(c.env, subOrgId, walletId, suiAddress))?.account?.publicKey;
    if (!pubkeyHex) return c.json({ ok: false, error: "no_pubkey" }, 502);
    const signature = assembleSuiSignature(sr.r, sr.s, pubkeyHex);
    let verified = false;
    try { verified = (await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature)).toSuiAddress() === suiAddress; } catch { verified = false; }
    return c.json({ ok: true, signature, verified, address: suiAddress });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

export default turnkey;
