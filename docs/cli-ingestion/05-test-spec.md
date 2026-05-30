# CLI Ingestion Test Spec

## Happy Path

- A minimal EPUB with `dc:rights` containing `CC0-1.0` is inspected
  successfully.
- `verify-license` accepts explicit `CC0-1.0`.
- `verify-license` accepts explicit `PUBLIC-DOMAIN`.
- `package` writes a manifest with schema `liber.book-manifest.v1`.
- `publish --dry-run` prints a plan and exits `0`.
- `extract` returns text chapters from EPUB spine documents.
- `publish` with an admin token POSTs the ingest payload to a mock API.
- `publish` payload includes the original EPUB bytes as the canonical storage
  asset.
- `auth login/status/logout` persists and clears CLI config without printing the
  token value.
- Browser auth core flow starts a device authorization, polls, and receives a
  publish token.
- Private-key auth signs a nonce locally and exchanges the wallet session for a
  CLI publish token.
- `npm pack --dry-run` succeeds for the standalone package.

## Boundary

- EPUB title, creator, language, identifier, and rights are extracted from OPF.
- The EPUB asset SHA-256 is stable.
- Text output and JSON output both work.
- EPUB HTML tags are removed while paragraph boundaries are preserved.

## Error / Attack

- `CC BY-NC` is rejected.
- Unknown license evidence is rejected.
- Wrong file extension is irrelevant; invalid ZIP still fails.
- `publish` without `--dry-run` and without an admin token exits non-zero.
- API publish failures include the HTTP status and response body.
- Browser auth timeout/expired states fail instead of saving a token.
- Publishing fails if the EPUB file no longer matches the packaged manifest
  hash.
- Raw-hex private keys fail without an explicit key scheme.
- The root application package remains private while `packages/liber-cli` is
  publishable.
