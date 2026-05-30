# Liber CLI Ingestion PRD

## Goal

Provide an agent-usable command line tool that checks whether a book can be
published to Liber before it reaches the admin ingest API or the on-chain
registry.

## Users

- Curators importing real books.
- Agents preparing book manifests.
- Maintainers validating contract and storage behavior before publishing.

## Scope

- Inspect EPUB files locally.
- Verify the publish license against Liber policy.
- Produce a deterministic book manifest with hashes and source evidence.
- Dry-run the publish plan for storage, database ingest, and on-chain registry.
- Enforce the same license allowlist in the backend ingest path.

## Non-goals

- Full EPUB rendering.
- Automatic copyright legal advice.
- Non-dry-run network publishing from the CLI in this first slice.
- Accepting attribution or non-commercial Creative Commons variants.

## License Policy

Liber publishable books must be either:

- `CC0-1.0`
- `PUBLIC-DOMAIN`

`CC BY`, `CC BY-SA`, `CC BY-NC`, unknown, and all-rights-reserved content are
not publishable in this platform policy. Public domain is not the same thing as
CC0, but both are allowed because they do not impose attribution,
share-alike, or non-commercial downstream constraints.

## Acceptance

- A valid EPUB with explicit `CC0-1.0` or `PUBLIC-DOMAIN` produces a manifest.
- A CC BY-NC or unknown license fails before publish.
- Backend ingest rejects non-publishable licenses even when called directly.
