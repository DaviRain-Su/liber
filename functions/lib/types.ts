/// <reference types="@cloudflare/workers-types" />

// Workers AI binding — typed minimally so we don't depend on SDK internals.
export interface WorkersAI {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>;
}

export interface PlatformQueueMessage {
  id: string;
  type: string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  AI: WorkersAI;
  PLATFORM_QUEUE?: Queue<PlatformQueueMessage>;
  BROWSER?: BrowserRun;
  SESSION_TTL?: string;
  // Decentralized storage endpoints (optional; storage.ts falls back to R2 when unset).
  WALRUS_PUBLISHER?: string;
  WALRUS_AGGREGATOR?: string;
  WALRUS_PUBLISH_TIMEOUT_MS?: string;
  ARWEAVE_GATEWAY?: string;
  // Active chain adapter: "sui" (default) | "evm" | "solana".
  CHAIN?: string;
  // Sui fullnode JSON-RPC (read-only chain verification; optional).
  SUI_RPC?: string;
  // Solana JSON-RPC (read-only liveness for the Solana login adapter; optional).
  SOLANA_RPC?: string;
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
  // Google OAuth client id for "Sign in with Google" (public; the ID-token `aud`
  // is checked against it). Unset = Google login disabled.
  GOOGLE_CLIENT_ID?: string;
  // Email one-time-code login via the Cloudflare Email Sending REST API
  // (developers.cloudflare.com/email-service). Pages Functions can't use the
  // SEND_EMAIL binding (Workers-only), so functions/lib/email.ts POSTs to the
  // REST endpoint. Needs a Cloudflare API token with email-send permission
  // (CF_EMAIL_TOKEN, a secret) + the account id. When either is absent,
  // /auth/email returns the code in the response (dev mode) so login still works.
  CF_EMAIL_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  // Sender for login emails, e.g. "Liber <login@yourdomain.com>" (a domain
  // verified in Cloudflare Email Sending).
  EMAIL_FROM?: string;
  // Comma-separated Sui addresses whose CLI publish token also counts as a
  // platform/graph admin (in addition to ADMIN_TOKEN). A self-minted CLI token
  // from a non-listed wallet is NOT admin. Unset = only ADMIN_TOKEN is admin.
  ADMIN_WALLETS?: string;
  // Comma-separated extra browser origins allowed to make credentialed CORS
  // requests (the same-origin SPA never needs this). liber-99x.pages.dev +
  // its preview subdomains + localhost are always allowed.
  ALLOWED_ORIGINS?: string;
  // Per-IP requests/minute cap for the public AI endpoints (default 20).
  AI_RATE_PER_MIN?: string;
  // Cloudflare native Rate Limiting binding (atomic). Configured 20/60s in
  // wrangler.toml. When absent (e.g. local dev) the limiter falls back to KV.
  AI_RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  // Extra hostnames allowed as a /books/ingest server-fetched sourceUrl
  // (comma-separated). Public-domain sources (gutenberg/archive/wikisource) are
  // always allowed; everything else is rejected to prevent SSRF.
  INGEST_HOSTS?: string;
  // AI provider gateway (functions/lib/aiProvider.ts):
  //   AI_PROVIDER: "workers-ai" (default) | "deepseek" | "openai-compat"
  //   AI_MODEL: provider-specific model id (optional; each provider has a default)
  //   AI_TRANSLATION_MODEL: optional cheaper/specialized model for classical Chinese translation
  //   AI_GATEWAY_ID: optional Cloudflare AI Gateway id for Workers AI analytics/cache/rate limits
  //   AI_API_KEY / DEEPSEEK_API_KEY: secret for hosted providers
  //   AI_BASE_URL: override endpoint (e.g. a Cloudflare AI Gateway OpenAI-compat URL)
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_TRANSLATION_MODEL?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_CACHE_TTL?: string;
  SEMANTIC_EMBEDDING_MODEL?: string;
  PLATFORM_QUEUE_ENABLED?: string;
  BROWSER_RENDER_BASE_URL?: string;
  AI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_BASE_URL?: string;
  // Free-tier monthly AI request quota (default 60); 'pro' subscribers unlimited.
  AI_FREE_MONTHLY?: string;
  // Agentic book companion (functions/lib/agent.ts); needs a tool-capable provider.
  AGENT_ENABLED?: string;     // "true" to enable
  AGENT_MAX_TURNS?: string;   // default 6, max 12
  // Living knowledge graph (functions/lib/graph/*). All optional; with GRAPH_ENABLED
  // unset the pipeline is inert and get_echoes returns the seed dictionary as today.
  VECTORIZE?: VectorizeIndex;     // vector index binding ([[vectorize]] in wrangler.toml)
  EMBED_QUEUE?: Queue;            // producer binding ([[queues.producers]])
  GRAPH_ENABLED?: string;         // "true" to enqueue embeddings + read live echoes
  GRAPH_EMBED_MODEL?: string;     // default @cf/baai/bge-m3 (1024-d, multilingual)
  GRAPH_MIN_SCORE?: string;       // edge cosine threshold, default 0.78 (tune via spike)
  GRAPH_TOPK?: string;            // neighbours queried per sentence, default 8
  // Stablecoin subscription checkout on Sui. Leave treasury/coin unset to disable.
  PAYMENT_CHAIN?: string;          // default "sui:testnet"
  PAYMENT_TREASURY?: string;       // receiving wallet address
  PAYMENT_COIN_TYPE?: string;      // e.g. a Sui USDC coin type
  PAYMENT_MONTHLY_AMOUNT?: string; // atomic units, e.g. "5000000" for 5 USDC @ 6 decimals
  PAYMENT_AMOUNT_LABEL?: string;   // display label, e.g. "5 USDC"
  PAYMENT_PLAN_DAYS?: string;      // default 31
  // Optional Stripe-compatible checkout. Not the primary Web3 path.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRICE_ID?: string;
  BILLING_SUCCESS_URL?: string;
  BILLING_CANCEL_URL?: string;
  APP_URL?: string;
}

// Hono context variables set by the auth middleware.
export type Variables = {
  userId: string | null;
  isGuest: boolean;
};
