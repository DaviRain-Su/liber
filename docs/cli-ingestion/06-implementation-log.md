# CLI Ingestion Implementation Log

## 2026-05-30

- Implemented first slice: local EPUB validation, license allowlist, manifest
  packaging, dry-run publish, and backend license enforcement.
- Added Node test coverage for inspect, license accept/reject, manifest creation,
  and dry-run publish behavior.
- Split the CLI into `packages/liber-cli`, a standalone npm package named
  `liber-cli` with its own bin, exports, README, package scripts, and pack
  validation.
- Implemented next slice: stored CLI auth config, EPUB spine text extraction,
  ingest payload generation, and real admin API publish through
  `/api/books/ingest`.
- Implemented browser-wallet device authorization: CLI starts/polls, browser
  signs in with Wallet Standard, backend mints a CLI publish token, and book
  ingest accepts that scoped token.
- Implemented local Sui private-key authorization: CLI signs the backend nonce
  locally, receives a wallet session, then exchanges it for a CLI publish token.
- Publish payloads now include the original EPUB bytes, and backend ingest
  stores that EPUB alongside extracted chapter text and the JSON manifest.
- Added `npm run smoke:real-content`, a repeatable Project Gutenberg EPUB smoke
  test that defaults to read-only mode and can publish after local auth is
  configured.
- Added Project Gutenberg cleanup for imported EPUB text: strip legal
  header/footer, drop Gutenberg-only preface chapters, clean derived titles,
  and remove stale D1 chapter rows on re-ingest.
