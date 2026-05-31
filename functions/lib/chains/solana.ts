// Solana chain adapter — wallet login today; on-chain registration is a no-op
// until a program + server signer are wired (mirrors the EVM scaffold).
//
// Login verification (ed25519 over the raw signed message) lives in the pure,
// unit-tested sigverify.mjs so it needs no live binding. Read liveness uses any
// Solana JSON-RPC (SOLANA_RPC); every method is a safe no-op until that's set.
import type { Env } from "../types";
import type { ChainAdapter, ChainRef, ChainInfo } from "./types";
import { verifySolanaAddress } from "./sigverify.mjs";

function rpcUrl(env: Env): string | null {
  return env.SOLANA_RPC || null;
}

async function rpc(env: Env, method: string, params: unknown[]): Promise<any> {
  const url = rpcUrl(env);
  if (!url) throw new Error("SOLANA_RPC not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`solana rpc ${res.status}`);
  const j: any = await res.json();
  if (j.error) throw new Error(j.error.message || "solana rpc error");
  return j.result;
}

export const solanaAdapter: ChainAdapter = {
  id: "solana",

  // `address` is the claimed base58 public key; ed25519 verify needs it. Returns
  // the address when the signature is valid, else null (fails closed).
  async verifySignature(message, signature, address) {
    return verifySolanaAddress(message, signature, address || "");
  },

  async chainInfo(env): Promise<ChainInfo | null> {
    if (!rpcUrl(env)) return null;
    try {
      const [slot, genesis] = await Promise.all([
        rpc(env, "getSlot", []),
        rpc(env, "getGenesisHash", []).catch(() => undefined),
      ]);
      return { chain: "solana", live: true, checkpoint: String(slot), chainId: genesis };
    } catch {
      return { chain: "solana", live: false };
    }
  },

  async getObject(env, address) {
    if (!rpcUrl(env)) return null;
    try {
      const r = await rpc(env, "getAccountInfo", [address, { encoding: "base64" }]);
      return r?.value ?? null;
    } catch {
      return null;
    }
  },

  async registerObject(_env, _payload): Promise<ChainRef | null> {
    // TODO(Solana): submit an instruction to a registry program with a server
    // signer; gate on SOLANA_SIGNER_KEY + SOLANA_PROGRAM. No-op until then.
    return null;
  },
};
