// Chain registry + active-chain selector. Routes import from here, never from a
// specific chain file, so adding a chain = add an adapter + one line here.
import type { Env } from "../types";
import type { ChainAdapter } from "./types";
import { suiAdapter } from "./sui";
import { evmAdapter } from "./evm";

export type { ChainAdapter, ChainRef, ChainInfo } from "./types";

const ADAPTERS: Record<string, ChainAdapter> = {
  sui: suiAdapter,
  evm: evmAdapter,
  // solana: solanaAdapter,  // add when implemented
};

// The active chain (default: sui). Set CHAIN to switch the whole app's chain
// layer with no code changes.
export function chain(env: Env): ChainAdapter {
  return ADAPTERS[(env.CHAIN || "sui").toLowerCase()] || suiAdapter;
}
