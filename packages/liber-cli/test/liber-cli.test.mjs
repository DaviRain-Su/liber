import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  clearCliConfig,
  createBookManifest,
  createIngestPayload,
  dryRunPublishPlan,
  extractEpubChapters,
  inspectEpub,
  loadCliConfig,
  publishBookManifest,
  saveCliConfig,
  verifyPublishLicense,
} from "../src/liber-core.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/liber.mjs", import.meta.url));

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body);
    const crc = crc32(body);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(body.length),
      u32(body.length),
      u16(name.length),
      u16(0),
      name,
      body,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(body.length),
      u32(body.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
}

async function writeEpub(rights = "CC0-1.0", chapterBodies = ["The way that can be spoken."]) {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-cli-"));
  const epubPath = path.join(dir, "book.epub");
  const manifestItems = chapterBodies
    .map((_, i) => `    <item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = chapterBodies
    .map((_, i) => `    <itemref idref="c${i + 1}"/>`)
    .join("\n");
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookid" version="3.0">
  <metadata>
    <dc:identifier id="bookid">urn:test:dao</dc:identifier>
    <dc:title>Dao De Jing</dc:title>
    <dc:creator>Laozi</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>${rights}</dc:rights>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;
  const zip = storedZip([
    { name: "mimetype", body: "application/epub+zip" },
    { name: "META-INF/container.xml", body: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>` },
    { name: "OEBPS/content.opf", body: opf },
    ...chapterBodies.map((body, i) => ({
      name: `OEBPS/chapter${i + 1}.xhtml`,
      body: `<html><head><title>Ignored</title><style>.x{}</style></head><body><nav>Skip me</nav><h1>Chapter ${i + 1}</h1><p>${body}</p></body></html>`,
    })),
  ]);
  await writeFile(epubPath, zip);
  return { dir, epubPath, sha256: createHash("sha256").update(zip).digest("hex") };
}

test("inspectEpub extracts OPF metadata and hashes the EPUB", async () => {
  const { epubPath, sha256 } = await writeEpub();
  const info = await inspectEpub(epubPath);

  assert.equal(info.mimetype, "application/epub+zip");
  assert.equal(info.sha256, sha256);
  assert.equal(info.opfPath, "OEBPS/content.opf");
  assert.equal(info.metadata.title, "Dao De Jing");
  assert.equal(info.metadata.creator, "Laozi");
  assert.equal(info.metadata.language, "en");
  assert.deepEqual(info.metadata.rights, ["CC0-1.0"]);
  assert.equal(info.manifest[0].href, "OEBPS/chapter1.xhtml");
  assert.deepEqual(info.spine, ["c1"]);
});

test("verifyPublishLicense accepts explicit CC0 and public domain", async () => {
  const { epubPath } = await writeEpub("Project Gutenberg public domain notice");
  const info = await inspectEpub(epubPath);

  assert.equal(verifyPublishLicense(info, { source: "https://www.gutenberg.org/ebooks/216", license: "CC0-1.0" }).accepted, true);
  const pd = verifyPublishLicense(info, { source: "https://www.gutenberg.org/ebooks/216", license: "PUBLIC-DOMAIN" });
  assert.equal(pd.accepted, true);
  assert.equal(pd.license, "PUBLIC-DOMAIN");
});

test("verifyPublishLicense rejects non-commercial and unknown licenses", async () => {
  const { epubPath } = await writeEpub("Creative Commons Attribution-NonCommercial 4.0");
  const info = await inspectEpub(epubPath);

  assert.equal(verifyPublishLicense(info, { source: "https://example.com/book", license: "CC0-1.0" }).accepted, false);
  assert.equal(verifyPublishLicense({ ...info, metadata: { ...info.metadata, rights: ["custom license"] } }, { source: "https://example.com/book" }).accepted, false);
});

test("createBookManifest writes stable publish metadata", async () => {
  const { epubPath, sha256 } = await writeEpub("CC0 1.0 Universal");
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
    evidence: "Publisher marks this EPUB as CC0 1.0 Universal.",
  });

  assert.equal(manifest.schema, "liber.book-manifest.v1");
  assert.equal(manifest.source.license, "CC0-1.0");
  assert.equal(manifest.assets.epub.sha256, sha256);
  assert.equal(manifest.publishPolicy.accepted, true);
  assert.equal(manifest.book.title, "Dao De Jing");
});

test("dryRunPublishPlan describes the storage and registry plan", async () => {
  const { epubPath } = await writeEpub();
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const plan = dryRunPublishPlan(manifest, { apiUrl: "https://liber.example" });

  assert.equal(plan.api.ingestUrl, "https://liber.example/api/books/ingest");
  assert.equal(plan.registry.kind, "book");
  assert.equal(plan.registry.license, "CC0-1.0");
});

test("extractEpubChapters extracts readable spine text", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph.", "Second paragraph."]);
  const chapters = await extractEpubChapters(epubPath);

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].n, 1);
  assert.equal(chapters[0].title, "Chapter 1");
  assert.match(chapters[0].text, /First paragraph\./);
  assert.doesNotMatch(chapters[0].text, /<p>/);
  assert.doesNotMatch(chapters[0].text, /Skip me/);
});

test("createIngestPayload builds backend ingest payload from a manifest", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const payload = await createIngestPayload(manifest, { id: "dao" });

  assert.equal(payload.id, "dao");
  assert.equal(payload.title, "Dao De Jing");
  assert.equal(payload.author, "Laozi");
  assert.equal(payload.license, "CC0-1.0");
  assert.equal(payload.epubSha256, manifest.assets.epub.sha256);
  assert.equal(payload.chapters.length, 1);
  assert.match(payload.chapters[0].text, /First paragraph\./);
});

test("publishBookManifest posts ingest payload with admin authorization", async () => {
  const { epubPath } = await writeEpub("CC0-1.0", ["First paragraph."]);
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });

  const requests = [];
  const result = await publishBookManifest(manifest, {
    apiUrl: "https://liber.example",
    adminToken: "secret-token",
    id: "dao",
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, book: { id: "dao" }, chapters: requests[0].body.chapters.length }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://liber.example/api/books/ingest");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret-token");
  assert.equal(requests[0].body.chapters.length, 1);
});

test("CLI auth login/status/logout persists config without leaking the token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-config-"));
  const configPath = path.join(dir, "config.json");
  const env = { ...process.env, LIBER_CONFIG: configPath };

  await execFileAsync(process.execPath, [CLI_PATH, "auth", "login", "--api-url", "https://liber.example", "--admin-token", "secret-token", "--wallet", "0xabc"], { env });
  const status = await execFileAsync(process.execPath, [CLI_PATH, "auth", "status", "--json"], { env });
  const parsed = JSON.parse(status.stdout);

  assert.equal(parsed.apiUrl, "https://liber.example");
  assert.equal(parsed.wallet, "0xabc");
  assert.equal(parsed.adminTokenConfigured, true);
  assert.doesNotMatch(status.stdout, /secret-token/);

  await execFileAsync(process.execPath, [CLI_PATH, "auth", "logout"], { env });
  const after = await loadCliConfig({ configPath });
  assert.deepEqual(after, {});
});

test("core auth config helpers persist and clear config", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-core-config-"));
  const configPath = path.join(dir, "config.json");

  await saveCliConfig({ apiUrl: "https://liber.example", adminToken: "secret-token" }, { configPath });
  const loaded = await loadCliConfig({ configPath });
  assert.equal(loaded.apiUrl, "https://liber.example");
  assert.equal(loaded.adminToken, "secret-token");

  await clearCliConfig({ configPath });
  assert.deepEqual(await loadCliConfig({ configPath }), {});
});

test("CLI publish supports dry-run and requires a token for real publish", async () => {
  const { epubPath, dir } = await writeEpub();
  const manifest = await createBookManifest(epubPath, {
    source: "https://example.com/dao.epub",
    license: "CC0-1.0",
  });
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await execFileAsync(process.execPath, [CLI_PATH, "book", "publish", manifestPath, "--dry-run"]);
  assert.match(result.stdout, /Dry-run publish plan/);

  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI_PATH, "book", "publish", manifestPath]),
    /Admin token is required/,
  );

  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(parsed.schema, "liber.book-manifest.v1");
});
