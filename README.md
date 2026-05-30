# Liber — 永存的开放图书馆

A decentralized, **AI-agent-friendly** reading platform for CC0 public-domain
books. Books are imagined as permanently stored on decentralized networks
(Walrus / Arweave / IPFS) and indexed on Sui; every highlight, annotation, and
AI conversation is an addressable, citable, forkable public object.

This repo is a **high-fidelity, clickable product prototype** — the full core
journey plus the social, notebook, and "open / agent-friendly" layers.

> Design medium: this started life as an HTML/CSS/JS prototype from
> [Claude Design](https://claude.ai/design). It has been ported here into a real
> **Vite + React** application (see [Architecture](#architecture)).

## Running it

```bash
npm install
npm run dev      # start the Vite dev server (prints a local URL)
npm run build    # production build → dist/
npm run preview  # serve the production build
```

Fonts load from Google Fonts (via a CSS `@import`), so the dev/preview server
needs network access for the typography to render exactly.

## What's in it

The app opens on a first-run **onboarding / wallet sign-in** flow, then lands in
the library. The full surface:

| Area | Screens |
| --- | --- |
| **Main journey** | Library (browse / filter / featured) → Book detail (TOC, on-chain proof, popular highlights, reviews) → **full-screen Reader** |
| **Reader interactions** | select → highlight / annotate / ask-AI / cross-book "echoes"; AI companion drawer with summonable community "lenses"; others' annotations inline; TOC + progress; reading settings; three layouts (classic / archive / immersive) |
| **Social / co-reading** | activity feed, shareable AI-conversation cards (对话卡 / 金句卡) with fork-trees and PNG export, discussion threads, co-reading groups |
| **Personal** | Notebook (AI summaries, highlight archive, Markdown/HTML export, write-a-CC0-essay), My Shelf, Profile |
| **Open / agent layer** | on-chain certificate page, global search, **Agent View** (MCP/structured representation of any page), provenance badges (human vs signed AI agent), Agent Square directory, open rankings (`liber.get_charts`) |

Highlights, annotations, reading position, published works, and onboarding state
persist in `localStorage`. The top nav's sun/moon button toggles light/dark.

## Architecture

```
index.html                 # Vite entry → /src/main.jsx
src/
  main.jsx                 # mounts <App> and the <LiberTweaks> island; imports the stylesheets
  data/product-data.js     # all catalogue/content data (named exports + window bootstrap)
  styles/*.css             # design system + per-screen styles (imported in cascade order)
  components/*.jsx          # one ES module per screen/component, with explicit imports/exports
```

### Port notes (prototype → production build)

The original prototype loaded React + Babel from a CDN and shared one global
scope across many `<script type="text/babel">` files, wiring components together
through `window`. The port keeps the **component bodies byte-for-byte identical**
(so the design is reproduced exactly) and changes only how the pieces connect:

- **Components** were converted from `window`-globals into real **ES modules**
  with explicit `import` / `export`. JSX is compiled by `@vitejs/plugin-react`
  (Babel-standalone is dropped).
- **Data** (`product-data.js`) is a real module with **named exports** that also
  bootstraps `window.*` on load. Screens still read `window.BOOKS` etc., so the
  data is a single bootstrapped singleton — initialized once before render.
- **Styles** are imported in `main.jsx` in the original `<link>` order to
  preserve the cascade.

The design system is the prototype's own cohesive language — 古籍 × 朱砂 × 档案
(cinnabar `#c0432b`, warm paper, Cormorant / EB Garamond / IBM Plex Mono, paper
grain, hairline rules). The `Liber` wordmark and tokens live in
`src/styles/liber.css`.

### The Tweaks island

`src/components/product-tweaks.jsx` (the floating Tweaks panel: reader layout,
accent color, display font, dark mode, paper grain, device preview, replay
onboarding) is a **design-time affordance**. It activates via the Claude Design
host's `postMessage` protocol, so in a standalone deployment it stays dormant —
theme switching is still available from the top navigation bar.

## Deployment

This is a full-stack **Cloudflare Pages** app: the Vite SPA (`dist/`) and the
Hono Pages Functions (`functions/`, served at `/api/*`) deploy together, with
**D1** (`DB`), **KV** (`KV`), **R2** (`R2`), and **Workers AI** (`AI`) bound per
`wrangler.toml`. See [BACKEND.md](BACKEND.md) for the API surface.

The Cloudflare resources are already provisioned and their ids are filled into
`wrangler.toml` (D1 `liber`, KV `liber-KV`, R2 `liber-content`). Run
`npm run db:migrate` to apply the D1 schema. Do not add a blanket `_redirects`
rule like `/* / 200`: on Cloudflare Pages it rewrites Vite assets to `index.html`
and causes strict MIME errors for CSS and JS. The current app keeps navigation in
React state, so it does not need an SPA fallback rule.

Pick **one** trigger per Pages project (running both just double-deploys):

**A — GitHub Actions (in-repo).** `.github/workflows/deploy.yml` builds and runs
`wrangler pages deploy` (SPA + Functions + bindings) from GitHub's runners on
every push to `main`. Add a repository secret `CLOUDFLARE_API_TOKEN` (use the
*Edit Cloudflare Workers* token template) under Settings → Secrets and variables
→ Actions. Until that secret exists the workflow builds but skips the deploy, so
it stays green.

**B — Dashboard Git integration.** Cloudflare dashboard → Workers & Pages →
Create application → Pages → Import an existing Git repository → pick this repo.
Build command `npm run build`, output directory `dist`, production branch `main`;
Cloudflare reads `wrangler.toml` for the Functions and bindings.

Future schema changes: add a new SQL file under `migrations/`, wire it into the
`db:migrate` scripts, and the GitHub Actions deploy will apply it before Pages
deploys. For local full-stack dev (`wrangler pages dev` + local D1/KV/R2), see
[BACKEND.md](BACKEND.md).

### Importing Real CC0 / Public Domain Books

Liber's publish policy is intentionally narrow: publishable source books must be
`CC0-1.0` or `PUBLIC-DOMAIN`. `CC BY`, `CC BY-SA`, `CC BY-NC`, unknown, and
all-rights-reserved content are rejected because they add downstream attribution,
share-alike, non-commercial, or unclear reuse obligations.

Use the CLI before calling the admin ingest endpoint. In this repo:

```bash
npm run cli -- license explain
npm run cli -- book inspect ./books/dao.epub --json
npm run cli -- book verify-license ./books/dao.epub \
  --source https://example.org/dao.epub \
  --license PUBLIC-DOMAIN
npm run cli -- book package ./books/dao.epub \
  --source https://example.org/dao.epub \
  --license PUBLIC-DOMAIN \
  --out ./books/dao.liber-manifest.json
npm run cli -- book publish ./books/dao.liber-manifest.json --dry-run
```

The CLI is packaged separately under `packages/liber-cli` as `liber-cli`, so it
can be published to npm and installed by curators or agents:

```bash
npm install -g liber-cli
liber book inspect ./books/dao.epub --json
```

Publishing is manual through the `Publish liber-cli to npm` GitHub Actions
workflow. Add repository secret `NPM_TOKEN`, bump
`packages/liber-cli/package.json` version, run the workflow once with
`dry_run=true`, then rerun with `dry_run=false`.

Use the admin ingest endpoint after setting `ADMIN_TOKEN`:

```bash
curl -XPOST https://<your-domain>/api/books/ingest \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "id":"analects",
    "title":"论语",
    "author":"孔子及弟子",
    "category":"哲学 · 思想",
    "license":"CC0-1.0",
    "chapters":[{"n":1,"title":"学而","text":"子曰：学而时习之，不亦说乎？"}]
  }'
```

The backend stores chapter blobs in R2, publishes to Walrus when configured,
writes searchable metadata to D1, and registers the manifest on Sui when
`SUI_RPC + SUI_SIGNER_KEY + SUI_PACKAGE` are present. The backend also enforces
the same license allowlist, so direct API calls cannot bypass the CLI policy.

### Stablecoin Subscriptions

Stripe is optional. The primary paid path is Sui wallet → USD stablecoin
transfer → backend transaction verification → `pro` activation.

Set these Pages vars/secrets before enabling it:

```bash
PAYMENT_CHAIN=sui:testnet
PAYMENT_TREASURY=0x...
PAYMENT_COIN_TYPE=0x...::coin::COIN
PAYMENT_MONTHLY_AMOUNT=5000000
PAYMENT_AMOUNT_LABEL="5 USDC"
```

After payment, the frontend posts the Sui transaction digest to
`/api/billing/crypto/confirm`; the backend verifies the transaction on `SUI_RPC`
before extending the subscription.
