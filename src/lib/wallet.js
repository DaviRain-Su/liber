// Real Sui wallet sign-in via the Wallet Standard (imperative — no React
// providers, so it never touches the app's render tree). Flow:
//   connect wallet → request a server nonce → sign it as a personal message →
//   POST /api/auth/verify (server checks the ed25519 signature) → session token.
// Callers should catch failures and fall back (e.g. guest / demo).
import { getWallets, signAndExecuteTransaction } from "@mysten/wallet-standard";
import { Transaction } from "@mysten/sui/transactions";
import { api, setToken } from "./api.js";

const SUI_TYPE = "0x2::sui::SUI";

function suiWallets() {
  try {
    return getWallets().get().filter(
      (w) => w.features?.["standard:connect"] && w.features?.["sui:signPersonalMessage"],
    );
  } catch {
    return [];
  }
}

export function hasSuiWallet() {
  return suiWallets().length > 0;
}

function pick(name) {
  const list = suiWallets();
  if (!list.length) return null;
  if (name) {
    const norm = name.replace(/钱包|\s/g, "").toLowerCase();
    const hit = list.find((w) => {
      const wn = w.name.toLowerCase();
      return wn.includes(norm) || norm.includes(wn.split(" ")[0]);
    });
    if (hit) return hit;
  }
  return list[0];
}

async function connectWallet(name) {
  const wallet = pick(name);
  if (!wallet) throw new Error("未检测到兼容的 Sui 钱包");
  const connectRes = await wallet.features["standard:connect"].connect();
  const account = (connectRes?.accounts || wallet.accounts || [])[0];
  if (!account) throw new Error("钱包未返回账户");
  return { wallet, account };
}

async function loginWithConnection(wallet, account) {
  const { nonce, message } = await api.auth.nonce();
  const bytes = new TextEncoder().encode(message);
  const signed = await wallet.features["sui:signPersonalMessage"].signPersonalMessage({ message: bytes, account });

  const res = await api.auth.verify({ address: account.address, message, signature: signed.signature, nonce });
  if (res?.token) setToken(res.token);
  return { address: account.address, token: res?.token, user: res?.user };
}

// Connect a Sui wallet (optionally preferring one by display name), sign the
// login nonce, verify on the backend, and persist the session token.
export async function walletLogin(name) {
  const { wallet, account } = await connectWallet(name);
  return loginWithConnection(wallet, account);
}

async function suiRpc(rpc, method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Sui RPC ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "Sui RPC error");
  return j.result;
}

async function collectCoins(rpc, owner, coinType, amount) {
  let cursor = null;
  const picked = [];
  let total = 0n;
  do {
    const page = await suiRpc(rpc, "suix_getCoins", [owner, coinType, cursor, 50]);
    for (const coin of page.data || []) {
      picked.push(coin);
      total += BigInt(coin.balance || 0);
      if (total >= amount) return picked;
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  throw new Error("稳定币余额不足");
}

export async function stablecoinSubscribe(name) {
  const cfg = (await api.billing.cryptoConfig()).payment;
  if (!cfg?.configured) throw new Error("链上稳定币付费尚未配置");
  const { wallet, account } = await connectWallet(name);
  await loginWithConnection(wallet, account);
  if (!wallet.features["sui:signAndExecuteTransaction"] && !wallet.features["sui:signAndExecuteTransactionBlock"]) {
    throw new Error("当前钱包不支持交易签名发送");
  }

  const amount = BigInt(cfg.amount);
  const tx = new Transaction();
  tx.setSender(account.address);

  if (cfg.coinType === SUI_TYPE) {
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(cfg.amount)]);
    tx.transferObjects([payment], cfg.treasury);
  } else {
    const coins = await collectCoins(cfg.rpc, account.address, cfg.coinType, amount);
    const total = coins.reduce((sum, coin) => sum + BigInt(coin.balance || 0), 0n);
    const [primary, ...rest] = coins;
    if (rest.length) tx.mergeCoins(tx.object(primary.coinObjectId), rest.map((c) => tx.object(c.coinObjectId)));
    if (total === amount) {
      tx.transferObjects([tx.object(primary.coinObjectId)], cfg.treasury);
    } else {
      const [payment] = tx.splitCoins(tx.object(primary.coinObjectId), [tx.pure.u64(cfg.amount)]);
      tx.transferObjects([payment], cfg.treasury);
    }
  }

  const result = await signAndExecuteTransaction(wallet, { account, chain: cfg.chain, transaction: tx });
  return api.billing.confirmCrypto(result.digest);
}
