# CLI Ingestion Review Report

## Review Checklist

- License policy fails closed.
- CLI has JSON output for agents.
- No network writes in first slice.
- Backend direct ingest cannot bypass license policy.
- Tests cover happy path, boundaries, and rejection paths.

## Current Status

Implemented and locally verified with:

- `npm run test:cli`
- `npm run pack:cli`
- `npm run typecheck`
- `npm run build`
- `npm pack` to `/private/tmp` plus temporary install and `liber license explain`
- `npm publish --dry-run` inside `packages/liber-cli`
- CLI tests for auth config, EPUB chapter extraction, ingest payload generation,
  and non-dry-run publish with injected fetch.

## Release Automation

- Added `.github/workflows/publish-cli.yml` for manual npm publish.
- Real publish requires GitHub secret `NPM_TOKEN`.
- Workflow validates `npm test`, `npm run pack:cli`, duplicate npm version, and
  supports `dry_run=true` before real publish.
