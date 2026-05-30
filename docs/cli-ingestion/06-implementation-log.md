# CLI Ingestion Implementation Log

## 2026-05-30

- Implemented first slice: local EPUB validation, license allowlist, manifest
  packaging, dry-run publish, and backend license enforcement.
- Added Node test coverage for inspect, license accept/reject, manifest creation,
  and dry-run publish behavior.
- Split the CLI into `packages/liber-cli`, a standalone npm package named
  `liber-cli` with its own bin, exports, README, package scripts, and pack
  validation.
