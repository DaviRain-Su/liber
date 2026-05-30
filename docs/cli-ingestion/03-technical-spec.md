# CLI Ingestion Technical Spec

## Commands

## Package Contract

- npm package name: `liber-cli`.
- CLI binary: `liber`.
- Published files: `bin/`, `src/`, `README.md`, `LICENSE`.
- Runtime: Node.js `>=20`.
- Dependencies: none beyond Node standard library.
- Public API export: `import { inspectEpub } from "liber-cli"`.

### `liber license explain`

Prints the publish policy. Exit `0`.

### `liber book inspect <file.epub> [--json]`

Inputs:

- `file.epub`: readable EPUB file path.
- `--json`: emit JSON instead of text.

Output fields:

- `path: string`
- `size: number`
- `sha256: string`
- `mimetype: "application/epub+zip"`
- `opfPath: string`
- `metadata.title?: string`
- `metadata.creator?: string`
- `metadata.language?: string`
- `metadata.identifier?: string`
- `metadata.rights: string[]`
- `manifest: Array<{ id, href, mediaType, properties? }>`
- `spine: string[]`

Errors:

- `EPUB_NOT_FOUND`
- `EPUB_BAD_ZIP`
- `EPUB_BAD_MIMETYPE`
- `EPUB_NO_CONTAINER`
- `EPUB_NO_OPF`

### `liber book verify-license <file.epub> --source <url> [--license <id>] [--evidence <text>] [--json]`

Allowed normalized licenses:

- `CC0-1.0`
- `PUBLIC-DOMAIN`

Rejected signals:

- `CC BY`
- `CC-BY`
- `CC BY-SA`
- `CC BY-NC`
- `NonCommercial`
- `All rights reserved`
- no accepted evidence

State machine:

- `unknown + accepted evidence -> accepted`
- `unknown + explicit accepted license -> accepted`
- `unknown + rejected signal -> rejected`
- `accepted + rejected signal -> rejected`
- `unknown + no evidence -> rejected`

### `liber book package <file.epub> --source <url> --license <id> --out <manifest.json> [--evidence <text>]`

Creates a `liber.book-manifest.v1` JSON manifest.

Manifest fields:

- `schema: "liber.book-manifest.v1"`
- `createdAt: ISO-8601 string`
- `source.url: string`
- `source.license: "CC0-1.0" | "PUBLIC-DOMAIN"`
- `source.evidence?: string`
- `book.title?: string`
- `book.creator?: string`
- `book.language?: string`
- `book.identifier?: string`
- `assets.epub.path: string`
- `assets.epub.sha256: string`
- `assets.epub.size: number`
- `assets.epub.mediaType: "application/epub+zip"`
- `epub.opfPath: string`
- `epub.rights: string[]`
- `epub.manifest: array`
- `epub.spine: string[]`
- `publishPolicy.accepted: boolean`
- `publishPolicy.reason: string`

### `liber book publish <manifest.json> --dry-run`

Reads a manifest and prints the planned:

- EPUB storage asset.
- Admin ingest target.
- On-chain registry payload `{ contentId, kind: "book", license }`.

Without `--dry-run`, exits non-zero until network publishing is implemented.

## ZIP/EPUB Algorithm

- Locate ZIP EOCD signature `0x06054b50` in the last 65,557 bytes.
- Read central directory entries.
- For each file, read the local header and data.
- Support compression methods `0` (store) and `8` (deflate).
- Require `mimetype` file content to exactly equal `application/epub+zip`.
- Parse `META-INF/container.xml` for the OPF `full-path`.
- Parse OPF metadata with XML tag and attribute extraction.

## Boundary Conditions

- Missing EPUB file.
- Empty file.
- ZIP without EOCD.
- ZIP64 archive.
- Unsupported compression method.
- EPUB without `mimetype`.
- EPUB with wrong mimetype.
- EPUB without container.
- EPUB without OPF rootfile.
- OPF missing title.
- OPF with multiple rights values.
- Explicit license conflicts with embedded restrictive rights.
- Unknown license.
