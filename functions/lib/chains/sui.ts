// Sui chain adapter. Reads (chainInfo / getObject) need no keys — just a public
// fullnode RPC. Wallet login verifies an ed25519/secp256k1/multisig
// personal-message signature. (zkLogin/Enoki would additionally need a SuiClient
// passed to verifyPersonalMessageSignature — not yet wired.) Registration
// (write) is gated on SUI_SIGNER_KEY +
// SUI_PACKAGE and needs a deployed Move package (see move/ — not required to run).
import type { Env } from "../types";
import type { ChainAdapter, ChainRef, ChainInfo } from "./types";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

function rpcUrl(env: Env): string | null {
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

function networkFromUrl(url: string) {
  if (/mainnet/i.test(url)) return "mainnet";
  if (/devnet/i.test(url)) return "devnet";
  if (/localnet|localhost|127\.0\.0\.1/i.test(url)) return "localnet";
  return "testnet";
}

export const suiAdapter: ChainAdapter = {
  id: "sui",

  async verifySignature(message, signature) {
    try {
      const bytes = new TextEncoder().encode(message);
      const pubkey = await verifyPersonalMessageSignature(bytes, signature);
      return pubkey.toSuiAddress();
    } catch {
      return null;
    }
  },

  async chainInfo(env): Promise<ChainInfo | null> {
    if (!rpcUrl(env)) return null;
    try {
      const [checkpoint, chainId] = await Promise.all([
        rpc(env, "sui_getLatestCheckpointSequenceNumber", []),
        rpc(env, "sui_getChainIdentifier", []).catch(() => undefined),
      ]);
      return { chain: "sui", live: true, checkpoint: String(checkpoint), chainId };
    } catch {
      return { chain: "sui", live: false };
    }
  },

  async getObject(env, objectId) {
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
  },

  async registerObject(env, payload): Promise<ChainRef | null> {
    const url = rpcUrl(env);
    const key = env.SUI_SIGNER_KEY;
    const pkg = env.SUI_PACKAGE;
    if (!url || !key || !pkg) return null;
    const moduleName = env.SUI_MODULE || "registry";
    try {
      const sc = new SuiJsonRpcClient({ url, network: networkFromUrl(url) });
      const kp = Ed25519Keypair.fromSecretKey(key);
      const tx = new Transaction();
      const [record] = tx.moveCall({
        target: `${pkg}::${moduleName}::register`,
        arguments: [
          tx.pure.string(payload.contentId),
          tx.pure.string(payload.kind),
          tx.pure.string(payload.license || "CC0-1.0"),
        ],
      });
      tx.transferObjects([record], kp.toSuiAddress());
      const res = await sc.signAndExecuteTransaction({
        signer: kp,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      const created = (res.objectChanges || []).find((ch: any) => ch.type === "created") as
        | { objectId?: string }
        | undefined;
      return { chain: "sui", digest: res.digest, objectId: created?.objectId };
    } catch {
      return null;
    }
  },
};
