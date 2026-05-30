# CLI Ingestion Test Spec

## Happy Path

- A minimal EPUB with `dc:rights` containing `CC0-1.0` is inspected
  successfully.
- `verify-license` accepts explicit `CC0-1.0`.
- `verify-license` accepts explicit `PUBLIC-DOMAIN`.
- `package` writes a manifest with schema `liber.book-manifest.v1`.
- `publish --dry-run` prints a plan and exits `0`.
- `npm pack --dry-run` succeeds for the standalone package.

## Boundary

- EPUB title, creator, language, identifier, and rights are extracted from OPF.
- The EPUB asset SHA-256 is stable.
- Text output and JSON output both work.

## Error / Attack

- `CC BY-NC` is rejected.
- Unknown license evidence is rejected.
- Wrong file extension is irrelevant; invalid ZIP still fails.
- `publish` without `--dry-run` exits non-zero.
- The root application package remains private while `packages/liber-cli` is
  publishable.
