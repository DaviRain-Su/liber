# liber-cli

Agent-friendly CLI for validating and packaging CC0 / public-domain EPUB books
for Liber.

## Install

```bash
npm install -g liber-cli
```

From this repository during development:

```bash
npm run cli -- license explain
```

## Commands

```bash
liber license explain
liber auth status
liber auth logout
liber book inspect <file.epub> [--json]
liber book verify-license <file.epub> --source <url> [--license CC0-1.0|PUBLIC-DOMAIN] [--evidence <text>] [--json]
liber book package <file.epub> --source <url> --license CC0-1.0|PUBLIC-DOMAIN --out <manifest.json> [--evidence <text>]
liber book publish <manifest.json> --dry-run [--api-url <url>]
```

## Publish Policy

Accepted:

- `CC0-1.0`
- `PUBLIC-DOMAIN`

Rejected:

- `CC BY`
- `CC BY-SA`
- `CC BY-NC`
- unknown licenses
- all-rights-reserved content

`book publish` is dry-run only in this version. It prints the planned storage,
admin ingest, and on-chain registry payloads without making network writes.
