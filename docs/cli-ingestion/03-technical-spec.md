# CLI Ingestion Technical Spec

## Commands

## Package Contract

- npm package name: `liber-cli`.
- CLI binary: `liber`.
- Published files: `bin/`, `src/`, `README.md`, `LICENSE`.
- Runtime: Node.js `>=22`.
- Dependencies: `@mysten/sui` for local Sui private-key signing.
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

### `liber auth browser [--api-url <url>] [--no-open] [--timeout <seconds>]`

Starts a browser-wallet device authorization flow.

State machine:

- CLI calls `POST /api/auth/cli/start`.
- Backend returns `{ deviceCode, userCode, authorizeUrl, interval }`.
- CLI opens `authorizeUrl` unless `--no-open` is present.
- Browser page connects a Sui wallet through Wallet Standard and calls
  `POST /api/auth/cli/approve`.
- CLI polls `GET /api/auth/cli/poll/:deviceCode`.
- When approved, CLI stores the returned publish token as its bearer token.

The publish token is accepted by `/api/books/ingest` and is scoped to Liber
publish operations. The CLI never asks users to paste a private key in this
browser flow.

### `liber auth key [--api-url <url>] [--key-file <path>|--private-key <key>] [--scheme ed25519|secp256k1|secp256r1]`

Signs a backend nonce locally with a Sui private key and exchanges the resulting
wallet session for a CLI publish token.

State machine:

- CLI reads the Sui private key from `--key-file`, `--private-key`, or
  `LIBER_SUI_PRIVATE_KEY`.
- Bech32 `suiprivkey...` keys carry their scheme. Raw hex keys require
  `--scheme`.
- CLI derives the wallet address locally. The private key is never written to
  config and is never sent to the backend.
- CLI calls `POST /api/auth/nonce`, signs the returned personal message, then
  calls `POST /api/auth/verify`.
- CLI calls `POST /api/auth/cli/token` with the wallet session token.
- CLI stores only the returned publish token and wallet address.

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
chapters, includes the original EPUB bytes as base64, builds a
`/api/books/ingest` payload, and POSTs it with
`Authorization: Bearer <admin token>`.

The bearer token may be either the configured `ADMIN_TOKEN` or a CLI publish
token minted by `liber auth browser`.

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
- `epubMediaType: "application/epub+zip"`
- `epubBase64: string`

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

## Storage Model

- Canonical book asset: original EPUB, addressed by SHA-256 in the manifest
  and uploaded to backend storage during publish.
- Reader/search derivative: plain text chapters extracted from EPUB spine and
  sent to `/api/books/ingest`.
- Backend storage: the original EPUB, extracted chapter text blobs, and the
  JSON manifest are written to R2 and Walrus when configured.
- Chain storage: Sui registry stores only a content reference, kind, license,
  publisher, and epoch. Full EPUB or chapter text is not stored directly on
  chain.
