// EVM chain adapter — scaffold for multi-chain support.
//
// Read verification works today against any EVM JSON-RPC (EVM_RPC): block number
// for liveness, eth_getCode for "object"/contract lookup. Wallet login
// (SIWE / personal_sign ecrecover) and on-chain registration are left as clearly
// marked TODOs — they need a small signature lib + a deployed registry contract,
// to be added when EVM support is actually turned on. Until EVM_RPC is set every
// method is a safe no-op, so this file ships without affecting anything.
import type { Env } from "../types";
import type { ChainAdapter, ChainRef, ChainInfo } from "./types";
import { recoverEvmAddress } from "./sigverify.mjs";

function rpcUrl(env: Env): string | null {
  return env.EVM_RPC || null;
}

async function rpc(env: Env, method: string, params: unknown[]): Promise<any> {
  const url = rpcUrl(env);
  if (!url) throw new Error("EVM_RPC not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`evm rpc ${res.status}`);
  const j: any = await res.json();
  if (j.error) throw new Error(j.error.message || "evm rpc error");
  return j.result;
}

export const evmAdapter: ChainAdapter = {
  id: "evm",

  // EIP-191 personal_sign: recover the signer (secp256k1 ecrecover) from the
  // message + 65-byte signature and confirm it matches the claimed address
  // (case-insensitive). Returns the recovered 0x address or null (fails closed).
  async verifySignature(message, signature, address) {
    const signer = recoverEvmAddress(message, signature);
    if (!signer) return null;
    if (address && signer.toLowerCase() !== String(address).toLowerCase()) return null;
    return signer;
  },

  async chainInfo(env): Promise<ChainInfo | null> {
    if (!rpcUrl(env)) return null;
    try {
      const [bn, cid] = await Promise.all([
        rpc(env, "eth_blockNumber", []),
        rpc(env, "eth_chainId", []).catch(() => undefined),
      ]);
      return { chain: "evm", live: true, checkpoint: String(parseInt(bn, 16)), chainId: cid };
    } catch {
      return { chain: "evm", live: false };
    }
  },

  async getObject(env, address) {
    if (!rpcUrl(env)) return null;
    try {
      const code = await rpc(env, "eth_getCode", [address, "latest"]);
      return code && code !== "0x" ? { address, code } : null;
    } catch {
      return null;
    }
  },

  async registerObject(_env, _payload): Promise<ChainRef | null> {
    // TODO(EVM): send a tx to a deployed registry contract's register(...) with a
    // server signer; gate on EVM_SIGNER_KEY + EVM_REGISTRY. No-op until then.
    return null;
  },
};
