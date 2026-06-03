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
| **Reader interactions** | select → highlight / annotate / ask-AI / one-click classical Chinese 今译 / cross-book "echoes"; AI companion drawer with summonable community "lenses"; others' annotations inline; TOC + progress; reading settings; three layouts (classic / archive / immersive) |
| **Social / co-reading** | activity feed, shareable AI-conversation cards (对话卡 / 金句卡) with fork-trees and PNG export, discussion threads, co-reading groups |
| **Personal** | Notebook (AI summaries, highlight archive, Markdown/HTML export, write-a-CC0-essay), My Shelf, Profile |
| **Open / agent layer** | on-chain certificate page, global search, **Agent View** (MCP/structured representation of any page), provenance badges (human vs signed AI agent), Agent Square directory, open rankings (`liber.get_charts`) |

Highlights, annotations, reading position, published works, and onboarding state
persist in `localStorage`. The top nav's sun/moon button toggles light/dark.

There is also a **focused reader entry** at `/reader.html` — the design bundle's
primary `Liber Reader.html` ported as a reader-first surface. It skips the
library chrome and boots straight into the full-screen Reader on the first
catalogue title (or `/reader.html?book=<id>`), sharing the same components, data,
and design system as the full app.

## Architecture

```
index.html                 # Vite entry → /src/main.jsx (full app)
reader.html                # focused entry → /src/reader.jsx (boots straight into the Reader)
src/
  main.jsx                 # mounts <App> and the <LiberTweaks> island; imports the stylesheets
  reader.jsx               # mounts the standalone full-screen Reader on the first (or ?book=) title
  data/product-data.js     # seed catalogue/content data for local empty databases
  lib/catalog.js           # frontend catalogue store: /api/books first, seed fallback only
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
- **Catalogue data** is hydrated from `/api/books` into `src/lib/catalog.js`.
  When D1 has real imported books, the frontend replaces `window.BOOKS` with
  that live catalogue; the seed module is only a local/offline fallback.
- **Library browsing** is language-first. The public book grid groups the live
  catalogue by ISO language code, then exposes the language-prefixed category
  suffix as that language's internal direction filter.
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
**D1** (`DB`), **KV** (`KV`), **R2** (`R2`), **Workers AI** (`AI`),
**Vectorize**, **Queues**, and **Browser Rendering** bound per `wrangler.toml`.
Workers AI can optionally route through Cloudflare AI Gateway for analytics,
rate limits, logs, and cacheable 今译/释义 calls. See [BACKEND.md](BACKEND.md)
for the API surface.

The Cloudflare resources are already provisioned and their ids are filled into
`wrangler.toml` (D1 `liber`, KV `liber-KV`, R2 `liber-content`). Run
`npm run db:migrate` to apply the D1 schema. Create the `liber-platform` Queue
and `liber-semantic` Vectorize index, then deploy both the Pages app and the
Queue consumer Worker:

```bash
npm run deploy
npm run platform:deploy
```

Do not add a blanket `_redirects` rule like `/* / 200`: on Cloudflare Pages it
rewrites Vite assets to `index.html` and causes strict MIME errors for CSS and
JS. The current app keeps navigation in React state, so it does not need an SPA
fallback rule.

Deploys are run **locally with the Cloudflare CLI** (`npm run deploy` above) —
there is no GitHub Actions deploy workflow and no `CLOUDFLARE_API_TOKEN` secret.
CI (`.github/workflows/ci.yml`) only builds and tests on push / PR.

Optional auto-deploy via **Dashboard Git integration**: Cloudflare dashboard →
Workers & Pages → Create application → Pages → Import an existing Git repository →
pick this repo. Build command `npm run build`, output directory `dist`,
production branch `main`; Cloudflare reads `wrangler.toml` for the Functions and
bindings.

Future schema changes: add a new SQL file under `migrations/`, wire it into the
`db:migrate` scripts, and apply it manually with `npm run db:migrate` (run it
before `npm run deploy`). For local full-stack dev (`wrangler pages dev` + local
D1/KV/R2), see [BACKEND.md](BACKEND.md).

### Platform Jobs

The paid Workers platform layer is now part of the product surface:

- `GET /api/platform/status` shows D1/R2/Workers AI/AI Gateway/Vectorize/Queue/Browser capability state and job counters.
- `POST /api/platform/index/book/:id` enqueues full-book semantic indexing.
- `GET /api/platform/search?q=...` returns Vectorize semantic matches and falls back to D1 search when Vectorize is unavailable.
- `POST /api/platform/render/share-card` queues Browser Rendering PNG generation into R2.
- `POST /api/platform/jobs/drain` manually runs queued jobs if the Queue consumer has not been deployed yet.

### Importing Real CC0 / Public Domain Books

Liber's publish policy is intentionally narrow: publishable source books must be
`CC0-1.0` or `PUBLIC-DOMAIN`. `CC BY`, `CC BY-SA`, `CC BY-NC`, unknown, and
all-rights-reserved content are rejected because they add downstream attribution,
share-alike, non-commercial, or unclear reuse obligations.

Use the CLI before calling the publish ingest endpoint. In this repo:

```bash
npm run cli -- license explain
npm run cli -- book inspect ./books/dao.epub --json
npm run cli -- book extract ./books/dao.epub --json
npm run cli -- book verify-license ./books/dao.epub \
  --source https://example.org/dao.epub \
  --license PUBLIC-DOMAIN
npm run cli -- book package ./books/dao.epub \
  --source https://example.org/dao.epub \
  --license PUBLIC-DOMAIN \
  --out ./books/dao.liber-manifest.json
npm run cli -- book publish ./books/dao.liber-manifest.json --dry-run
```

To actually publish from the CLI, save the admin API config once:

```bash
npm run cli -- auth browser --api-url https://liber.davirain.xyz
```

For agent/headless wallet signing, keep the Sui private key outside the saved
config and use it only to sign the backend login nonce:

```bash
LIBER_SUI_PRIVATE_KEY="suiprivkey..." npm run cli -- auth key --api-url https://liber.davirain.xyz
```

For headless admin use, you can still configure a bearer token directly:

```bash
npm run cli -- auth login --api-url https://liber.davirain.xyz --admin-token "$ADMIN_TOKEN"
npm run cli -- book publish ./books/dao.liber-manifest.json
```

The CLI extracts chapters from the EPUB spine, applies additional logical
chapter splitting for common Gutenberg classics, and publishes through chunked
ingest (`/api/books/ingest/begin`, `/chapter`, `/finalize`) so large books do
not time out. Server-side ingest still enforces the same license policy. The
original EPUB is kept as the archival source asset; extracted plain text
chapters are reader/search derivatives. For frontend reading, the API can
generate `/api/books/:id/reader.epub` from those stored chapters, with a clean
OPF/NCX/nav table of contents, because many source EPUBs have incomplete
navigation metadata. The backend stores the original source layer, chapter
layer, plus a JSON manifest, in R2/Walrus when configured. Sui stores only the
content reference and provenance metadata, not the full book bytes.

For a repeatable real-content smoke test, run:

```bash
npm run smoke:real-content -- --json
```

That downloads Project Gutenberg #132 (The Art of War), validates the
public-domain EPUB, builds the ingest payload with the original EPUB included,
and probes the live API without writing. Add `-- --publish` only after
`liber auth browser`, `liber auth key`, or `ADMIN_TOKEN` is configured locally.

The Gutenberg importer is now Chinese-first by default. Daily curation should
run the Chinese public-domain catalogue first, because the reader experience is
optimized around classical Chinese chapter splitting, 繁简显示, 竖排, and
古文今译:

```bash
npm run import:gutenberg-classics -- --json --concurrency 6
npm run import:gutenberg-classics -- --publish --skip-existing --json --concurrency 2 --ids <comma-separated chinese ids>
```

Use `ADMIN_TOKEN` or a CLI token from an `ADMIN_WALLETS` allow-listed wallet
when rebuilding an existing catalogue book with better Chinese chapter splits;
ordinary CLI publish tokens can still only overwrite books they created.
The importer runs books concurrently (`--concurrency`); dry-runs default to 4
books at once, while live publishing defaults to 2 books at once and keeps
per-book chapter uploads bounded by `--chapter-concurrency` (default 6).

To explicitly inspect or import the wider multilingual backlog, opt in:

```bash
npm run import:gutenberg-classics -- --all-langs --json
npm run import:gutenberg-classics -- --publish --json --ids <comma-separated ids>
```

For Chinese public-domain short classics that are better sourced from
Wikisource than Project Gutenberg, use the curated Chinese-only importer:

```bash
npm run import:wikisource-classics -- --summary --json
npm run import:wikisource-classics -- --publish --skip-existing --summary --json
npm run import:wikisource-classics:fast
```

It fetches Wikisource raw pages concurrently (`--concurrency`, dry-run default
8, live default 4), honors `Retry-After` while retrying transient Wikisource
429/5xx fetch failures, strips
wiki templates/refs/HTML apparatus, expands nested same-page `{{:篇名}}`
transclusions, uses rendered HTML fallback for transcluded Chinese collections
such as `全唐詩`, keeps genuine short works such as `陋室銘`
as a single `全文` chapter, keeps each Chinese history volume (`中文 · 史書`)
as one reader chapter with internal paragraph breaks, and uploads chapter chunks
with bounded `--chapter-concurrency` plus publish retries/timeouts
(`--publish-attempts`, `--publish-timeout-ms`; the fast script uses
`--quiet`, `--no-live-probe`, `--concurrency 10`, and `--chapter-concurrency 16`
so large Chinese batches can publish first and run one separate online
verification pass afterward). The curated set
is Chinese-first and now covers 9610 classical Chinese texts, including
`岳陽樓記`, `滕王閣序`,
`赤壁賦`, `阿房宮賦`, `六國論`, `遊褒禪山記`, `陳情表`, `曹劌論戰`,
`進學解`, `種樹郭橐駝傳`, `小石潭記`, `封建論`, `留侯論`, `傷仲永`,
`逍遙遊`, `秋水`, `琵琶行`, `將進酒`, `張益州畫像記`, `增廣賢文`,
`聲律啟蒙`, `了凡四訓`, `吳子`, `宋詞三百首`, `千家詩`, `樂府詩集`,
`陶淵明集`, `夢溪筆談`, `容齋隨筆`, `老學庵筆記`, `東京夢華錄`,
`夢粱錄`, `武林舊事`, `陶庵夢憶`, `閱微草堂筆記`, `洛陽伽藍記`,
`搜神記`, `古列女傳`, `唐才子傳`, `茶經`, `六祖壇經`, `西京雜記`, `道德經`, `孫子兵法`,
`三字經`, `千字文`, `百家姓`, `菜根譚`, `圍爐夜話`, `幼學瓊林`,
the complete 20篇 `論語`, all 14篇 `孟子`, all 36門 `世說新語`,
the complete 33篇 `莊子`, all 8篇 `列子`, 53篇 extant `墨子`, all 7卷
`顏氏家訓`, the complete 32篇 `荀子`, all 55篇 `韓非子`, all 6篇
`公孫龍子`, all 5卷 `商君書`, all 21卷 `國語`, all 10卷 `鹽鐵論`,
all 26卷 `呂氏春秋`, 84 extant 篇 `論衡`, 76 extant 篇 `管子`, all 33篇 `戰國策`,
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
221 section-level `古文觀止` pieces such as
`鄭伯克段于鄢`, `報任安書`, `諸葛亮前出師表`, `前赤壁賦`, and
`五人墓碑記`.
Collection pages can define `sourceSection` so Chinese anthologies are split by
real Wikisource section headings instead of being imported as one long book;
repeated headings keep an occurrence index and embedded work pages such as
`{{:青玉案 (辛棄疾)}}` are expanded before EPUB generation.

The importer records ISO language codes and language-prefixed categories from
Project Gutenberg EPUBs that pass the same `PUBLIC-DOMAIN` license checks.
Chinese candidates also go through stricter title/TOC checks for 第几回/章/卷,
inline chapter headings, terminal headings split across spine files, Chinese
numbering gaps, shorthand numerals such as 廿/卅, full-width digit headings,
full-width bracket titles, book-prefixed titles such as `史記·本紀`, prose
fragments with Chinese/full-width punctuation, out-of-order volume sequences,
TOC fragments, placeholder titles, Latin noise headings in Chinese books, and
mojibake/garbled text. Known source lacunae stay explicit as `（缺）`
placeholder chapters instead of being hidden by relaxed quality gates. Short
plain-text source splitters also cover numbered poem titles, `篇第…` essay
headings, dynasty chronicle sections, `魏書/吳書` history headings, Zhang Zai
collection headings, travel-diary sections, inline drama scene openings, and
回目 titles whose subtitle continues on the next plain-text line, plus
line-by-line `則` collections, body-titled line primers such as `千字文`/`百家姓`,
short one-off prose paragraph sections, body-titled poem/fu lines, repeated
詞牌 headings, and marked biographical sections such as `▲李白…歲`.
`評`/`评` review sections and short interlude titles inside chapter runs are
merged back into the previous chapter instead of becoming standalone reader
chapters. The current Chinese catalogue has no configured single-chapter
fallbacks; weak future candidates should stay unpublished or temporary-only
until a clean public-domain source-specific splitter is added. Those splitters
now cover Chinese `部`/篇目 structures such as `词曲部` and `结构第一`, implicit
opening sections where the first numbered heading is omitted, bilingual
exercise books such as `滬語開路`, and Lu Xun collections such as
`南腔北調集` where `BB` note separators must stay inside the right article.
Modern Chinese collections can also use explicit story-title lists so internal
`一/二/三` sections stay inside their story instead of becoming fake top-level
chapters. Bilingual public-domain Gutenberg entries can be cropped to their
clean Chinese source range when the Chinese original is explicit. The in-app
library also opens on the 中文 shelf first when Chinese books are present. Wider
multilingual candidates stay available, but they should not displace the
Chinese quality route.

The CLI is packaged separately under `packages/liber-cli` as `liber-cli`, so it
can be published to npm and installed by curators or agents. It requires
Node.js `>=22`:

```bash
npm install -g liber-cli
liber book inspect ./books/dao.epub --json
```

Publishing is manual through the `Publish liber-cli to npm` GitHub Actions
workflow. Add repository secret `NPM_TOKEN`, bump
`packages/liber-cli/package.json` version, run the workflow once with
`dry_run=true`, then rerun with `dry_run=false`.

Use the ingest endpoint directly after setting `ADMIN_TOKEN`:

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
