# CLI Ingestion Architecture

## Components

- `packages/liber-cli`: standalone npm package named `liber-cli`.
- `packages/liber-cli/bin/liber.mjs`: executable CLI entrypoint.
- `packages/liber-cli/src/liber-core.mjs`: reusable Node implementation for
  EPUB inspection, license validation, manifest creation, and publish dry-runs.
- `functions/lib/license.ts`: backend enforcement for the same publish policy.
- `packages/liber-cli/test/*.test.mjs`: Node test coverage for the package.

## Data Flow

1. Curator or agent runs `liber book inspect <file.epub>`.
2. CLI reads the EPUB ZIP container, locates OPF metadata, and extracts title,
   creator, identifier, language, rights, manifest, and spine.
3. CLI validates explicit and embedded license evidence.
4. CLI writes a `liber.book-manifest.v1` JSON manifest.
5. CLI dry-run shows the admin ingest and on-chain registration plan.
6. Backend ingest normalizes or rejects the submitted license before writing D1,
   storage, or Sui registry records.

## Agent Readability

Commands expose `--json` output for programmatic use. Manifests are stable JSON
objects with explicit schema, hashes, source URL, source license, evidence, and
publish policy.

## Mechanical Rules

- No network write occurs without an explicit future non-dry-run implementation.
- The CLI uses Node standard library only.
- License strings are normalized before being stored or sent on-chain.
- Unknown or restrictive licenses fail closed.
- The root app stays private; only `packages/liber-cli` is publishable.
