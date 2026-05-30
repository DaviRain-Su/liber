import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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

function decodeEntities(value) {
  return decodeXml(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
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

async function readEpubPackage(filePath) {
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

  return { filePath, buffer, entries, mimetype, opfPath, parsed };
}

export async function inspectEpub(filePath) {
  const pkg = await readEpubPackage(filePath);
  return {
    path: path.resolve(filePath),
    size: pkg.buffer.length,
    sha256: sha256(pkg.buffer),
    mimetype: pkg.mimetype,
    opfPath: pkg.opfPath,
    metadata: pkg.parsed.metadata,
    manifest: pkg.parsed.manifest,
    spine: pkg.parsed.spine,
  };
}

function stripHtmlInline(raw) {
  return decodeEntities(String(raw || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function htmlToText(raw) {
  return decodeEntities(String(raw || "")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|blockquote|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n"));
}

function chapterTitleFromHtml(raw, fallback) {
  const heading = String(raw || "").match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (heading) return stripHtmlInline(heading[1]) || fallback;
  const title = String(raw || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripHtmlInline(title[1]) || fallback;
  return fallback;
}

function spineTextItems(parsed) {
  const byId = new Map(parsed.manifest.map((item) => [item.id, item]));
  return parsed.spine
    .map((idref) => {
      const item = byId.get(idref);
      if (!item) return null;
      const media = String(item.mediaType || "").toLowerCase();
      if (media !== "application/xhtml+xml" && media !== "text/html") return null;
      return item;
    })
    .filter(Boolean);
}

export async function extractEpubChapters(filePath) {
  const pkg = await readEpubPackage(filePath);
  const items = spineTextItems(pkg.parsed);
  const chapters = [];

  for (const item of items) {
    const raw = entryText(pkg.entries, item.href);
    if (!raw) continue;
    const text = htmlToText(raw);
    if (!text) continue;
    chapters.push({
      n: chapters.length + 1,
      title: chapterTitleFromHtml(raw, `Chapter ${chapters.length + 1}`),
      text,
    });
  }

  if (!chapters.length) throw new LiberCliError("EPUB_NO_TEXT", "EPUB spine has no readable XHTML/HTML text chapters.");
  return chapters;
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

export async function createIngestPayload(manifest, options = {}) {
  if (manifest?.schema !== MANIFEST_SCHEMA) {
    throw new LiberCliError("MANIFEST_INVALID", `Expected manifest schema ${MANIFEST_SCHEMA}.`);
  }
  const epubBytes = await readFile(manifest.assets?.epub?.path);
  const actualSha256 = sha256(epubBytes);
  if (manifest.assets?.epub?.sha256 && actualSha256 !== manifest.assets.epub.sha256) {
    throw new LiberCliError("EPUB_HASH_MISMATCH", "EPUB file no longer matches the packaged manifest hash.");
  }
  const chapters = await extractEpubChapters(manifest.assets?.epub?.path);
  return {
    ...(options.id ? { id: options.id } : {}),
    title: options.title || manifest.book?.title || "Untitled",
    subtitle: options.subtitle || "",
    author: options.author || manifest.book?.creator || "",
    category: options.category || "文学 · 经典",
    lang: options.lang || manifest.book?.language || "",
    year: options.year || manifest.book?.date || "",
    blurb: options.blurb || chapters[0]?.text?.slice(0, 120) || "",
    description: options.description || `Imported from EPUB ${manifest.assets.epub.sha256}.`,
    sourceUrl: manifest.source?.url || "",
    license: manifest.source?.license || manifest.publishPolicy?.license || "CC0-1.0",
    featured: Boolean(options.featured),
    epubSha256: actualSha256,
    epubMediaType: manifest.assets.epub.mediaType || EPUB_MEDIA_TYPE,
    epubBase64: epubBytes.toString("base64"),
    chapters,
  };
}

export function dryRunPublishPlan(manifest, options = {}) {
  if (manifest?.schema !== MANIFEST_SCHEMA) {
    throw new LiberCliError("MANIFEST_INVALID", `Expected manifest schema ${MANIFEST_SCHEMA}.`);
  }
  const payload = options.ingestPayload || null;
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
      ingestPayload: payload || {
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

export function defaultConfigPath() {
  return process.env.LIBER_CONFIG || path.join(homedir(), ".liber", "config.json");
}

function defaultApiUrl(config = {}) {
  return (process.env.LIBER_API_URL || config.apiUrl || "https://liber.davirain.xyz").replace(/\/+$/, "");
}

export async function loadCliConfig(options = {}) {
  const configPath = options.configPath || defaultConfigPath();
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new LiberCliError("CONFIG_READ_FAILED", `Could not read CLI config: ${error.message}`);
  }
}

export async function saveCliConfig(config, options = {}) {
  const configPath = options.configPath || defaultConfigPath();
  const next = {
    apiUrl: config.apiUrl,
    adminToken: config.adminToken || undefined,
    wallet: config.wallet || undefined,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export async function clearCliConfig(options = {}) {
  const configPath = options.configPath || defaultConfigPath();
  await rm(configPath, { force: true });
}

export function publicConfigStatus(config = {}, options = {}) {
  return {
    apiUrl: config.apiUrl || "",
    wallet: config.wallet || "",
    adminTokenConfigured: Boolean(config.adminToken || process.env.LIBER_ADMIN_TOKEN || process.env.ADMIN_TOKEN),
    configPath: options.configPath || defaultConfigPath(),
    updatedAt: config.updatedAt || "",
  };
}

function resolvePublishOptions(options = {}, config = {}) {
  return {
    apiUrl: (options.apiUrl || defaultApiUrl(config)).replace(/\/+$/, ""),
    adminToken: options.adminToken || process.env.LIBER_ADMIN_TOKEN || process.env.ADMIN_TOKEN || config.adminToken || "",
  };
}

async function readJsonResponse(res, failureCode) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!res.ok) {
    throw new LiberCliError(failureCode, `HTTP ${res.status}: ${text}`);
  }
  return body;
}

export async function startBrowserAuth(options = {}) {
  const config = options.config || await loadCliConfig({ configPath: options.configPath });
  const apiUrl = (options.apiUrl || defaultApiUrl(config)).replace(/\/+$/, "");
  const fetcher = options.fetchImpl || fetch;
  const res = await fetcher(`${apiUrl}/api/auth/cli/start`, { method: "POST", headers: { "content-type": "application/json" } });
  const body = await readJsonResponse(res, "CLI_AUTH_START_FAILED");
  return { ...body, apiUrl };
}

export async function pollBrowserAuth(deviceCode, options = {}) {
  const apiUrl = (options.apiUrl || "https://liber.davirain.xyz").replace(/\/+$/, "");
  const fetcher = options.fetchImpl || fetch;
  const res = await fetcher(`${apiUrl}/api/auth/cli/poll/${encodeURIComponent(deviceCode)}`);
  return readJsonResponse(res, "CLI_AUTH_POLL_FAILED");
}

export async function waitForBrowserAuth(start, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const intervalMs = Number(options.intervalMs || Math.max(1000, Number(start.interval || 2) * 1000));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await pollBrowserAuth(start.deviceCode, { apiUrl: start.apiUrl, fetchImpl: options.fetchImpl });
    if (state.status === "approved") return state;
    if (state.status === "expired") throw new LiberCliError("CLI_AUTH_EXPIRED", "Browser authorization expired.");
    await sleep(intervalMs);
  }
  throw new LiberCliError("CLI_AUTH_TIMEOUT", "Timed out waiting for browser authorization.");
}

function hexToBytes(value) {
  const hex = String(value || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

function normalizeKeyScheme(value) {
  const scheme = String(value || "").toLowerCase();
  if (!scheme) return null;
  if (scheme === "ed25519") return "ed25519";
  if (scheme === "secp256k1") return "secp256k1";
  if (scheme === "secp256r1") return "secp256r1";
  throw new LiberCliError("SUI_KEY_SCHEME_UNSUPPORTED", `Unsupported Sui key scheme: ${value}`);
}

async function loadSuiKeypair(secret, scheme) {
  const loaders = {
    ed25519: async () => (await import("@mysten/sui/keypairs/ed25519")).Ed25519Keypair,
    secp256k1: async () => (await import("@mysten/sui/keypairs/secp256k1")).Secp256k1Keypair,
    secp256r1: async () => (await import("@mysten/sui/keypairs/secp256r1")).Secp256r1Keypair,
  };
  const schemes = scheme ? [scheme] : ["ed25519", "secp256k1", "secp256r1"];
  const rawBytes = hexToBytes(secret);
  if (rawBytes && !scheme) {
    throw new LiberCliError("SUI_KEY_SCHEME_REQUIRED", "Raw hex Sui private keys require --scheme.");
  }
  let lastError = null;
  for (const name of schemes) {
    try {
      const Keypair = await loaders[name]();
      return Keypair.fromSecretKey(rawBytes || secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw new LiberCliError("SUI_PRIVATE_KEY_INVALID", lastError?.message || "Could not load Sui private key.");
}

export async function signInWithSuiPrivateKey(options = {}) {
  const config = options.config || await loadCliConfig({ configPath: options.configPath });
  const apiUrl = (options.apiUrl || defaultApiUrl(config)).replace(/\/+$/, "");
  const fetcher = options.fetchImpl || fetch;
  const secret = String(
    options.privateKey
      || process.env.LIBER_SUI_PRIVATE_KEY
      || (options.keyFile ? await readFile(path.resolve(options.keyFile), "utf8") : "")
      || "",
  ).trim();
  if (!secret && !options.keypair) {
    throw new LiberCliError("SUI_PRIVATE_KEY_REQUIRED", "Provide --key-file, --private-key, or LIBER_SUI_PRIVATE_KEY.");
  }
  const keypair = options.keypair || await loadSuiKeypair(secret, normalizeKeyScheme(options.scheme));
  const address = keypair.toSuiAddress();

  const nonceRes = await fetcher(`${apiUrl}/api/auth/nonce`, { method: "POST", headers: { "content-type": "application/json" } });
  const nonce = await readJsonResponse(nonceRes, "SUI_AUTH_NONCE_FAILED");
  const signed = await keypair.signPersonalMessage(new TextEncoder().encode(nonce.message));
  const verifyRes = await fetcher(`${apiUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, message: nonce.message, signature: signed.signature, nonce: nonce.nonce }),
  });
  const session = await readJsonResponse(verifyRes, "SUI_AUTH_VERIFY_FAILED");
  if (!session.token) throw new LiberCliError("SUI_AUTH_VERIFY_FAILED", "Wallet verification did not return a session token.");

  const tokenRes = await fetcher(`${apiUrl}/api/auth/cli/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
  });
  const publish = await readJsonResponse(tokenRes, "CLI_TOKEN_MINT_FAILED");
  return { apiUrl, token: publish.token, wallet: publish.wallet || address, expiresIn: publish.expiresIn };
}

export async function publishBookManifest(manifest, options = {}) {
  const config = options.config || await loadCliConfig({ configPath: options.configPath });
  const resolved = resolvePublishOptions(options, config);
  if (!resolved.adminToken) {
    throw new LiberCliError("AUTH_REQUIRED", "Publish token is required. Run `liber auth browser --api-url <url>` or configure ADMIN_TOKEN for headless admin use.");
  }
  const payload = await createIngestPayload(manifest, options);
  const fetcher = options.fetchImpl || fetch;
  const ingestUrl = `${resolved.apiUrl}/api/books/ingest`;
  let res;
  try {
    res = await fetcher(ingestUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolved.adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new LiberCliError("PUBLISH_NETWORK_FAILED", `Publish request failed for ${ingestUrl}: ${error.message || String(error)}`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!res.ok) {
    throw new LiberCliError("PUBLISH_FAILED", `Publish failed with HTTP ${res.status}: ${text}`);
  }
  return body;
}
