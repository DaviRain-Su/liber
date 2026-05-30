# CLI Ingestion Evolution

## Next Decisions

- Add authenticated wallet login for CLI publish operations.
- Convert EPUB spine documents into normalized chapter text for the existing
  reader, while preserving the original EPUB as the canonical asset.
- Register a stricter on-chain license enum instead of free-form license text.
- Add remote source fetching and checksum capture when network publish is
  enabled.

## Complexity Budget

- Keep the first CLI dependency-free.
- Add EPUB rendering or HTML sanitization only when frontend reader work starts.
- Add non-dry-run publishing only after wallet/session auth is designed.
