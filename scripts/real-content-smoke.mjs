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
    [--expect <search-term>] [--json]

Default fixture:
  Project Gutenberg #132, The Art of War, PUBLIC-DOMAIN.

Without --publish this script performs the real EPUB download, inspect,
license check, manifest creation, ingest payload creation, and live read-only
API probes, but does not write to Liber.
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
    if (arg === "--publish" || arg === "--json") {
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

async function fetchOk(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 500)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

async function download(url, outPath) {
  const res = await fetch(url, { headers: { "user-agent": "liber-real-content-smoke/0.1" } });
  if (!res.ok) throw new Error(`Failed to download EPUB: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
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
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "liber-real-content-"));
  const epubPath = path.join(dir, `${options.id}.epub`);
  const downloaded = await download(options.epubUrl, epubPath);
  const info = await inspectEpub(epubPath);
  const license = verifyPublishLicense(info, { source: options.source, license: options.license });
  const manifest = await createBookManifest(epubPath, { source: options.source, license: options.license });
  const payload = await createIngestPayload(manifest, { id: options.id, category: "文学 · 经典" });
  const plan = dryRunPublishPlan(manifest, { apiUrl: options.apiUrl, ingestPayload: payload });

  let publish = null;
  if (options.publish) {
    publish = await publishBookManifest(manifest, {
      apiUrl: options.apiUrl,
      id: options.id,
      category: "文学 · 经典",
    });
  }

  const [health, book, content, search, proof] = await Promise.all([
    maybeGet("/api/health", options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}`, options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}/content/1`, options),
    maybeGet(`/api/search?q=${encodeURIComponent(options.expect)}`, options),
    maybeGet(`/api/books/${encodeURIComponent(options.id)}/proof`, options),
  ]);

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
