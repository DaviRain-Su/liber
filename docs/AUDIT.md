# Liber — Code Audit (2026-05-31)

A multi-dimension audit (security, correctness, architecture, data/migrations,
tests/CI, ops, product/UX/a11y, performance) of the Cloudflare Pages app. Each
finding was grounded in real code and adversarially re-verified. Severities are
the post-verification ratings.

## Fixed

### Security & cost (commits 1792e2c, 0e380f0, 387c5b8)
- **CORS info-disclosure** — `functions/api/[[route]].ts` reflected an arbitrary
  `Origin` with `credentials:true`, letting any third-party site read a logged-in
  user's private JSON (`/api/auth/me`, `/api/ai/conversations`). Now an explicit
  allowlist (liber-99x.pages.dev + preview subdomains + localhost + `ALLOWED_ORIGINS`).
- **Privilege escalation** — any wallet user could self-mint a CLI token
  (`/auth/cli/token`) that `platformAuth`/`adminAuth` treated as `ADMIN_TOKEN`.
  Platform/graph (infra/cost) endpoints now require `ADMIN_TOKEN` (constant-time)
  or a CLI token from an `ADMIN_WALLETS`-listed wallet. Book *publishing* still
  accepts any CLI token (its intended use).
- **SSRF** — `/books/ingest` fetched an unvalidated `sourceUrl`. Now restricted to
  an https public-domain host allowlist (`INGEST_HOSTS` to extend); private/loopback
  hosts rejected.
- **Wallet-login replay** — `/auth/verify` did not bind the signed message to the
  nonce. It now requires the message to equal the exact server template
  (`loginMessage`), and the nonce is single-use.
- **AI cost-abuse** — cookieless `/ai/chat` + `/platform/search` ran Workers AI
  unmetered. Now per-IP rate-limited (`AI_RATE_PER_MIN`, default 20/min) via a D1
  atomic counter (migration `0011_rate_limits`). NOTE: Cloudflare KV is **not**
  usable for this (eventually-consistent reads); Cloudflare's native Rate Limiting
  binding is **not** supported in Pages config. For hard burst limits, enable AI
  Gateway rate limiting (`AI_GATEWAY_ID`).
- **Translation cache poisoning** — an empty (non-throwing) AI response was cached
  as a real translation forever. `functions/lib/ai.ts` now flags it `error:true` so
  the route skips the cache write.

### User-visible bugs & quality (this batch)
- **Upvotes always 0** — the feed hardcoded shares to `up:0` and the comments list
  returned the stale `up` column, despite votes existing in the `votes` table. Both
  now merge live `COUNT(*)` (`functions/routes/social.ts`).
- **Dead library sort** — real books had `readsN`/`liners` hardcoded to 0 and
  `created_at` dropped, so "最多人读 / 划线最多 / 最近上链" did nothing. `listBooks`
  now computes the metrics (distinct readers from `progress`, highlights from
  `highlights`) and sorts in SQL; books carry `createdAt` (`functions/lib/catalog.ts`).
- **Platform job double-run** — `runPlatformJob` had no claim guard, so the queue
  consumer and `/jobs/drain` could execute the same job twice. It now claims
  atomically (`UPDATE ... WHERE id=? AND status!='running'`, check `meta.changes`)
  (`functions/lib/platform.ts`).
- **Simplified→traditional wrong chars** — S2T was a lossy reverse of a many-to-one
  map. Ambiguous chars now default to their most-common traditional form (后→後,
  里→裡, 余→餘) with exception phrases for the rest (皇后→皇后, 公里→公里, 头发→頭髮),
  applied via a placeholder pass so phrase output survives the char map
  (`src/lib/zh-convert.js`).

### Performance & tests (this batch)
- **First-paint bundle** — `@mysten/sui` (~32 kB gzip) and `@simplewebauthn` were
  in the main chunk. Now dynamic-imported in the sign-in/subscribe handlers
  (`product-onboarding.jsx`, `cli-auth.jsx`, `product-profile.jsx`) → main chunk
  dropped ~91 kB → ~57 kB gzip; the Sui SDK loads only on sign-in.
- **Tests** — extracted the money/auth verification into `functions/lib/verify.mjs`
  (Stripe HMAC, Sui payment matching, constant-time compare, nonce binding) with
  behavioral tests in `test/verify.test.mjs` — previously zero executed-code coverage.

## Backlog (confirmed, not yet fixed)

- **MED (arch)** — `Reader()` is a ~927-line god component (45 useState / 23
  useEffect, `src/components/product-reader.jsx`). Biggest future-velocity tax.
- **MED (tests)** — auth/session, AI parsing, graph echoes, and platform job state
  still have no runtime tests; many `functions/` tests only string-grep source.
  No vitest/miniflare harness.
- **MED (perf)** — no route-level code-splitting (~20 screens eager); Google Fonts
  render-blocking `@import`; JSON GETs (`/books`, `/charts`) lack `Cache-Control`;
  `getChapters` does serial R2 reads (N+1).
- **MED (ops)** — no error tracking/alerting (≈4 `console.*` total); the platform
  queue has no dead-letter queue; AI Gateway off by default; `db:migrate` re-runs
  all migrations by hand (safe only while every migration is `IF NOT EXISTS`).
- **MED (a11y)** — book-grid cards and AppBar nav are `div`/`a`+`onClick` with no
  role/tabIndex/keyboard support.
- **LOW** — dual catalog source-of-truth (`window.BOOKS` vs `catalog.js`);
  duplicated `profileRef`/seed-fallback helpers; dead `Placeholder` export;
  embeddings ledger records the first vector's dim for all sids; "最近上链" frontend
  sort branch still missing (backend now provides `createdAt`).

Verifier **refuted** one finding: the knowledge-graph pipeline is not
"misconfigured/inert" — it is a deliberate, consistently flag-gated
(`GRAPH_ENABLED`) pre-launch feature.

## Second pass — fixed (commit cf76e41, deployed + live-verified)

A deeper second audit (re-review of recent changes + under-covered subsystems:
chains/Sui-verify, WebAuthn, the agent/MCP trust boundary, the import pipeline,
reader/frontend, cross-cutting validation). New findings fixed:

- **HIGH** — `/api/mcp/call` was unauthenticated AND unrate-limited while reaching
  billable Workers AI (`get_echoes`) + D1 writes; the first-pass AI cost fix missed
  it. Now per-IP rate-limited (verified: 25-burst → 24×429).
- **HIGH** — cross-publisher book takeover: `ON CONFLICT(id)` let any CLI-token
  holder overwrite another publisher's book. Added `assertBookWritable()` at every
  ingest entry point, threading the actor (`functions/lib/catalog.ts`, `books.ts`).
- **HIGH** — account-switch leaked the previous user's highlights/notes/shared-cards/
  reading-place (`liber.hl.*`/`liber.nt.*`/`liber.shared`/`liber.place` never cleared);
  the shelf-only fix missed them (`product-app.jsx`).
- **HIGH** — global translation-cache poisoning via `PUT /ai/translations/:cacheKey`;
  now admin-gated (verified: non-admin → 403).
- **MED** (3 were regressions from my own recent batches) — SSRF redirect-follow
  bypass in `/books/ingest` (now manual redirect + per-hop re-validation + 12MB cap);
  `runPlatformJob` re-ran `'done'` jobs on queue redelivery (now excluded);
  `/billing/admin/activate` non-constant-time token compare (now `hasAdminToken`);
  passkey `userVerification` mismatch (now `requireUserVerification:false`).

Confirmed SOUND by the verifier (no change needed): zh-convert placeholder, upvote
no-double-count, platform stale-reclaim serialization, listBooks sort injection-safe,
no XSS surface (zero `dangerouslySetInnerHTML`), path-traversal not possible (keys
via `safeId`).

## Second pass — remaining backlog

- **MED** — passkey: non-atomic registration (orphan user on cred-insert failure);
  no `excludeCredentials` + localStorage-only heuristic can fork a second account.
- **MED** — import: `deleteStaleChapters` orphans R2 chapter blobs + `blobs` rows;
  `safeId` strips CJK so Chinese-only titles without an id get a random id (breaks
  idempotent re-publish); chapter text silently truncates to `text_preview` (5000
  chars) on R2 miss.
- **MED** — `/groups/:id` builds every group then keeps one (N×~6 queries); malformed
  JSON body → 500 instead of 400 on most write routes (a few fixed: mcp/ai/billing).
- **MED** — Sui adapter can't verify zkLogin signatures (doc claims it; fails closed).
- **LOW** — read_passage/search N+1 + leading-wildcard LIKE; vote-count merges scan
  the whole votes table (no `target_id IN (...)`); `searchDynamic` fabricates sentence
  sids; highlight color stored unvalidated; unbounded social post body sizes;
  `/vote` accepts arbitrary `target_type`; login address strict-compare vs
  `sameSuiAddress`; dead `chainById`.

## Methodology

8 parallel auditors read real code and reported findings with `file:line`; every
critical/high finding was re-verified by an independent adversarial agent against
the cited code (which down-rated several and refuted one). Deploys are local
(`npm run deploy`); migrations are applied by hand (`npm run db:migrate`).
