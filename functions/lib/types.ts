/// <reference types="@cloudflare/workers-types" />

// Workers AI binding — typed minimally so we don't depend on SDK internals.
export interface WorkersAI {
  run(model: string, input: Record<string, unknown>): Promise<any>;
}

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  AI: WorkersAI;
  SESSION_TTL?: string;
  // Decentralized storage endpoints (optional; storage.ts falls back to R2 when unset).
  WALRUS_PUBLISHER?: string;
  WALRUS_AGGREGATOR?: string;
  ARWEAVE_GATEWAY?: string;
  // Active chain adapter: "sui" (default) | "evm" | "solana".
  CHAIN?: string;
  // Sui fullnode JSON-RPC (read-only chain verification; optional).
  SUI_RPC?: string;
  // Sui on-chain registration (write). All required together; secret key.
  SUI_SIGNER_KEY?: string;   // suiprivkey1… bech32 secret (Pages secret)
  SUI_PACKAGE?: string;      // published Move package id
  SUI_MODULE?: string;       // module name (default: "registry")
  // EVM adapter (read works with just EVM_RPC; write needs the two below).
  EVM_RPC?: string;
  EVM_SIGNER_KEY?: string;   // server signer (Pages secret)
  EVM_REGISTRY?: string;     // deployed registry contract address
  // Bearer secret enabling the admin-only book-text ingest endpoint (optional).
  ADMIN_TOKEN?: string;
  // AI provider gateway (functions/lib/aiProvider.ts):
  //   AI_PROVIDER: "workers-ai" (default) | "deepseek" | "openai-compat"
  //   AI_MODEL: provider-specific model id (optional; each provider has a default)
  //   AI_API_KEY / DEEPSEEK_API_KEY: secret for hosted providers
  //   AI_BASE_URL: override endpoint (e.g. a Cloudflare AI Gateway OpenAI-compat URL)
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_BASE_URL?: string;
  // Free-tier monthly AI request quota (default 60); 'pro' subscribers unlimited.
  AI_FREE_MONTHLY?: string;
}

// Hono context variables set by the auth middleware.
export type Variables = {
  userId: string | null;
  isGuest: boolean;
};
