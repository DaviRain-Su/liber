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

### `liber auth login --api-url <url> [--admin-token <token>] [--wallet <address>]`

Stores CLI publish configuration in `~/.liber/config.json`, or the path from
`LIBER_CONFIG`.

Fields:

- `apiUrl: string`
- `adminToken?: string`
- `wallet?: string`
- `updatedAt: ISO-8601 string`

Token precedence for publish:

1. `--admin-token`
2. `LIBER_ADMIN_TOKEN`
3. `ADMIN_TOKEN`
4. stored config `adminToken`

`auth status` never prints the token value, only whether one is configured.
`auth logout` removes the stored config.

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

### `liber book extract <file.epub> [--json]`

Extracts reader-ready text chapters from the EPUB spine.

Output:

- `chapters: Array<{ n: number; title: string; text: string }>`
- XHTML/HTML is converted to plain text.
- Script/style/head/nav content is ignored.
- Empty spine items are skipped.

### `liber book publish <manifest.json> [--dry-run] [--api-url <url>] [--admin-token <token>]`

Reads a manifest and prints the planned:

- EPUB storage asset.
- Admin ingest target.
- On-chain registry payload `{ contentId, kind: "book", license }`.

With `--dry-run`, exits before network writes.

Without `--dry-run`, reads the original EPUB path from the manifest, extracts
chapters, builds a `/api/books/ingest` payload, and POSTs it with
`Authorization: Bearer <admin token>`.

Publish payload:

- `id?: string`
- `title: string`
- `author?: string`
- `lang?: string`
- `year?: string`
- `sourceUrl: string`
- `license: "CC0-1.0" | "PUBLIC-DOMAIN"`
- `chapters: Array<{ n, title, text }>`
- `epubSha256: string`

## ZIP/EPUB Algorithm

- Locate ZIP EOCD signature `0x06054b50` in the last 65,557 bytes.
- Read central directory entries.
- For each file, read the local header and data.
- Support compression methods `0` (store) and `8` (deflate).
- Require `mimetype` file content to exactly equal `application/epub+zip`.
- Parse `META-INF/container.xml` for the OPF `full-path`.
- Parse OPF metadata with XML tag and attribute extraction.
- Resolve EPUB spine itemrefs through OPF manifest ids.
- Extract only `application/xhtml+xml` and `text/html` spine items.
- Convert chapter XHTML/HTML to normalized plain text before ingest.

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
- EPUB spine references missing manifest ids.
- EPUB spine has no readable text chapters.
- Publish without admin token.
- Publish target returns non-2xx.
