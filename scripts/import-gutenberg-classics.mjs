#!/usr/bin/env node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBookManifest,
  createIngestPayload,
  inspectEpub,
  publishBookManifestChunked,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const API_URL = "https://liber.davirain.xyz";

const BOOKS = [
  { id: "daodejing-gutenberg-zh", pg: 7337, title: "道德經", category: "哲学 · 道家", expect: "道德經" },
  { id: "laozi-gutenberg-zh", pg: 24039, title: "老子", category: "哲学 · 道家", expect: "老子" },
  { id: "liezi-gutenberg-zh", pg: 7341, title: "列子", category: "哲学 · 道家", expect: "列子" },
  { id: "lunyu-gutenberg-zh", pg: 23839, title: "論語", category: "哲学 · 儒家", expect: "論語" },
  { id: "mengzi-gutenberg-zh", pg: 24178, title: "孟子", category: "哲学 · 儒家", expect: "孟子" },
  { id: "yijing-gutenberg-zh", pg: 25501, title: "易經", category: "经典 · 易学", expect: "易經" },
  { id: "shijing-gutenberg-zh", pg: 23873, title: "詩經", category: "文学 · 诗经", expect: "詩經" },
  { id: "liji-gutenberg-zh", pg: 24048, title: "禮記", category: "经典 · 礼学", expect: "禮記" },
  { id: "sunzi-bingfa-gutenberg-zh", pg: 23864, title: "孫子兵法", category: "兵法 · 军事", expect: "孫子" },
  { id: "mozi-gutenberg-zh", pg: 24240, title: "墨子", category: "哲学 · 先秦", expect: "墨子" },
  { id: "hanfeizi-gutenberg-zh", pg: 24049, title: "韩非子", category: "哲学 · 法家", expect: "韩非子" },
  { id: "tangshi300-gutenberg-zh", pg: 52323, title: "唐诗三百首", category: "文学 · 诗歌", expect: "唐诗" },
];

function parseArgs(argv) {
  const out = { publish: false, json: false, apiUrl: API_URL, ids: BOOKS.map((b) => b.id) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--json") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--api-url" || arg === "--ids") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--api-url") out.apiUrl = value.replace(/\/+$/, "");
      else out.ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function epubUrl(book) {
  return `https://www.gutenberg.org/ebooks/${book.pg}.epub.images`;
}

function sourceUrl(book) {
  return `https://www.gutenberg.org/ebooks/${book.pg}`;
}

async function download(url, filePath) {
  const res = await fetch(url, { headers: { "user-agent": "liber-gutenberg-import/0.1" } });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await writeFile(filePath, new Uint8Array(await res.arrayBuffer()));
}

async function probe(apiUrl, book) {
  const [bookRes, contentRes, searchRes] = await Promise.all([
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`),
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}/content/1`),
    fetch(`${apiUrl}/api/search?q=${encodeURIComponent(book.expect)}`),
  ]);
  return {
    bookFound: bookRes.ok && Boolean((await bookRes.json()).book),
    contentFound: contentRes.ok && Boolean((await contentRes.json()).text),
    searchReturned: searchRes.ok && Array.isArray((await searchRes.json()).books),
  };
}

async function importOne(book, options) {
  process.stderr.write(`[gutenberg] ${book.id} #${book.pg} download...\n`);
  const dir = await mkdtemp(path.join(tmpdir(), "liber-gutenberg-"));
  const filePath = path.join(dir, `${book.id}.epub`);
  await download(epubUrl(book), filePath);

  const info = await inspectEpub(filePath);
  const license = await verifyPublishLicense(info, { source: sourceUrl(book), license: "PUBLIC-DOMAIN" });
  const manifest = await createBookManifest(filePath, { source: sourceUrl(book), license: "PUBLIC-DOMAIN" });
  const payload = await createIngestPayload(manifest, { id: book.id, category: book.category });

  let publish = null;
  let live = null;
  if (options.publish) {
    process.stderr.write(`[gutenberg] ${book.id} publish ${payload.chapters.length} chapters...\n`);
    publish = await publishBookManifestChunked(manifest, {
      apiUrl: options.apiUrl,
      id: book.id,
      category: book.category,
      ingestPayload: payload,
      concurrency: 6,
      onProgress: (event) => {
        if (event.stage === "chapter") {
          process.stderr.write(`[gutenberg] ${book.id} chapter ${event.current}/${event.total}: ${event.chapter.title}\n`);
        } else {
          process.stderr.write(`[gutenberg] ${book.id} ${event.stage}...\n`);
        }
      },
    });
    live = await probe(options.apiUrl, book);
  }

  return {
    id: book.id,
    pg: book.pg,
    title: info.metadata.title || book.title,
    creator: info.metadata.creator || null,
    category: book.category,
    source: sourceUrl(book),
    sha256: info.sha256,
    license: license.license,
    accepted: license.accepted,
    chapters: payload.chapters.length,
    published: Boolean(publish),
    live,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = BOOKS.filter((book) => options.ids.includes(book.id));
  if (!selected.length) throw new Error(`No matching books for --ids ${options.ids.join(",")}`);
  const results = [];
  for (const book of selected) results.push(await importOne(book, options));
  const output = { mode: options.publish ? "publish" : "dry-run", apiUrl: options.apiUrl, results };
  process.stdout.write(options.json ? `${JSON.stringify(output, null, 2)}\n` : `${results.map((r) => `${r.id}: ${r.title}`).join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
