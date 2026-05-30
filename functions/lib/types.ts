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
}

// Hono context variables set by the auth middleware.
export type Variables = {
  userId: string | null;
  isGuest: boolean;
};
