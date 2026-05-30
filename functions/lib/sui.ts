// Sui chain access (read-only) via a public fullnode JSON-RPC endpoint.
//
// No keys/gas needed: this verifies the chain is live (latest checkpoint) and
// resolves real on-chain objects by id. Writing to Sui (registering objects)
// needs a server keypair + gas + a deployed Move package — that's deploy-side
// infra; registerObject() is a config-gated placeholder until then. Callers
// degrade gracefully when SUI_RPC is unset.
import type { Env } from "./types";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

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

// Build a SuiClient bound to the configured fullnode, or null when unset.
function client(env: Env): SuiClient | null {
  const url = rpcUrl(env);
  return url ? new SuiClient({ url }) : null;
}

// Load the server signer from SUI_SIGNER_KEY (a `suiprivkey1…` bech32 secret).
function signer(env: Env): Ed25519Keypair | null {
  const key = env.SUI_SIGNER_KEY;
  if (!key) return null;
  try {
    return Ed25519Keypair.fromSecretKey(key);
  } catch {
    return null;
  }
}

export interface ChainRef {
  digest: string;       // transaction digest (always verifiable)
  objectId?: string;    // created registry object id, if any
}

// P4c-write: register a content reference on-chain by calling
// `<SUI_PACKAGE>::<SUI_MODULE>::register(contentId, kind, license)`.
// Fully gated: needs SUI_RPC + SUI_SIGNER_KEY + SUI_PACKAGE. Returns null on
// any miss/error so the publish path is never blocked on chain writes.
export async function registerObject(
  env: Env,
  payload: { contentId: string; kind: string; license?: string },
): Promise<ChainRef | null> {
  const sc = client(env);
  const kp = signer(env);
  const pkg = env.SUI_PACKAGE;
  if (!sc || !kp || !pkg) return null;
  const moduleName = env.SUI_MODULE || "registry";
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${pkg}::${moduleName}::register`,
      arguments: [
        tx.pure.string(payload.contentId),
        tx.pure.string(payload.kind),
        tx.pure.string(payload.license || "CC0-1.0"),
      ],
    });
    const res = await sc.signAndExecuteTransaction({
      signer: kp,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    });
    const created = (res.objectChanges || []).find((ch: any) => ch.type === "created") as any;
    return { digest: res.digest, objectId: created?.objectId };
  } catch {
    return null;
  }
}

export const SUI_DEFAULT_RPC = DEFAULT_RPC;
