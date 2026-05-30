import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export const MANIFEST_SCHEMA = "liber.book-manifest.v1";
export const EPUB_MEDIA_TYPE = "application/epub+zip";
export const ACCEPTED_LICENSES = new Set(["CC0-1.0", "PUBLIC-DOMAIN"]);

export class LiberCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LiberCliError";
    this.code = code;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagValues(xml, tag) {
  const re = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "gi");
  return [...xml.matchAll(re)].map((m) => decodeXml(m[1])).filter(Boolean);
}

function firstTag(xml, tag) {
  return tagValues(xml, tag)[0] || "";
}

function attrs(raw) {
  const out = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of raw.matchAll(re)) out[m[1]] = decodeXml(m[2] ?? m[3] ?? "");
  return out;
}

function normalizeEpubPath(value) {
  return path.posix.normalize(String(value || "").replace(/^\/+/, "")).replace(/^\.\//, "");
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new LiberCliError("EPUB_BAD_ZIP", "Could not find ZIP end-of-central-directory record.");
}

function readZipEntries(buffer) {
  if (buffer.length < 22) throw new LiberCliError("EPUB_BAD_ZIP", "File is too small to be a ZIP archive.");
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) {
    throw new LiberCliError("EPUB_BAD_ZIP", "ZIP central directory points outside the file.");
  }

  const entries = new Map();
  let off = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(off) !== 0x02014b50) {
      throw new LiberCliError("EPUB_BAD_ZIP", "Invalid ZIP central directory header.");
    }
    const method = buffer.readUInt16LE(off + 10);
    const compressedSize = buffer.readUInt32LE(off + 20);
    const uncompressedSize = buffer.readUInt32LE(off + 24);
    const nameLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    const localOffset = buffer.readUInt32LE(off + 42);
    const name = buffer.slice(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new LiberCliError("EPUB_BAD_ZIP", `Invalid local header for ${name}.`);
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new LiberCliError("EPUB_BAD_ZIP", `ZIP entry ${name} points outside the file.`);
    const compressed = buffer.slice(dataStart, dataEnd);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new LiberCliError("EPUB_UNSUPPORTED_COMPRESSION", `ZIP entry ${name} uses unsupported compression method ${method}.`);
    if (data.length !== uncompressedSize) {
      throw new LiberCliError("EPUB_BAD_ZIP", `ZIP entry ${name} has an unexpected uncompressed size.`);
    }
    entries.set(normalizeEpubPath(name), data);
  }
  return entries;
}

function entryText(entries, name) {
  const entry = entries.get(normalizeEpubPath(name));
  return entry ? entry.toString("utf8") : "";
}

function parseOpf(opf, opfPath) {
  const base = path.posix.dirname(opfPath);
  const manifest = [];
  for (const m of opf.matchAll(/<item\b([^>]*?)(?:\/>|>)/gi)) {
    const a = attrs(m[1]);
    if (!a.id) continue;
    manifest.push({
      id: a.id,
      href: normalizeEpubPath(path.posix.join(base, a.href || "")),
      mediaType: a["media-type"] || "",
      properties: a.properties || "",
    });
  }

  const spine = [];
  for (const m of opf.matchAll(/<itemref\b([^>]*?)(?:\/>|>)/gi)) {
    const idref = attrs(m[1]).idref;
    if (idref) spine.push(idref);
  }

  return {
    metadata: {
      title: firstTag(opf, "dc:title"),
      creator: firstTag(opf, "dc:creator"),
      language: firstTag(opf, "dc:language"),
      identifier: firstTag(opf, "dc:identifier"),
      publisher: firstTag(opf, "dc:publisher"),
      date: firstTag(opf, "dc:date"),
      rights: tagValues(opf, "dc:rights"),
    },
    manifest,
    spine,
  };
}

export async function inspectEpub(filePath) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw new LiberCliError("EPUB_NOT_FOUND", `Could not read EPUB file: ${error.message}`);
  }

  const entries = readZipEntries(buffer);
  const mimetype = entryText(entries, "mimetype").trim();
  if (mimetype !== EPUB_MEDIA_TYPE) {
    throw new LiberCliError("EPUB_BAD_MIMETYPE", `Expected EPUB mimetype ${EPUB_MEDIA_TYPE}, got ${mimetype || "missing"}.`);
  }

  const container = entryText(entries, "META-INF/container.xml");
  if (!container) throw new LiberCliError("EPUB_NO_CONTAINER", "EPUB is missing META-INF/container.xml.");
  const rootfile = container.match(/\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i)?.[1]
    || container.match(/\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i)?.[2];
  if (!rootfile) throw new LiberCliError("EPUB_NO_OPF", "EPUB container does not declare an OPF rootfile.");

  const opfPath = normalizeEpubPath(rootfile);
  const opf = entryText(entries, opfPath);
  if (!opf) throw new LiberCliError("EPUB_NO_OPF", `EPUB OPF file not found: ${opfPath}.`);
  const parsed = parseOpf(opf, opfPath);

  return {
    path: path.resolve(filePath),
    size: buffer.length,
    sha256: sha256(buffer),
    mimetype,
    opfPath,
    metadata: parsed.metadata,
    manifest: parsed.manifest,
    spine: parsed.spine,
  };
}

export function normalizePublishLicense(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const compact = text.toLowerCase().replace(/[_\s]+/g, "-");
  if (/\bcc0\b|\bcc0[-\s]?1\.0\b|creative-commons-zero/.test(compact)) return "CC0-1.0";
  if (/public[-\s]?domain|public-domain-mark|project-gutenberg|wikisource/.test(compact)) return "PUBLIC-DOMAIN";
  return null;
}

function rejectedLicenseSignals(text) {
  const haystack = String(text || "");
  const rules = [
    ["CC-BY-NC", /\bcc[-\s]?by[-\s]?nc\b|attribution[-\s]?noncommercial|non[-\s]?commercial|\bNC\b/i],
    ["CC-BY-SA", /\bcc[-\s]?by[-\s]?sa\b|attribution[-\s]?sharealike/i],
    ["CC-BY-ND", /\bcc[-\s]?by[-\s]?nd\b|attribution[-\s]?noderivatives/i],
    ["CC-BY", /\bcc[-\s]?by\b|creative commons attribution/i],
    ["ALL-RIGHTS-RESERVED", /all rights reserved/i],
  ];
  return rules.filter(([, re]) => re.test(haystack)).map(([id]) => id);
}

function evidenceCorpusSource(source) {
  try {
    const host = new URL(source).hostname.toLowerCase();
    if (host.endsWith("gutenberg.org") || host.endsWith("standardebooks.org") || host.endsWith("wikisource.org")) {
      return "PUBLIC-DOMAIN";
    }
  } catch {
    return null;
  }
  return null;
}

export function verifyPublishLicense(info, options = {}) {
  const rights = Array.isArray(info?.metadata?.rights) ? info.metadata.rights : [];
  const evidence = [options.license, ...rights, options.evidence, options.source].filter(Boolean).join("\n");
  const rejected = rejectedLicenseSignals(evidence);
  if (rejected.length) {
    return {
      accepted: false,
      license: normalizePublishLicense(options.license) || null,
      reason: `Rejected restrictive license signal: ${[...new Set(rejected)].join(", ")}.`,
      rejectedSignals: [...new Set(rejected)],
      acceptedSignals: [],
    };
  }

  const accepted = normalizePublishLicense(options.license)
    || rights.map(normalizePublishLicense).find(Boolean)
    || normalizePublishLicense(options.evidence)
    || evidenceCorpusSource(options.source);

  if (accepted && ACCEPTED_LICENSES.has(accepted)) {
    return {
      accepted: true,
      license: accepted,
      reason: `Accepted by Liber policy: ${accepted}.`,
      rejectedSignals: [],
      acceptedSignals: [accepted],
    };
  }

  return {
    accepted: false,
    license: null,
    reason: "No CC0-1.0 or public-domain evidence found.",
    rejectedSignals: [],
    acceptedSignals: [],
  };
}

function requireSource(source) {
  if (!source || !String(source).trim()) {
    throw new LiberCliError("SOURCE_REQUIRED", "A source URL is required for packaging and license verification.");
  }
  return String(source).trim();
}

export async function createBookManifest(filePath, options = {}) {
  const source = requireSource(options.source);
  const info = await inspectEpub(filePath);
  const policy = verifyPublishLicense(info, options);
  if (!policy.accepted) throw new LiberCliError("LICENSE_REJECTED", policy.reason);

  return {
    schema: MANIFEST_SCHEMA,
    createdAt: new Date().toISOString(),
    source: {
      url: source,
      license: policy.license,
      evidence: options.evidence || null,
    },
    book: {
      title: info.metadata.title || null,
      creator: info.metadata.creator || null,
      language: info.metadata.language || null,
      identifier: info.metadata.identifier || null,
      publisher: info.metadata.publisher || null,
      date: info.metadata.date || null,
    },
    assets: {
      epub: {
        path: info.path,
        sha256: info.sha256,
        size: info.size,
        mediaType: EPUB_MEDIA_TYPE,
      },
    },
    epub: {
      opfPath: info.opfPath,
      rights: info.metadata.rights,
      manifest: info.manifest,
      spine: info.spine,
    },
    publishPolicy: {
      accepted: policy.accepted,
      license: policy.license,
      reason: policy.reason,
    },
  };
}

export async function writeBookManifest(filePath, options = {}) {
  if (!options.out) throw new LiberCliError("OUT_REQUIRED", "Manifest output path is required.");
  const manifest = await createBookManifest(filePath, options);
  await writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function dryRunPublishPlan(manifest, options = {}) {
  if (manifest?.schema !== MANIFEST_SCHEMA) {
    throw new LiberCliError("MANIFEST_INVALID", `Expected manifest schema ${MANIFEST_SCHEMA}.`);
  }
  const base = (options.apiUrl || "https://liber.davirain.xyz").replace(/\/+$/, "");
  return {
    mode: "dry-run",
    storage: {
      mediaType: manifest.assets.epub.mediaType,
      path: manifest.assets.epub.path,
      sha256: manifest.assets.epub.sha256,
      size: manifest.assets.epub.size,
    },
    api: {
      ingestUrl: `${base}/api/books/ingest`,
      ingestPayload: {
        title: manifest.book.title,
        author: manifest.book.creator,
        lang: manifest.book.language,
        sourceUrl: manifest.source.url,
        license: manifest.source.license,
        epubSha256: manifest.assets.epub.sha256,
      },
    },
    registry: {
      contentId: `sha256:${manifest.assets.epub.sha256}`,
      kind: "book",
      license: manifest.source.license,
    },
  };
}
