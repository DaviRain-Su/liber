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

## Second pass — backlog FIXED (commits 3d68590, 384c427)

- Validation: malformed JSON body → 400 (global `onError`); highlight color
  whitelist; `/vote`+`/comments` target_type allowlist; comment body cap; login
  via `sameSuiAddress`; safe-parse of two DB JSON columns.
- Import: `deleteStaleChapters` deletes the R2 chapter blob + `blobs` row;
  `safeId` derives a stable `book_<fnv1a>` for CJK-only titles (idempotent
  re-publish, underscore prefix avoids slug collision).
- Perf: `read_passage` reads one chapter (was loading all); `search` term clamp;
  `/groups/:id` loads one group; vote-count merges bounded to visible ids.
- **`/api/groups` was timing out** (N×7 queries per book; catalogue grew to
  hundreds) — now prioritises active groups, caps at 24, builds in parallel
  (25s timeout → ~3s).
- Passkey: atomic user+credential insert (`db.batch`); remove dead `chainById`;
  correct the Sui zkLogin doc claim.

## Second pass — remaining backlog

- **MED** — `/api/groups` still ~3s (24 books × ~6 queries). Proper fix: batch the
  per-group aggregates into a handful of grouped queries (sub-second).
- **MED** — passkey: no `excludeCredentials` + localStorage-only heuristic can fork
  a second account on a device whose synced passkey isn't in localStorage.
- **MED** — chapter text silently truncates to `text_preview` (5000 chars) on an R2
  miss (low-probability data-loss edge); Sui adapter can't verify zkLogin (needs a
  SuiClient threaded into `verifyPersonalMessageSignature`; fails closed today).
- **LOW** — `/shares` comment/save counts still full-scan; `searchDynamic` fabricates
  sentence sids; unbounded `/works`/`/shares`/`/threads` body sizes; leading-wildcard
  LIKE in search; corrupt-DB JSON in a few more spots.

## Third pass — backlog FIXED

8 parallel investigators re-read the cited code, then a 4-dimension adversarial
review verified the diff before a local deploy.

- **`/api/groups` → sub-second.** User-independent group "cards" are cached per
  book in KV (`gcard:<bookId>`, 60s — KV's TTL floor) via `liveGroupsCards()`;
  cold-cache misses still batch-build in one `buildLiveGroupsBatch` call. The
  per-user `joined` flag is never cached — it's stamped fresh from one bounded,
  indexed `group_members WHERE user_id=? AND group_id IN (…)` query, so a hit
  serves the heavy aggregates instantly while `joined` stays correct right after
  a join/leave.
- **`/shares` aggregates bounded.** Comment and save counts now use
  `… target_id IN (…) GROUP BY …` over the visible share ids (the `voteCountsFor`
  pattern) instead of a full-table `GROUP BY`.
- **Body caps.** `cap()` trims+length-limits every create endpoint: `/shares`
  (msg count ≤100, per-field caps, 200 KB hard guard), `/works` (50 KB), `/threads`
  and `/groups/:id/posts` (4 KB) — matching the existing comment cap.
- **`searchDynamic` real sids.** Sentence anchors now come from the same
  `textToChapter()` pipeline the reader uses (real running sid), not a fabricated
  `s1`/`s2` index. The field was unused by the UI (it navigates by `bookId`), so
  this is a truthfulness/forward-compat fix with zero UI risk.
- **Chapter R2-miss no longer silent.** `getChapterText`/`getChapters` return a
  `truncated` flag (blob missing **and** `text_size > preview length`); the reader
  shows a "仅显示节选预览" notice, and `getReaderEpub` skips truncated chapters so a
  downloadable artifact never bakes in partial content. Short chapters (≤5000,
  `preview == full`) are correctly never flagged.
- **Stripe webhook JSON.parse** guarded → 400 instead of an unhandled 500.
- **Passkey reconciliation.** `passkeyRegisterVerify` maps an already-enrolled
  credential id back to its existing account (idempotent re-registration / no
  duplicate-key crash) instead of forking. Safe: a matching `cred.id` can only
  come from the authenticator that holds it, cryptographically bound to this
  ceremony's challenge.

## Third pass — deliberately deferred (with reasons)

- **zkLogin verification** stays **fails-closed** (safe). Enabling it needs a salt
  service (Enoki) **and** a frontend zkLogin/OAuth flow that doesn't exist; the
  wallet path uses Wallet-Standard personal-message sigs only. Half-enabling a new
  auth path adds attack surface with zero current consumer — not a bug, a decision.
- **Passkey client "login-first"** (the actual fix for the synced-passkey /
  cleared-localStorage fork) is a **client UX tradeoff**: forcing a discoverable
  sign-in attempt before registration adds an empty-sheet prompt for every genuine
  first-time signup (the common case) to close a narrow edge. Deferred to a product
  call rather than changing live signup UX silently. Server reconciliation (above)
  is the safe half.
- **FTS5 search** for the leading-wildcard `LIKE '%term%'`: SQLite FTS5's default
  tokenizer breaks CJK substring matching, so it would **regress** Chinese search;
  the `trigram` tokenizer is the real path but is a larger change. At ~750 books the
  `LIKE` scan is acceptable; revisit with the trigram tokenizer at scale.
- **`auth.ts` JSON.parse** hardening (CLI token / device poll) is left untouched to
  avoid colliding with concurrent edits in that file; `billing.ts` was the
  in-scope spot and is fixed.

## Fourth pass — multi-chain login + perf/robustness batch

- **EVM + Solana wallet login** added beside Sui. `/auth/verify` takes a `chain`
  field; pure tested verifiers in `functions/lib/chains/sigverify.mjs`
  (EIP-191 ecrecover / ed25519). Sui path unchanged. E2E-verified live (valid →
  session, forged → 401). 8 tests anchored to the canonical priv=1 vector.
- **Passkey fork fixed** the right way: onboarding now has explicit
  "用通行密钥登录" (discoverable sign-in → finds synced passkeys, no fork) and
  "创建通行密钥" (the only account-minting path). No first-timer prompt regression.
- **`getChapters` N+1 → parallel R2 reads** (Promise.all). Reader chapter load
  ~10s → ~2.6s.
- **`readingStats` no longer pulls full history into memory** — `COUNT(*)` for the
  totals + a 400-day-bounded timestamp fetch for streak, all in one `db.batch`.
  Matters most on `/readers` (runs per-reader). Counts stay exact.
- **Bounds/headers**: `/platform/search` limit capped (≤50); `/reading/:bookId`
  heat `GROUP BY` gets `ORDER BY n DESC LIMIT 5000`; `/charts` gets
  `Cache-Control: public, max-age=60`.
- **Frontend crash-guards**: `product-social.jsx` `liber.shared` parse now
  array-checked (a non-array value was spread → "not iterable" → blank page);
  `product-app.jsx` route init requires a sane `{screen}` shape.
- **Verified non-issues** (checked against real code, not fixed): `product-search`
  already discards stale responses via a term guard; `product-reader` `sendAI` is
  re-created each render so its async continuation uses question-time context.
- **Still open (concurrent-editor files — coordinate first):** `auth.ts`
  `getCliPublishToken`/`pollCliDevice` unguarded `JSON.parse` (HIGH); `books.ts`
  `/books`+`/search` Cache-Control + limit cap.

## Methodology

8 parallel auditors read real code and reported findings with `file:line`; every
critical/high finding was re-verified by an independent adversarial agent against
the cited code (which down-rated several and refuted one). Deploys are local
(`npm run deploy`); migrations are applied by hand (`npm run db:migrate`).
