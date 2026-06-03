// Chain-agnostic adapter contract.
//
// Liber is decentralized-storage-first (Walrus), and treats the *chain* as a
// pluggable layer for three things: verifying a wallet login signature,
// registering high-value content references on-chain (optional), and read-only
// chain verification. Each supported chain (Sui today; EVM / Solana later)
// implements this interface; routes only ever call the interface, never a
// specific chain. Pick the active chain with the CHAIN env var.
import type { Env } from "../types";

export interface ChainRef {
  chain: string; // "sui" | "evm" | "solana"
  digest: string; // tx hash / digest (always verifiable)
  objectId?: string; // created registry object/account id, if any
}

export interface ChainInfo {
  chain: string;
  live: boolean;
  checkpoint?: string; // checkpoint / block height — proof the chain is advancing
  chainId?: string;
}

export interface ChainAdapter {
  readonly id: string; // "sui" | "evm" | "solana"

  // Verify a wallet login signature over `message`; return the signer address
  // (the canonical on-chain address for this chain) or null if invalid.
  verifySignature(message: string, signature: string, address?: string): Promise<string | null>;

  // Read-only liveness + identity. null when this chain isn't configured.
  chainInfo(env: Env): Promise<ChainInfo | null>;

  // Resolve a real on-chain object/account by id. null if missing/unconfigured.
  getObject(env: Env, objectId: string): Promise<any | null>;

  // Register a content reference on-chain (high-value objects only). Fully
  // gated: returns null when signing keys / contract address aren't configured,
  // so the publish path is never blocked. Writing needs a deployed contract.
  registerObject(
    env: Env,
    payload: { contentId: string; kind: string; license?: string },
  ): Promise<ChainRef | null>;
}
