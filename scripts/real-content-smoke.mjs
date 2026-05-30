#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBookManifest,
  createIngestPayload,
  dryRunPublishPlan,
  inspectEpub,
  publishBookManifest,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const DEFAULTS = {
  apiUrl: "https://liber.davirain.xyz",
  id: "art-of-war-gutenberg",
  epubUrl: "https://www.gutenberg.org/ebooks/132.epub.noimages",
  source: "https://www.gutenberg.org/ebooks/132",
  license: "PUBLIC-DOMAIN",
  expect: "war",
};

function usage() {
  return `Real content smoke test

Usage:
  node scripts/real-content-smoke.mjs [--publish] [--api-url <url>] [--id <id>]
    [--epub-url <url>] [--source <url>] [--license PUBLIC-DOMAIN|CC0-1.0]
    [--expect <search-term>] [--json] [--quiet]

Default fixture:
  Project Gutenberg #132, The Art of War, PUBLIC-DOMAIN.

Without --publish this script performs the real EPUB download, inspect,
license check, manifest creation, ingest payload creation, and live read-only
API probes, but does not write to Liber.

Progress is written to stderr so --json remains machine-readable on stdout.
`;
}

function parseArgs(argv) {
  const out = { ...DEFAULTS, publish: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--publish" || arg === "--json" || arg === "--quiet") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    out[key] = value;
    i += 1;
  }
  out.apiUrl = out.apiUrl.replace(/\/+$/, "");
  return out;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function elapsed(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function createProgress(options) {
  if (options.quiet) return {
    log: () => {},
    step: async (_label, fn) => fn(() => {}),
  };
  const log = (message) => process.stderr.write(`[smoke] ${message}\n`);
  const step = async (label, fn) => {
    const startedAt = Date.now();
    log(`${label}...`);
    const timer = setInterval(() => {
      log(`${label} still running (${elapsed(startedAt)})`);
    }, 5000);
    try {
      const result = await fn((message) => log(`${label}: ${message}`));
      clearInterval(timer);
      log(`${label} done (${elapsed(startedAt)})`);
      return result;
    } catch (error) {
      clearInterval(timer);
      log(`${label} failed (${elapsed(startedAt)}): ${error.message}`);
      throw error;
    }
  };
  return { log, step };
}

async function fetchOk(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (error) {
    throw new Error(`Network fetch failed for ${url}: ${error.message || String(error)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 500)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

async function download(url, outPath, progress = () => {}) {
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": "liber-real-content-smoke/0.1" } });
  } catch (error) {
    throw new Error(`Network fetch failed for ${url}: ${error.message || String(error)}`);
  }
  if (!res.ok) throw new Error(`Failed to download EPUB: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  const chunks = [];
  let loaded = 0;
  let lastLog = 0;
  if (res.body) {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (loaded - lastLog > 64 * 1024 || loaded === total) {
        lastLog = loaded;
        progress(total ? `${formatBytes(loaded)} / ${formatBytes(total)}` : formatBytes(loaded));
      }
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()));
    loaded = chunks[0].byteLength;
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await writeFile(outPath, bytes);
  return { path: outPath, size: bytes.byteLength };
}

async function maybeGet(pathname, options) {
  try {
    return await fetchOk(`${options.apiUrl}${pathname}`);
  } catch (error) {
    return { error: error.message };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const progress = createProgress(options);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "liber-real-content-"));
  const epubPath = path.join(dir, `${options.id}.epub`);
  progress.log(`mode=${options.publish ? "publish" : "dry-run"} api=${options.apiUrl} id=${options.id}`);
  const downloaded = await progress.step("download EPUB", (tick) => download(options.epubUrl, epubPath, tick));
  const info = await progress.step("inspect EPUB", () => inspectEpub(epubPath));
  const license = await progress.step("verify license", async () => verifyPublishLicense(info, { source: options.source, license: options.license }));
  const manifest = await progress.step("create manifest", () => createBookManifest(epubPath, { source: options.source, license: options.license }));
  const payload = await progress.step("create ingest payload", () => createIngestPayload(manifest, { id: options.id, category: "文学 · 经典" }));
  const plan = await progress.step("create publish plan", async () => dryRunPublishPlan(manifest, { apiUrl: options.apiUrl, ingestPayload: payload }));

  let publish = null;
  if (options.publish) {
    progress.log(`publishing ${payload.chapters.length} chapters + ${formatBytes(downloaded.size)} EPUB; server may spend time writing R2/Walrus`);
    publish = await progress.step("POST /api/books/ingest", () => publishBookManifest(manifest, {
      apiUrl: options.apiUrl,
      id: options.id,
      category: "文学 · 经典",
    }));
  }

  const [health, book, content, search, proof] = await progress.step("probe live API", () => Promise.all([
    maybeGet("/api/health", options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}`, options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}/content/1`, options),
    maybeGet(`/api/search?q=${encodeURIComponent(options.expect)}`, options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}/proof`, options),
  ]));

  const summary = {
    mode: options.publish ? "publish" : "dry-run",
    apiUrl: options.apiUrl,
    fixture: {
      id: options.id,
      epubUrl: options.epubUrl,
      source: options.source,
      downloadedBytes: downloaded.size,
      title: info.metadata.title || null,
      creator: info.metadata.creator || null,
      sha256: info.sha256,
      licenseAccepted: license.accepted,
      license: license.license,
      chapters: payload.chapters.length,
      epubBytesIncluded: Boolean(payload.epubBase64),
    },
    plan: {
      ingestUrl: plan.api.ingestUrl,
      contentId: plan.registry.contentId,
      payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
    },
    publish,
    live: {
      healthOk: health.ok === true,
      bookFound: !book.error && Boolean(book.book),
      contentFound: !content.error && Boolean(content.text),
      searchReturned: !search.error && Array.isArray(search.books),
      proof,
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`Real content smoke (${summary.mode})
API: ${summary.apiUrl}
EPUB: ${summary.fixture.title || "(untitled)"} / ${summary.fixture.creator || "(unknown)"}
SHA-256: ${summary.fixture.sha256}
License: ${summary.fixture.license} (${summary.fixture.licenseAccepted ? "accepted" : "rejected"})
Chapters: ${summary.fixture.chapters}
EPUB included: ${summary.fixture.epubBytesIncluded ? "yes" : "no"}
Payload: ${summary.plan.payloadBytes} bytes
Live health: ${summary.live.healthOk ? "ok" : "failed"}
Book found: ${summary.live.bookFound ? "yes" : "no"}
Content found: ${summary.live.contentFound ? "yes" : "no"}
`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
