# Liber Backend

The backend is a **Cloudflare Pages Function** (Hono) served at `/api/*`, on the
same origin as the SPA — so no CORS in production and a single deploy. State
lives in **D1** (SQLite), blobs in **R2**, sessions/nonces in **KV**, and the AI
companion runs on **Workers AI**.

```
Browser ── /            → static SPA (dist/)
        └─ /api/*        → functions/api/[[route]].ts  (Hono)
                           ├─ D1  (DB)   relational data
                           ├─ R2  (R2)   content blobs
                           ├─ KV  (KV)   sessions + nonces
                           └─ AI  (AI)   Workers AI companion
```

## Design

- **Shared seed.** Reference data (catalogue, chapters, base annotations,
  agents, lenses, chart baselines) is read straight from `src/data/product-data.js`
  — the *same* file the frontend renders — via `functions/lib/seed.ts`. One
  source of truth; the API serves identical reference data.
- **Merge-on-read.** User content lives in D1 and is merged with the seed on
  read, mirroring the frontend's old "seed + localStorage" behaviour (e.g.
  annotations for a sentence = seed + public D1 notes).
- **Swappable Web3.** `functions/lib/storage.ts` is the only file that knows
  about storage: today it writes to R2 and returns content-derived
  `walrus://` / `ar://` / `sui::` addresses. Going real Web3 (Walrus + Arweave +
  Sui) later changes only this file.
- **Auth.** Guest sessions work today (`/api/auth/guest`). Real Sui
  wallet-signature login (`/api/auth/verify`) is wired but stubbed until P4
  (wallet integration with `@mysten/dapp-kit`).

## Layout

```
wrangler.toml              bindings (D1/KV/R2/AI) + Pages output dir
tsconfig.json              TS config for functions/
migrations/0001_init.sql   D1 schema
functions/
  api/[[route]].ts         Hono app mounted at /api
  lib/   types · db · auth · storage · ai · seed
  routes/ auth · books · reading · social · ai · charts · mcp
src/lib/api.js             frontend API client (window.liberApi)
```

## Endpoints (high level)

| Group | Routes |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/{nonce,verify,guest,logout}` · `GET /api/auth/me` |
| Books | `GET /api/books` · `/books/:id` · `/books/:id/chapters` · `/books/:id/proof` · `/search?q=` |
| Reading (auth) | `GET /api/reading/:book` · `PUT …/highlight` · `POST …/note` · `PUT …/progress` |
| Social | `GET /api/annotations/:book/:sid` · `/feed` · `/shares` · `/groups[/:id]` · `/threads/:key` · `/works` (+ POST writes, auth) |
| AI | `POST /api/ai/chat` · `GET /api/ai/conversations[/:id]` |
| Charts | `GET /api/charts?window=today|week|month` |
| MCP (open) | `GET /api/mcp` · `POST /api/mcp/call` `{tool,args}` |

## Local development

```bash
npm install
npm run build                 # produce dist/ (Pages Functions need it)
npm run db:migrate:local      # apply schema to the local D1
npm run dev:api               # wrangler pages dev — serves SPA + /api with local D1/KV/R2
# (Workers AI has no local emulator; /api/ai/chat returns a graceful offline reply locally)
```

Smoke test:

```bash
curl localhost:8788/api/health
curl localhost:8788/api/books | head
TOKEN=$(curl -s -XPOST localhost:8788/api/auth/guest | jq -r .token)
curl -XPUT localhost:8788/api/reading/daodejing/highlight \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"sid":"c1-s1","color":"hl-user"}'
curl localhost:8788/api/reading/daodejing -H "Authorization: Bearer $TOKEN"
```

> Pure `vite dev` (frontend only) does not run `/api`; point the SPA at a running
> `wrangler pages dev`, or just use `npm run dev:api` which serves both.

## Provisioning (one time, before deploy)

```bash
npx wrangler d1 create liber          # → copy database_id into wrangler.toml
npx wrangler kv namespace create KV   # → copy id into wrangler.toml
npx wrangler r2 bucket create liber-content
npm run db:migrate                    # apply schema to the remote D1
```

Then bind D1/KV/R2 and **Workers AI** to the Pages project (dashboard →
Settings → Functions → bindings, or via `wrangler.toml`), and deploy:

```bash
npm run deploy        # build + wrangler pages deploy
```

## Roadmap

- **P2** — richer AI companion (streaming, lens personas already wired), share → fork lineage.
- **P3** — provenance signing (human vs agent) + a fuller MCP surface.
- **P4** — real Web3: Walrus/Arweave blobs + Sui registry/proof + wallet login (`@mysten/dapp-kit` + on-chain signature verify).
- **P5** — frontend rewire: offline-first + background sync, migrating `window`/localStorage reads to `src/lib/api.js`.
