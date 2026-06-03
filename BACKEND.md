# Liber Backend

The backend is a **Cloudflare Pages Function** (Hono) served at `/api/*`, on the
same origin as the SPA — so no CORS in production and a single deploy. State
lives in **D1** (SQLite), blobs in **R2**, sessions/nonces in **KV**, semantic
vectors in **Vectorize**, heavy jobs in **Queues**, generated images in **R2**,
and the AI companion runs on **Workers AI**. When `AI_GATEWAY_ID` is configured,
Workers AI requests route through **Cloudflare AI Gateway** for analytics, rate
limits, logs, and cacheable translation calls.

```
Browser ── /            → static SPA (dist/)
        └─ /api/*        → functions/api/[[route]].ts  (Hono)
                           ├─ D1  (DB)   relational data
                           ├─ R2  (R2)   content blobs
                           ├─ KV  (KV)   sessions + nonces
                           ├─ AI  (AI)   Workers AI companion + embeddings
                           ├─ Vectorize  semantic search / cross-book echoes
                           ├─ Queue      enqueue import/index/render jobs
                           └─ Browser    share-card / thumbnail rendering
liber-platform-worker  ←── liber-platform queue consumer
                           └─ AI Gateway (optional analytics/cache/rate limits)
```

## Design

- **Shared seed.** Reference data (catalogue, chapters, base annotations,
  agents, lenses, chart baselines) is read straight from `src/data/product-data.js`
  — the *same* file the frontend renders — via `functions/lib/seed.ts`. One
  source of truth; the API serves identical reference data.
- **Merge-on-read.** User content lives in D1 and is merged with the seed on
  read, mirroring the frontend's old "seed + localStorage" behaviour (e.g.
  annotations for a sentence = seed + public D1 notes).
- **Swappable Web3.** `functions/lib/storage.ts` owns decentralized blob
  storage (R2 fallback, optional Walrus/Arweave), while `functions/lib/chains/`
  owns wallet verification, read-only chain proof, and optional registry writes.
  The active chain is selected with `CHAIN`.
- **Auth.** Guest sessions work today (`/api/auth/guest`). Wallet-signature
  login (`/api/auth/verify`) delegates verification to the active chain adapter
  (`sui` today; `evm` scaffolded). Passkey login (`/api/auth/passkey/*`) runs a
  real WebAuthn ceremony via `@simplewebauthn/server`; both mint the same KV
  session as a wallet login, so a passkey user is a full (wallet-less) account.

## Layout

```
wrangler.toml              Pages bindings (D1/KV/R2/AI/Vectorize/Queue/Browser)
wrangler.platform.toml     queue-consumer Worker bindings
tsconfig.json              TS config for functions/
migrations/*.sql           D1 schema, applied in order by npm run db:migrate*
functions/
  api/[[route]].ts         Hono app mounted at /api
  lib/   types · db · auth · storage · ai · platform · seed
  routes/ auth · books · reading · social · ai · charts · mcp · platform
workers/platform-worker.ts Queue consumer for background platform jobs
src/lib/api.js             frontend API client (window.liberApi)
```

## Endpoints (high level)

| Group | Routes |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/{nonce,verify,guest,logout}` · `POST /api/auth/passkey/{register,login}/{options,verify}` · `GET /api/auth/me` |
| Books | `GET /api/books` · `/books/:id` · `/books/:id/chapters` · `/books/:id/content/:n` · `/books/:id/proof` · `/search?q=` |
| Reading (auth) | `GET /api/reading/:book` · `PUT …/highlight` · `POST …/note` · `PUT …/progress` |
| Social | `GET /api/annotations/:book/:sid` · `/feed` · `/shares` · `/groups[/:id]` · `/threads/:key` · `/works` (+ POST writes, auth) |
| Comments / votes | `GET/POST /api/comments/:type/:id` · `POST /api/vote/:type/:id` (generic over share/work/book; D1-backed, comments mirrored through the storage layer). |
| AI | `POST /api/ai/chat` · `GET /api/ai/usage` · `GET /api/ai/conversations[/:id]` |
| Platform | `GET /api/platform/status` · `GET /api/platform/search?q=` · admin `POST /api/platform/index/book/:id` · `/jobs` · `/jobs/drain` · `/render/share-card` |
| Billing | `GET /api/billing/plan` · `GET /api/billing/crypto/config` · `POST /api/billing/crypto/confirm` · optional Stripe `POST /api/billing/checkout` / `webhook` |
| Charts | `GET /api/charts?window=today|week|month` |
| MCP (open) | `GET /api/mcp` · `POST /api/mcp/call` `{tool,args}` |
| Graph | `GET /api/graph/stats` · `POST /api/graph/{backfill,maintenance}` (publish-gated) |

## Local development

```bash
npm install
npm run build                 # produce dist/ (Pages Functions need it)
npm run db:migrate:local      # apply all migrations to the local D1
npm run dev:api               # wrangler pages dev — serves SPA + /api with local D1/KV/R2
npm run platform:dev          # remote dev for the Queue consumer Worker
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
npx wrangler queues create liber-platform
npx wrangler vectorize create liber-semantic --dimensions 1024 --metric cosine
npm run db:migrate                    # apply all migrations to the remote D1
```

Then bind D1/KV/R2 and **Workers AI** to the Pages project (dashboard →
Settings → Functions → bindings, or via `wrangler.toml`), and deploy:

```bash
npm run deploy        # build + wrangler pages deploy
npm run platform:deploy
```

The Pages app is the Queue producer. `liber-platform-worker` is the Queue
consumer: it runs `index-book` jobs (D1 chapter chunks → Workers AI embeddings →
Vectorize + `semantic_documents`) and `render-share-card` jobs (Browser
Rendering → PNG in R2 + `share_assets`). If the Queue binding is unavailable,
jobs remain in D1 and can be drained manually with
`POST /api/platform/jobs/drain`.

## Web3 integration (P4) — optional env vars

All Web3 features are config-gated: the committed `wrangler.toml` leaves the
network endpoints empty, so the app falls back to R2 / seed and makes no
external calls. Set public endpoints in `wrangler.toml` `[vars]`; set
`ADMIN_TOKEN` and signer keys as Pages **secrets**.

| Var | Purpose |
| --- | --- |
| `WALRUS_PUBLISHER` | Walrus publisher base URL; enables real blob writes (works/shares/book text). Public testnet: `https://publisher.walrus-testnet.walrus.space` |
| `WALRUS_AGGREGATOR` | Walrus aggregator base URL; blob reads + reachability. Public testnet: `https://aggregator.walrus-testnet.walrus.space` |
| `WALRUS_PUBLISH_TIMEOUT_MS` | Per-blob Walrus publisher timeout. Defaults to `800`, so large book imports do not hang when public Walrus testnet is slow; R2 still stores the blob. |
| `ARWEAVE_GATEWAY` | Arweave gateway for backup-copy reachability, e.g. `https://arweave.net` |
| `SUI_RPC` | Sui fullnode JSON-RPC for read-only chain verification, e.g. `https://fullnode.testnet.sui.io:443` |
| `SUI_SIGNER_KEY` | **Secret.** `suiprivkey1…` bech32 key; enables on-chain registration of published works/shares (needs gas). |
| `SUI_PACKAGE` | Published Move package id exposing `<module>::register(content_id, kind, license)`. |
| `SUI_MODULE` | Move module name (default `registry`). |
| `ADMIN_TOKEN` | **Secret.** Bearer token enabling the book-text ingest endpoint and manual pro activation endpoint. |
| `AI_PROVIDER` | AI backend selector. Default: `workers-ai`; alternatives: `deepseek` or `openai-compat`. |
| `AI_MODEL` | Override the AI book-companion model. Workers AI default: `@cf/qwen/qwen3-30b-a3b-fp8`, replacing the deprecated Qwen1.5 model and keeping strong Chinese support at low cost. |
| `AI_TRANSLATION_MODEL` | Optional model override for the reader's `古文今译` lens. Defaults to `AI_MODEL`; use this to keep translation on a cheaper Workers AI model while routing agentic chat elsewhere. |
| `AI_GATEWAY_ID` | Optional Cloudflare AI Gateway id for Workers AI binding calls. Enables Gateway analytics/rate limits/logs; translation calls opt into Gateway cache when available. |
| `AI_GATEWAY_CACHE_TTL` | Optional Gateway cache TTL used for deterministic translation/释义 calls. Default in `wrangler.toml`: `604800`. |
| `SEMANTIC_EMBEDDING_MODEL` | Workers AI embedding model used before Vectorize upserts. Default in `wrangler.toml`: `@cf/baai/bge-m3`. Keep the Vectorize index dimensions aligned with this model. |
| `PLATFORM_QUEUE_ENABLED` | Set to `false` to leave jobs only in D1 instead of sending to `PLATFORM_QUEUE`. |
| `AI_BASE_URL` / `AI_API_KEY` / `DEEPSEEK_API_KEY` | OpenAI-compatible or DeepSeek provider configuration. `AI_BASE_URL` can point at an AI Gateway provider endpoint when using hosted models. |
| `GRAPH_ENABLED` | Living cross-book echoes (knowledge graph). `true` to enqueue embeddings + read live `echo_edges`; unset = inert, `get_echoes` returns the seed dictionary as today. Needs Vectorize plus the embed queue/consumer. See `docs/KNOWLEDGE_GRAPH_SPEC.md`. |
| `GRAPH_EMBED_MODEL` | Embedding model for the graph. Default `@cf/baai/bge-m3` (1024-d, multilingual). Changing it re-embeds. |
| `GRAPH_MIN_SCORE` | Cosine threshold for writing an echo edge. Default `0.78`; set from the `npm run graph:spike` results. |
| `GRAPH_TOPK` | Nearest neighbours queried per sentence. Default `8`. |
| `CHAIN` | Active chain adapter: `sui` (default) / `evm` / `solana`. |
| `PAYMENT_CHAIN` | Wallet Standard chain id for subscription transactions. Default `sui:testnet`. |
| `PAYMENT_TREASURY` | Receiving Sui address for stablecoin subscriptions. |
| `PAYMENT_COIN_TYPE` | Accepted Sui coin type, e.g. a USDC coin type. |
| `PAYMENT_MONTHLY_AMOUNT` | Required monthly payment in atomic units. |
| `PAYMENT_AMOUNT_LABEL` | Optional display label, e.g. `5 USDC`. |
| `PAYMENT_PLAN_DAYS` | Subscription duration credited per confirmed payment. Default `31`. |
| `STRIPE_SECRET_KEY` / `STRIPE_PRO_PRICE_ID` | Optional fallback checkout. Not needed for the primary Web3 stablecoin flow. |
| `STRIPE_WEBHOOK_SECRET` | Optional Stripe webhook signature verification. |
| `BILLING_SUCCESS_URL` / `BILLING_CANCEL_URL` / `APP_URL` | Optional Stripe checkout redirect URLs. |
| `EVM_RPC` / `EVM_SIGNER_KEY` / `EVM_REGISTRY` | EVM adapter: read works with just `EVM_RPC`; wallet-login verify + on-chain registration are scaffolded (TODO) and need the signer key + a deployed registry contract. |

### Chain layer is pluggable (multi-chain ready)

Storage (Walrus) and the chain are independent: **using Walrus does not require
writing or deploying any contract** — it's an HTTP publisher/aggregator. The
*chain* is a swappable adapter (`functions/lib/chains/`): `sui` (full), `evm`
(read + scaffold), `solana` (future). Routes call the active adapter via
`chain(env)`; switch the whole chain layer with `CHAIN`, add a chain by adding
one adapter file. On-chain **registration is optional and high-value-only** — it
needs a deployed contract (e.g. a Sui Move package) and stays a no-op until the
signer key + contract id are configured, so nothing depends on it.

On publish, `POST /api/works`, `POST /api/shares`, and comment writes call the
active chain adapter's `registerObject(...)` only when that adapter has all of
its signing/config vars. For Sui this means `SUI_RPC` + `SUI_SIGNER_KEY` +
`SUI_PACKAGE`. With any unset, the call is skipped and publishing is unaffected.

Related endpoints:

- `GET /api/books?limit=2000` — list live catalogue books and return the real D1 `total`; the default list limit is 2000 and the server caps it at 2000.
- `GET /api/books/:id/proof` — Walrus/Arweave/Sui live reachability + latest Sui checkpoint.
- `GET /api/sui/object/:id` — resolve a real on-chain object (read-only).
- `GET /api/blobs/:key` — look up a user-published blob (works/shares) + Walrus availability.
- `POST /api/books/ingest` — **publish-gated** (Bearer `ADMIN_TOKEN` or CLI publish token): import a `CC0-1.0` or `PUBLIC-DOMAIN` book from `{ chapters }`, `{ text }`, `{ sourceUrl }`, and optional `{ epubBase64 }`; stores the original EPUB, chapter blobs, D1 metadata, manifest, and optional Sui registry object. Other licenses are rejected server-side.
- `POST /api/books/ingest/begin`, `/chapter`, `/finalize` — **publish-gated** chunked ingest used by the CLI for large EPUBs; source EPUB, chapters, and final manifest/registry write are split into separate requests.
- `POST /api/books/:id/ingest` — **publish-gated** (Bearer `ADMIN_TOKEN` or CLI publish token): publish chapter text to Walrus + manifest.
- `GET /api/books/:id/content/:n` — serve chapter text from Walrus when ingested, else seed.

Run `npm run cli -- book inspect <file.epub>` and
`npm run cli -- book package <file.epub> --source <url> --license CC0-1.0 --out <manifest.json>`
before ingesting real books. The CLI lives in the standalone npm package
`packages/liber-cli` (`liber-cli` on npm), emits `--json` output for agents, and
supports both `book publish <manifest.json> --dry-run` for
storage/API/registry planning and non-dry-run publishing when a local CLI
publish token or `ADMIN_TOKEN` is configured.

Run `npm run smoke:real-content -- --json` for a read-only live smoke test
against Project Gutenberg #132. Add `-- --publish` only after local publish
auth is configured; it will import that EPUB into the live catalogue and then
probe `/api/books/:id`, `/content/1`, search, and proof.

For ongoing Gutenberg curation, `npm run import:gutenberg-classics` defaults to
the Chinese catalogue. This keeps the platform route centered on Chinese public
domain books, where the importer has dedicated checks for classical chapter
forms (`第…回/章/卷`, inline headings, cross-spine terminal headings, numbering
gaps, 廿/卅 shorthand numerals, full-width digit headings/brackets, `书名·篇名`
chapter prefixes, prose-fragment headings with Chinese/full-width punctuation,
out-of-order volume runs, TOC fragments, placeholder titles, Latin noise
headings in Chinese books, garbled text, line-by-line `則` collections, and
body-titled line primers such as `千字文`/`百家姓`, short one-off prose paragraph
sections, body-titled poem/fu lines, repeated 詞牌 headings, and marked
biographical sections such as `▲李白…歲`). Known source lacunae are preserved
as explicit `（缺）` placeholder chapters so the reader, TOC, and downstream
translation/search jobs keep stable numbering. `評`/`评` review snippets and
short interlude titles inside chapter runs are folded into the previous Chinese
chapter. The current Chinese catalogue has no configured single-chapter
fallbacks; weak future candidates should stay unpublished or temporary-only
until a clean public-domain source-specific splitter is added. Those splitters
cover forms such as `词曲部` and `结构第一`, implicit opening sections where the
first numbered heading is omitted, bilingual exercise books such as
`滬語開路`, and Lu Xun collections such as `南腔北調集` where `BB` note
separators must stay inside the right article. Newer plain-text splitters cover
numbered poem titles, `篇第…` essay headings, dynasty chronicle sections,
`魏書/吳書` history headings, Zhang Zai collection headings, travel-diary
sections, inline drama scene openings, and 回目 titles whose subtitle continues
on the next plain-text line. Modern Chinese collections can use explicit
story-title lists so internal `一/二/三` sections stay inside their story
instead of becoming fake top-level chapters. Bilingual public-domain entries
can be cropped to a clean Chinese source range when the original Chinese text
is explicit.
Use `--skip-existing` for live curation batches and `--all-langs` only when
deliberately auditing the wider multilingual backlog.
Use `--concurrency` to run multiple Gutenberg books in parallel: dry-runs
default to 4 concurrent books, while live publishing defaults to 2 concurrent
books and keeps each book's chunked chapter uploads bounded by
`--chapter-concurrency` (default 6).

For Chinese public-domain classics whose clean source is Wikisource rather than
Project Gutenberg, `npm run import:wikisource-classics` runs a curated
Chinese-only pipeline. It fetches raw Wikisource pages concurrently
(`--concurrency`, dry-run default 8, live default 4), retries transient
Wikisource 429/5xx fetch failures while honoring `Retry-After`, removes wiki templates/references/HTML
apparatus, expands nested same-page `{{:篇名}}` transclusions, uses rendered HTML
fallback for transcluded Chinese collections such as `全唐詩`, splits classical
prose by real paragraph boundaries, keeps genuinely
short texts as `全文`, keeps each Chinese history volume (`中文 · 史書`) as one
reader chapter with internal paragraph breaks, and publishes through the same
chunked ingest with `--chapter-concurrency` plus retry/timeout controls
(`--publish-attempts`, `--publish-timeout-ms`;
`npm run import:wikisource-classics:fast` uses `--quiet`, `--no-live-probe`,
`--concurrency 10`, and `--chapter-concurrency 16` so large Chinese batches can
publish first and run one separate online verification pass afterward). The curated set now covers 9610 Chinese classical texts,
including `岳陽樓記`, `滕王閣序`, `赤壁賦`,
`阿房宮賦`, `六國論`, `遊褒禪山記`, `陳情表`, `曹劌論戰`, `進學解`,
`種樹郭橐駝傳`, `小石潭記`, `封建論`, `留侯論`, `傷仲永`, `逍遙遊`,
`秋水`, `琵琶行`, `將進酒`, `張益州畫像記`, `增廣賢文`, `聲律啟蒙`,
`了凡四訓`, `吳子`, `宋詞三百首`, `千家詩`, `樂府詩集`, `陶淵明集`,
`夢溪筆談`, `容齋隨筆`, `老學庵筆記`, `東京夢華錄`, `夢粱錄`,
`武林舊事`, `陶庵夢憶`, `閱微草堂筆記`, `洛陽伽藍記`, `搜神記`,
`古列女傳`, `唐才子傳`, `茶經`, `六祖壇經`, `西京雜記`, `道德經`, `孫子兵法`, `三字經`,
`千字文`, `百家姓`, `菜根譚`, `圍爐夜話`, `幼學瓊林`, the complete
20篇 `論語`, all 14篇 `孟子`, all 36門 `世說新語`, the complete 33篇
`莊子`, all 8篇 `列子`, 53篇 extant `墨子`, all 7卷 `顏氏家訓`,
the complete 32篇 `荀子`, all 55篇 `韓非子`, all 6篇 `公孫龍子`,
all 5卷 `商君書`, all 21卷 `國語`, all 10卷 `鹽鐵論`, all 26卷
`呂氏春秋`, 84 extant 篇 `論衡`, 76 extant 篇 `管子`, all 33篇 `戰國策`,
all 21篇 `淮南子`, all 8卷 `晏子春秋`, 100卷 `漢書`, 120卷 `後漢書`,
the complete 65卷 `三國志`,
the complete 130卷 `晉書`, the complete 100卷 `宋書`, the complete 59卷
`南齊書`, 56卷 `梁書`, 36卷 `陳書`, 114卷 `魏書`, 50卷 `北齊書`,
50卷 `周書`, 85卷 `隋書`, 80卷 `南史`, 100卷 `北史`,
200卷 `舊唐書`, 225卷 `新唐書`, 150卷 `舊五代史`, 74卷 `新五代史`,
496卷 `宋史`, 116卷 `遼史`, 135卷 `金史`, 210卷 `元史`, 332卷 `明史`,
294卷 `資治通鑑`, 220卷 `續資治通鑑`, 90卷 `明通鑑`, 200卷 `通典`,
900卷 `全唐詩`, 500卷 `太平廣記`, 1000卷 `太平御覽`, 65卷已錄正文的 `冊府元龜`,
100卷 `藝文類聚`, 30卷 `初學記`, 40卷 `水經注`, 20卷 `說苑`,
60卷 `昭明文選`, 52卷 `抱朴子外篇`, 47篇分篇 `禮記`, 58篇 `尚書`,
6篇 `周禮`, 17篇 `儀禮`, 18章 `孝經`, 64卦 `周易`,
12篇 `春秋經`, 12篇 `春秋左氏傳`, 12篇 `春秋公羊傳`,
12篇 `春秋穀梁傳`, 18篇 `山海經`, 50篇 `文心雕龍`,
3卷 `詩品`, 320首 `唐詩三百首`, 19首 `古詩十九首`,
283首拆分 `宋詞三百首`, 220首拆分 `千家詩`, 100卷 `樂府詩集`,
72篇分篇 `陶淵明集`, 136篇/卷新補的筆記與城市風物經典,
64篇/卷新補的地理、志怪、傳記、茶書與佛典,
10篇補齊的 `楚辭`,
300個唯一源頁 `詩經`, 19篇 `爾雅`,
the complete 130卷 `史記`, and
221 section-level `古文觀止` pieces such as `鄭伯克段于鄢`, `報任安書`,
`諸葛亮前出師表`, `前赤壁賦`, and `五人墓碑記`.
Collection pages can define `sourceSection` so Chinese anthologies are split by
real Wikisource section headings instead of being imported as one long book;
repeated headings keep an occurrence index and embedded work pages such as
`{{:青玉案 (辛棄疾)}}` are expanded before EPUB generation.

Wallet sign-in: `POST /api/auth/nonce` → wallet signs it → `POST /api/auth/verify`
(real Sui personal-message signature check via `@mysten/sui`). Frontend flow in
`src/lib/wallet.js` (Wallet Standard); guest auth remains available.

Passkey sign-in (通行密钥 / WebAuthn): `POST /api/auth/passkey/register/options`
→ browser creates a credential → `…/register/verify` stores the public key and
mints a session; returning readers use `…/login/options` → `…/login/verify`.
The per-attempt challenge lives in KV (single-use, 5-min TTL) and `rpID`/origin
come from the request (or `APP_URL`). Server logic in `functions/lib/passkey.ts`,
browser flow in `src/lib/passkey.js`. Note: WebAuthn requires HTTPS (or
`localhost`); passkey credentials are stored in the `passkeys` table.

CLI browser auth: `POST /api/auth/cli/start` creates a device authorization,
the browser approves it through wallet login at `/?cli_auth=...`, and
`GET /api/auth/cli/poll/:device` returns a scoped CLI publish token. That token
is accepted by `/api/books/ingest` in addition to `ADMIN_TOKEN`. Normal CLI
tokens can create books and overwrite their own books; a CLI token from an
`ADMIN_WALLETS` allow-listed wallet is treated as platform maintenance auth and
can rebuild existing catalogue rows.

CLI private-key auth uses the normal wallet nonce verification path, then calls
`POST /api/auth/cli/token` with the wallet session to mint the same scoped
publish token. The private key stays local to the CLI.

Subscription payment uses the same wallet path: the frontend builds a Sui coin
transfer to `PAYMENT_TREASURY`, asks the wallet to sign + execute it, then posts
the transaction digest to `POST /api/billing/crypto/confirm`. The backend reads
the transaction from `SUI_RPC`, verifies sender, success status, coin type,
recipient, and amount before promoting the user to `pro`. Stripe can stay unset.

## Living knowledge graph (cross-book echoes)

The hand-written `ECHOES` dictionary can be upgraded into a graph that **grows
with use**: reading, highlighting, and AI chat feed an embedding pipeline that
auto-discovers cross-book echoes. It is **off by default** (`GRAPH_ENABLED`
unset) — the app then behaves exactly as today and `get_echoes` returns the seed
dictionary. Full design + acceptance: `docs/KNOWLEDGE_GRAPH_SPEC.md`.

- **Pipeline.** Sentence write → enqueue (`EMBED_QUEUE`, via `c.executionCtx.waitUntil`,
  never blocking) → consumer embeds (`@cf/baai/bge-m3`) → upserts to `VECTORIZE`
  → cross-book nearest-neighbour → writes `echo_edges` (D1, migration `0009`).
  An `embeddings` ledger makes embedding idempotent (no repeat spend).
- **Reader.** `get_echoes` (shared by the agent loop and `/api/mcp`) calls
  `echoesForSid`, which **merges** the curated seed echoes (kept first) with
  auto-discovered ones (de-duped, appended); `why` is generated lazily on first
  surface. So a sentence never loses its hand-written echoes.
- **Consumer is a separate Worker.** Pages Functions can't host a queue
  consumer, so `workers/embed-consumer/` is deployed on its own (shares the same
  D1/Vectorize/AI). It also runs nightly maintenance (theme labelling +
  cold-link decay) via Cron. Deploy steps: `workers/embed-consumer/README.md`.
- **Endpoints.** `GET /api/graph/stats` (open, read state) ·
  `POST /api/graph/backfill` (publish-gated; enqueue the whole catalogue) ·
  `POST /api/graph/maintenance` (publish-gated; run maintenance on demand).
- **Spike first.** `npm run graph:spike` embeds the seed books and prints
  auto-discovered echoes next to the hand-written ones, so the auto-link quality
  (and the right `GRAPH_MIN_SCORE`) is validated **before** shipping.

## Roadmap

- **P2** — richer AI companion (streaming, lens personas already wired), share → fork lineage.
- **P2.5** — living knowledge graph (cross-book echoes): pipeline + reader merge + backfill/Cron landed behind `GRAPH_ENABLED`; pending live quality spike + provisioning. See above and `docs/KNOWLEDGE_GRAPH_SPEC.md`.
- **P3** — provenance signing (human vs agent) + a fuller MCP surface.
- **P4** — real Web3: Walrus/Arweave blobs + Sui registry/proof + wallet login (`@mysten/dapp-kit` + on-chain signature verify).
- **P5** — frontend rewire: offline-first + background sync, migrating `window`/localStorage reads to `src/lib/api.js`.
