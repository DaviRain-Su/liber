// Sui chain access (read-only) via a public fullnode JSON-RPC endpoint.
//
// No keys/gas needed: this verifies the chain is live (latest checkpoint) and
// resolves real on-chain objects by id. Writing to Sui (registering objects)
// needs a server keypair + gas + a deployed Move package — that's deploy-side
// infra; registerObject() is a config-gated placeholder until then. Callers
// degrade gracefully when SUI_RPC is unset.
import type { Env } from "./types";

const DEFAULT_RPC = "https://fullnode.testnet.sui.io:443";

function rpcUrl(env: Env): string | null {
  // explicit opt-in only, so unconfigured deploys make no external calls
  return env.SUI_RPC || null;
}

async function rpc(env: Env, method: string, params: unknown[]): Promise<any> {
  const url = rpcUrl(env);
  if (!url) throw new Error("SUI_RPC not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`sui rpc ${res.status}`);
  const j: any = await res.json();
  if (j.error) throw new Error(j.error.message || "sui rpc error");
  return j.result;
}

// Liveness + identity: latest checkpoint proves the chain is advancing.
export async function getChainInfo(env: Env): Promise<{
  live: boolean;
  checkpoint?: string;
  chainId?: string;
} | null> {
  if (!rpcUrl(env)) return null;
  try {
    const [checkpoint, chainId] = await Promise.all([
      rpc(env, "sui_getLatestCheckpointSequenceNumber", []),
      rpc(env, "sui_getChainIdentifier", []).catch(() => undefined),
    ]);
    return { live: true, checkpoint: String(checkpoint), chainId };
  } catch {
    return { live: false };
  }
}

// Resolve a real on-chain object by id (showType/owner). null if missing/unset.
export async function getObject(env: Env, objectId: string): Promise<any | null> {
  if (!rpcUrl(env)) return null;
  try {
    const r = await rpc(env, "sui_getObject", [
      objectId,
      { showType: true, showOwner: true, showPreviousTransaction: true },
    ]);
    return r?.data ?? null;
  } catch {
    return null;
  }
}

// P4c-write (deploy-side): register a content reference on Sui. Needs a signer
// + gas + Move package; gated off until configured. Returns null for now so the
// publish path is never blocked on chain writes.
export async function registerObject(_env: Env, _payload: Record<string, unknown>): Promise<string | null> {
  return null;
}

export const SUI_DEFAULT_RPC = DEFAULT_RPC;
