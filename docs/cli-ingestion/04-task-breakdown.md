# CLI Ingestion Task Breakdown

## Tasks

- Commit: create lifecycle docs and publish policy.
- Commit: write CLI tests for EPUB inspect, license acceptance, license
  rejection, manifest generation, and dry-run publish.
- Commit: implement Node standard-library EPUB parser.
- Commit: implement CLI command routing and JSON/text output.
- Commit: split the CLI into standalone npm package `packages/liber-cli`.
- Commit: verify `npm pack --dry-run` contains only distributable files.
- Commit: enforce license policy in backend ingest.
- Commit: update README and BACKEND references.
- Commit: run `npm run test:cli`, `npm run pack:cli`, `npm run typecheck`,
  and `npm run build`.
- Commit: add a repeatable real-content smoke test that downloads a known
  public-domain EPUB, builds the ingest payload, and optionally publishes it to
  the live API when local publish auth exists.

## Constraints

Each task is under four hours. This is production code, not an exploratory
branch, so Phase 3 and Phase 5 are required before implementation.
