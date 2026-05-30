// Real Sui wallet sign-in via the Wallet Standard (imperative — no React
// providers, so it never touches the app's render tree). Flow:
//   connect wallet → request a server nonce → sign it as a personal message →
//   POST /api/auth/verify (server checks the ed25519 signature) → session token.
// Callers should catch failures and fall back (e.g. guest / demo).
import { getWallets } from "@mysten/wallet-standard";
import { api, setToken } from "./api.js";

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

// Connect a Sui wallet (optionally preferring one by display name), sign the
// login nonce, verify on the backend, and persist the session token.
export async function walletLogin(name) {
  const wallet = pick(name);
  if (!wallet) throw new Error("未检测到兼容的 Sui 钱包");

  const connectRes = await wallet.features["standard:connect"].connect();
  const account = (connectRes?.accounts || wallet.accounts || [])[0];
  if (!account) throw new Error("钱包未返回账户");

  const { nonce, message } = await api.auth.nonce();
  const bytes = new TextEncoder().encode(message);
  const signed = await wallet.features["sui:signPersonalMessage"].signPersonalMessage({ message: bytes, account });

  const res = await api.auth.verify({ address: account.address, message, signature: signed.signature, nonce });
  if (res?.token) setToken(res.token);
  return { address: account.address, token: res?.token, user: res?.user };
}
