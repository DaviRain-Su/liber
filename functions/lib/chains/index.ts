// Chain registry + active-chain selector. Routes import from here, never from a
// specific chain file, so adding a chain = add an adapter + one line here.
import type { Env } from "../types";
import type { ChainAdapter } from "./types";
import { suiAdapter } from "./sui";
import { evmAdapter } from "./evm";
import { solanaAdapter } from "./solana";

export type { ChainAdapter, ChainRef, ChainInfo } from "./types";

const ADAPTERS: Record<string, ChainAdapter> = {
  sui: suiAdapter,
  evm: evmAdapter,
  solana: solanaAdapter,
};

// The active chain for storage/registration (default: sui). Set CHAIN to switch
// the whole app's chain layer with no code changes.
export function chain(env: Env): ChainAdapter {
  return ADAPTERS[(env.CHAIN || "sui").toLowerCase()] || suiAdapter;
}

// Explicit adapter lookup by id — used by the login path, which verifies against
// the chain the WALLET used (per request), independent of the global CHAIN.
// Falls back to Sui for an unknown/empty id.
export function chainById(id?: string | null): ChainAdapter {
  return ADAPTERS[String(id || "sui").toLowerCase()] || suiAdapter;
}
