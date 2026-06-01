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
  return decodeXml(String(value || "").replace(/&nbsp;/gi, " "))
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

function resolveEpubHref(baseFile, href) {
  const [filePart, fragment = ""] = String(href || "").split("#");
  return {
    href: normalizeEpubPath(path.posix.join(path.posix.dirname(baseFile), filePart || "")),
    fragment: decodeURIComponent(fragment || ""),
  };
}

function parseNcxNavigation(pkg) {
  const toc = pkg.parsed.manifest.find((item) => item.mediaType === "application/x-dtbncx+xml")
    || pkg.parsed.manifest.find((item) => /toc\.ncx$/i.test(item.href));
  if (!toc) return [];
  const xml = entryText(pkg.entries, toc.href);
  if (!xml) return [];

  const entries = [];
  const navPointRe = /<navPoint\b[^>]*>[\s\S]*?<navLabel\b[^>]*>\s*<text\b[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b([^>]*?)(?:\/>|>)/gi;
  for (const point of xml.matchAll(navPointRe)) {
    const label = stripHtmlInline(point[1] || "");
    const src = attrs(point[2] || "").src;
    if (!label || !src) continue;
    entries.push({ label, ...resolveEpubHref(toc.href, src) });
  }
  return entries;
}

function anchorIndex(raw, fragment) {
  if (!fragment) return 0;
  const escaped = escapeRegExp(fragment);
  const re = new RegExp(`<[^>]+\\b(?:id|name)\\s*=\\s*(?:"${escaped}"|'${escaped}')[^>]*>`, "i");
  const match = String(raw || "").match(re);
  return match?.index ?? -1;
}

function englishChapterTitle(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (/^[A-Z]\.\s*[A-Z]\.?$/u.test(value)) return null;
  if (/^[CDML]\.\s+[\p{Lu}\p{M}'’ -]{2,80}$/u.test(value)) return null;
  const chapterStart = value.match(/^(CHAPTER|Chapter|chapter)\s*([IVXLCDM]+|\d+)(\.?)(?:\s+(.{1,140}))?$/u);
  if (chapterStart) return `${chapterStart[1]} ${chapterStart[2]}${chapterStart[3] || ""}${chapterStart[4] ? ` ${chapterStart[4].trim()}` : ""}`.replace(/\s+/g, " ").trim();
  const wordNumber = "(?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY(?:[-\\s](?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?|THIRTY(?:[-\\s](?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?|FORTY(?:[-\\s](?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?|FIFTY(?:[-\\s](?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?)";
  const chapterWordStart = value.match(new RegExp(`^(CHAPTER|Chapter|chapter)\\s+(${wordNumber})(?:\\s+(.{1,180}))?$`, "u"));
  if (chapterWordStart) return `${chapterWordStart[1]} ${chapterWordStart[2]}${chapterWordStart[3] ? ` ${chapterWordStart[3].trim()}` : ""}`.replace(/\s+/g, " ").trim();
  const staveStart = value.match(new RegExp(`^(STAVE|Stave|stave)\\s+([IVXLCDM]+|${wordNumber})(\\.?)(?:\\s+(.{1,180}))?$`, "u"));
  if (staveStart) return `${staveStart[1]} ${staveStart[2]}${staveStart[3] || ""}${staveStart[4] ? ` ${staveStart[4].trim()}` : ""}`.replace(/\s+/g, " ").trim();
  const localizedStart = value.match(/^(CHAPITRE|Chapitre|chapitre|CAP[ÍI]TULO|Cap[íi]tulo|CAPITOLO|Capitolo|CANTO|Canto|LIVRE|Livre|ACTE|Acte)\s+(.{1,180})$/u);
  if (localizedStart) return `${localizedStart[1]} ${localizedStart[2].trim()}`.replace(/\s+/g, " ").trim();
  const latinBook = value.match(/^(LIBER)\s+([IVXLCDM]+)$/u);
  if (latinBook) return `${latinBook[1]} ${latinBook[2]}`;
  if (/^(?:PREMIÈRE|PREMIERE|DEUXIÈME|DEUXIEME|TROISIÈME|TROISIEME|QUATRIÈME|QUATRIEME)\s+PARTIE$/iu.test(value)) return value;
  if (/^[IVXLCDM]+\.\s+.{2,260}$/u.test(value)) return value;
  if (/^[IVXLCDM]+\s+[\p{Lu}“"‘'({].{1,180}$/u.test(value)) return value;
  if (/^[IVXLCDM]+$/u.test(value)) return value;
  const letterStart = value.match(/^(LETTER|Letter|letter)\s+(\d+)(\.?)(?:\s+(.{1,140}))?$/u);
  if (letterStart) return `${letterStart[1]} ${letterStart[2]}${letterStart[3] || ""}${letterStart[4] ? ` ${letterStart[4].trim()}` : ""}`.replace(/\s+/g, " ").trim();
  const bookStart = value.match(/^(BOOK|Book|book)\s+([IVXLCDM]+|\d+)(\.?)(?:\s+(.{1,140}))?$/u);
  if (bookStart) return `${bookStart[1]} ${bookStart[2]}${bookStart[3] || ""}${bookStart[4] ? ` ${bookStart[4].trim()}` : ""}`.replace(/\s+/g, " ").trim();
  const embedded = value.match(/\bCHAPTER\s*([IVXLCDM]+|\d+)\.?/iu);
  if (embedded) return `CHAPTER ${embedded[1]}.`;
  const letter = value.match(/\bLetter\s+(\d+)\.?/iu);
  if (letter) return `Letter ${letter[1]}`;
  const book = value.match(/\bBook\s+([IVXLCDM]+|\d+)\.?/iu);
  if (book) return `Book ${book[1]}`;
  return null;
}

function isNavigationNoiseTitle(title, bookTitle) {
  return isNoiseTitle(title, bookTitle)
    || /project gutenberg|full license|license$/i.test(title)
    || /transcriber'?s notes?/i.test(title)
    || /illustrated edition|may (?:be )?viewed at ebook/i.test(title)
    || /^oeuvres$/i.test(title)
    || /^contents?$/i.test(title)
    || /^list of illustrations?$/i.test(title)
    || /^cover$/i.test(title)
    || /\|\s*Project Gutenberg$/i.test(title)
    || /^and\s+.+\s+by\b/i.test(title)
    || /^linked image$/i.test(title);
}

function looksLikeConciseNavigationTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  if (!value || value.length > 90) return false;
  if (looksLikeProseTitle(value) || looksLikeCreditTitle(value)) return false;
  if (/[.!?。！？]["'”’)]?$/u.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

function isNavigableChapterTitle(title, bookTitle) {
  if (!title || isNavigationNoiseTitle(title, bookTitle)) return false;
  if (englishChapterTitle(title)) return true;
  if (/^(?:preface|prologue|epilogue|etymology)\.?$/i.test(title)) return true;
  if (/^extracts?\b.+\)/i.test(title)) return true;
  if (/^(?:letter|book)\s+\d+/i.test(title)) return true;
  if (classifyLogicalHeading(title, bookTitle)?.kind === "chapter") return true;
  return false;
}

function navigationTitle(label, text, fallback) {
  const fromLabel = englishChapterTitle(label);
  if (fromLabel) return fromLabel;
  const firstLine = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
  const fromText = englishChapterTitle(firstLine);
  if (fromText) return fromText;
  return label || fallback;
}

function cleanExtractedChapterText(title, text) {
  const exactTitlePrefix = new RegExp(`^${escapeRegExp(String(title || "").trim())}\\s*[:：]`);
  const exactTitle = String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const raw = String(text || "");
  const titleMatch = title && englishChapterTitle(title) ? raw.slice(0, 260).search(new RegExp(escapeRegExp(String(title).trim()), "i")) : -1;
  const trimmed = titleMatch > 0 ? raw.slice(titleMatch) : raw;
  const prepared = trimmed
    .replace(/\[[^\]\n]*(?:公元前|公元|BC|AD)[^\]\n]*\]\s*(?:相關資源|相关资源)?/giu, "")
    .replace(/(?:相關資源|相关资源)/gu, "")
    .replace(/([。！？?””』」])\s+(\d{1,3}\.\s+[\p{Script=Han}]{1,8}\s*[:：])/gu, "$1\n\n$2")
    .replace(/(^|\s)\d+\s+卷[一二两三四五六七八九十百千〇○零\d]+[:：]\s*[\p{Script=Han}]{1,20}(?=\s|$)/gu, "$1");
  const sectioned = splitInlineChineseClassicSections(prepared, title);
  const blocks = sectioned
    .replace(/屬於：\[[^\]]+\]/g, "")
    .replace(/属于：\[[^\]]+\]/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !isGeneratedEpubPageMarker(block))
    .filter((block) => !isProjectGutenbergBoilerplateBlock(block))
    .filter((block) => !/^(?:相關資源|相关资源)$/u.test(block))
    .filter((block) => !/^\[[^\]]*(?:公元前|公元|BC|AD)[^\]]*\]$/iu.test(block))
    .filter((block) => !(title && exactTitlePrefix.test(block)))
    .filter((block) => !(exactTitle && block.replace(/\s+/g, " ").trim().toLowerCase() === exactTitle))
    .map((block) => stripRepeatedChineseChapterLabel(block, title));
  return normalizeTextBlocks(blocks.join("\n\n"));
}

function stripRepeatedChineseChapterLabel(block, title) {
  const heading = String(title || "").replace(/\s+/g, "");
  if (!heading || heading.length > 24 || !/\p{Script=Han}/u.test(heading)) return block;
  const escaped = escapeRegExp(heading);
  return String(block || "").replace(new RegExp(`^(\\d{1,3})\\s+${escaped}\\s*[:：]\\s*`, "u"), "$1. ");
}

function splitInlineChineseClassicSections(text, title) {
  const heading = String(title || "").replace(/\s+/g, "");
  if (!heading || heading.length > 24 || !/\p{Script=Han}/u.test(heading)) return String(text || "");
  const escaped = escapeRegExp(heading);
  return String(text || "")
    .replace(new RegExp(`\\s+(\\d{1,3}\\s+${escaped}\\s*[:：])`, "gu"), "\n\n$1")
    .replace(/\s+(\d{1,3}\.\s+[\p{Script=Han}]{1,8}\s*[:：])/gu, "\n\n$1")
    .trim();
}

function makeChapter(n, title, text) {
  return { n, title, text: cleanExtractedChapterText(title, text) };
}

function chaptersFromNavigation(pkg, items, bookTitle) {
  const itemHrefs = new Set(items.map((item) => item.href));
  const allNav = parseNcxNavigation(pkg)
    .filter((entry) => itemHrefs.has(entry.href))
    .map((entry, index) => ({ ...entry, index }));
  const nav = allNav.filter((entry) => isNavigableChapterTitle(entry.label, bookTitle));
  if (nav.length < 2) return [];

  const out = [];
  for (let i = 0; i < nav.length; i += 1) {
    const entry = nav[i];
    const raw = entryText(pkg.entries, entry.href);
    if (!raw) continue;
    const start = anchorIndex(raw, entry.fragment);
    if (start < 0) continue;
    const endpoints = [
      ...nav.slice(i + 1).filter((candidate) => candidate.href === entry.href),
      ...allNav.slice(entry.index + 1).filter((candidate) => candidate.href === entry.href && isStandaloneGutenbergJunkTitle(candidate.label)),
    ]
      .map((candidate) => anchorIndex(raw, candidate.fragment))
      .filter((candidateStart) => candidateStart > start)
      .sort((a, b) => a - b);
    const end = endpoints[0] ?? -1;
    const segment = raw.slice(start, end > start ? end : undefined);
    const text = stripProjectGutenbergBoilerplate(htmlToText(segment));
    if (!text || isProjectGutenbergOnlyChapter(entry.label, text)) continue;
    if (isTitlePageOnlyChapter(entry.label, text)) continue;
    const title = cleanChapterTitle(
      navigationTitle(entry.label, text, `Chapter ${out.length + 1}`),
      text,
      `Chapter ${out.length + 1}`,
      bookTitle,
    );
    if (isNavigationNoiseTitle(title, bookTitle)) continue;
    const chapter = makeChapter(out.length + 1, title, text);
    if (chapter.text) out.push(chapter);
  }
  return out;
}

function normalizeTextBlocks(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .filter(Boolean)
      .join("\n"))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function garbledTextWarnings(text) {
  const sample = String(text || "").replace(/\s+/g, " ").trim().slice(0, 6000);
  if (!sample) return [];

  const chars = [...sample];
  const total = chars.length || 1;
  const replacement = chars.filter((ch) => ch === "\uFFFD").length;
  const mojibake = chars.filter((ch) => /[ÃÂâ€šœžŸ¢¤¥¦§¨©ª«¬®¯±²³´µ¶·¸¹º»¼½¾¿]/u.test(ch)).length;
  const han = chars.filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  const hanPunctuation = chars.filter((ch) => /[，。、；：？！「」『』《》（）]/u.test(ch)).length;
  const oddSymbols = chars.filter((ch) => /[⊿∪∟∠⊥∩╡╰﹝ＸＹＺＴＵＷ０-９ａ-ｚ]/u.test(ch)).length;
  const warnings = [];

  if (replacement / total > 0.002) warnings.push("contains replacement characters");
  if (mojibake / total > 0.015) warnings.push("contains Latin-1/UTF-8 mojibake markers");
  if (han > 120 && oddSymbols >= 6 && hanPunctuation <= Math.max(2, han / 500)) {
    warnings.push("Chinese text has high garbled-symbol density");
  }
  return warnings;
}

export function looksLikeGarbledText(text) {
  return garbledTextWarnings(text).length > 0;
}

function assertReadableChapters(chapters) {
  const text = chapters.map((chapter) => chapter.text || "").join("\n\n");
  const warnings = garbledTextWarnings(text);
  if (warnings.length) {
    throw new LiberCliError(
      "EPUB_GARBLED_TEXT",
      `EPUB extracted text looks garbled: ${warnings.join("; ")}.`,
    );
  }
}

function htmlToText(raw) {
  const BR = "\uE001";
  const SEP = "\uE002";
  return normalizeTextBlocks(decodeEntities(String(raw || "")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<br\s*\/?>/gi, BR)
    .replace(/<(p|div|section|article|blockquote|li|tr|h[1-6])\b[^>]*>/gi, SEP)
    .replace(/<\/(p|div|section|article|blockquote|li|tr|h[1-6])>/gi, SEP)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, SEP)
    .replace(/\n/g, " ")
    .replaceAll(BR, "\n")
    .replaceAll(SEP, "\n\n")));
}

function chapterTitleFromHtml(raw, fallback) {
  const heading = String(raw || "").match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (heading) return stripHtmlInline(heading[1]) || fallback;
  const title = String(raw || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripHtmlInline(title[1]) || fallback;
  return fallback;
}

function stripProjectGutenbergBoilerplate(text) {
  let out = String(text || "").replace(/\r\n/g, "\n");
  const start = out.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  if (start) out = out.slice((start.index || 0) + start[0].length);
  const end = out.search(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end >= 0) out = out.slice(0, end);
  return normalizeTextBlocks(out)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !isProjectGutenbergBoilerplateBlock(block))
    .join("\n\n")
    .trim();
}

function isProjectGutenbergBoilerplateBlock(block) {
  const value = String(block || "").replace(/\s+/g, " ").trim();
  return /^produced by\b/i.test(value)
    || /^this (?:e-?text|e-?book) was prepared\b/i.test(value)
    || /^the project gutenberg (?:e-?text|e-?book)\b/i.test(value)
    || /^project gutenberg'?s/i.test(value)
    || /^a note from the digitizer\b/i.test(value)
    || /^title\s*:/i.test(value)
    || /^author\s*:/i.test(value)
    || /^release date\s*:/i.test(value)
    || /^language\s*:/i.test(value)
    || /^character set encoding\s*:/i.test(value)
    || /^transcriber'?s notes?\b/i.test(value)
    || /^end of (?:the )?project gutenberg\b/i.test(value)
    || /^the full project gutenberg(?:™|\(tm\))?\s+license\b/i.test(value)
    || /^full project gutenberg(?:™|\(tm\))?\s+license\b/i.test(value)
    || /^["“]?linked image["”]?$/i.test(value)
    || /^(?:back|next)$/i.test(value)
    || /^shows ruby\b/i.test(value)
    || /^｜ marks\b/i.test(value)
    || /^［＃.*］ explains\b/i.test(value);
}

function isGeneratedEpubPageMarker(block) {
  return /^[09]\d{3,5}m$/i.test(String(block || "").replace(/\s+/g, "").trim());
}

function looksLikePartHeading(value) {
  return /^PART\s+(?:[IVXLCDM]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\b(?:\s*[—-]\s*.+)?$/iu
    .test(String(value || "").replace(/\s+/g, " ").trim());
}

function looksLikeProseBlock(value) {
  const block = String(value || "").replace(/\s+/g, " ").trim();
  if (!block || isGeneratedEpubPageMarker(block)) return false;
  if (block.length > 140) return true;
  if (/\p{Script=Han}/u.test(block) && block.length >= 8 && /[。！？；：，、]/u.test(block)) return true;
  const words = block.split(/\s+/).length;
  return words >= 5 && /[.!?。！？]["'”’)]?$/u.test(block);
}

function looksLikeNavigationOnlyText(text, bookTitle) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !isGeneratedEpubPageMarker(block));
  if (blocks.length < 4) return false;
  const headingish = blocks.filter((block) => {
    const one = block.replace(/\s+/g, " ").trim();
    return isSameBookTitle(one, bookTitle)
      || looksLikePartHeading(one)
      || Boolean(englishChapterTitle(one))
      || Boolean(classifyLogicalHeading(one, bookTitle));
  }).length;
  const prose = blocks.filter(looksLikeProseBlock).length;
  return prose === 0 && headingish >= 4 && headingish / blocks.length >= 0.6;
}

function looksLikeProseTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  if (englishChapterTitle(title)) return false;
  if (looksLikeShortChineseProseTitle(title)) return true;
  if (/^[.…]+$/.test(title)) return true;
  if (/\*\*\*\*/.test(title)) return true;
  if (/^\[[12]\d{3}\s+edition\]$/i.test(title)) return true;
  if (title.length > 28 && /^["'“‘「『]/u.test(title) && /[.!?。！？]["'”’」』]?$/u.test(title)) return true;
  if (title.length > 180) return true;
  if (title.length > 90 && /[.!?。！？；;:：]/u.test(title)) return true;
  if (title.split(/\s+/).length > 18 && !englishChapterTitle(title)) return true;
  return false;
}

function looksLikeCreditTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  const initialCredit = /^[A-Z]\.\s*[\p{Lu}\p{M}'’ -]{2,48}$/u.test(title)
    && !/^[IVX]\.\s+/u.test(title);
  return initialCredit
    || /^(?:edited|illustrated|translated|printed|published)\s+by\b/i.test(title);
}

function isUnusableChapterTitle(title, bookTitle) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  const undecorated = undecorateTitle(value);
  const wasBracketed = /^(?:《[^《》]{1,80}》|【[^【】]{1,80}】)$/.test(value);
  if (undecorated && looksLikeChapterTitle(undecorated, wasBracketed)) return false;
  if (/^\d{1,3}[.、]\s+/.test(value)) return false;
  return !value
    || isNoiseTitle(value, bookTitle)
    || isProjectGutenbergBoilerplateBlock(value)
    || looksLikeCreditTitle(value)
    || looksLikeProseTitle(value)
    || looksLikeProseBlock(value);
}

function candidateTitleFromText(text, bookTitle, fallback) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const headingLines = lines.slice(0, 80);
  for (const line of headingLines) {
    const oneLine = line.replace(/\s+/g, " ").trim();
    if (isUnusableChapterTitle(oneLine, bookTitle)) continue;
    const english = englishChapterTitle(oneLine);
    if (english && !isUnusableChapterTitle(english, bookTitle)) return english;
    const logical = classifyLogicalHeading(oneLine, bookTitle);
    if (logical?.kind === "chapter" && !isUnusableChapterTitle(logical.title, bookTitle)) return logical.title;
  }
  if (bookTitle && !isUnusableChapterTitle(bookTitle, "")) return bookTitle;
  for (const line of headingLines.slice(0, 16)) {
    const oneLine = line.replace(/\s+/g, " ").trim();
    if (isUnusableChapterTitle(oneLine, bookTitle)) continue;
    if (oneLine.length <= 80 && !/[.!?。！？；;:：]$/u.test(oneLine)) return oneLine;
  }
  return fallback;
}

function hasExplicitChapterHeading(text, bookTitle) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80).some((line) => {
    const oneLine = line.replace(/\s+/g, " ").trim();
    if (englishChapterTitle(oneLine)) return true;
    if (classifyLogicalHeading(oneLine, bookTitle)?.kind === "chapter") return true;
    if (isUnusableChapterTitle(oneLine, bookTitle)) return false;
    return false;
  });
}

function cleanChapterTitle(title, text, fallback, bookTitle = "") {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  const trimmed = trimChineseChapterTitleProseTail(value);
  if (!isUnusableChapterTitle(trimmed, bookTitle)) return trimmed;
  return candidateTitleFromText(text, bookTitle, fallback);
}

function comparableTitle(value) {
  return String(value || "")
    .replace(/[《》〈〉「」『』"'\s:：,，.。·\-—_]/g, "")
    .toLowerCase();
}

const HAN_ORDINAL_CHARS = "一二两兩三四五六七八九十百千〇○零廿卄卅卌\\d０-９";
const HAN_ORDINAL_RE = `[${HAN_ORDINAL_CHARS}]+`;
const CHINESE_CHAPTER_PREFIX_RE = new RegExp(`^(?:第\\s*)?${HAN_ORDINAL_RE}\\s*(?:章|回|節|节|篇|卦|卷)`, "u");
const CHINESE_VOLUME_MARKER_RE = new RegExp(`^(?:卷第?${HAN_ORDINAL_RE}(?:補遺|补遗)?|卷之${HAN_ORDINAL_RE}(?:上|中|下)?|第${HAN_ORDINAL_RE}卷)$`, "u");
const HAN_NUMBER_DIGITS = new Map([
  ["〇", 0],
  ["○", 0],
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["兩", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);
const HAN_NUMBER_UNITS = new Map([
  ["十", 10],
  ["百", 100],
  ["千", 1000],
]);

function parseHanOrdinalNumber(value) {
  const text = String(value || "")
    .replace(/[０-９]/gu, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/[廿卄]/gu, "二十")
    .replace(/卅/gu, "三十")
    .replace(/卌/gu, "四十")
    .replace(/\s+/g, "")
    .trim();
  if (!text) return null;
  if (/^\d+$/u.test(text)) return Number(text);
  if (![...text].every((ch) => HAN_NUMBER_DIGITS.has(ch) || HAN_NUMBER_UNITS.has(ch))) return null;
  if (![...text].some((ch) => HAN_NUMBER_UNITS.has(ch))) {
    const digits = [...text].map((ch) => HAN_NUMBER_DIGITS.get(ch));
    const number = Number(digits.join(""));
    return Number.isFinite(number) ? number : null;
  }

  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (HAN_NUMBER_DIGITS.has(ch)) {
      current = HAN_NUMBER_DIGITS.get(ch);
      continue;
    }
    const unit = HAN_NUMBER_UNITS.get(ch);
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function chineseOrdinalFromTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  const chapter = value.match(new RegExp(`^第\\s*(${HAN_ORDINAL_RE})\\s*(回|章|節|节|篇|卦|卷)`, "u"));
  if (chapter) {
    const n = parseHanOrdinalNumber(chapter[1]);
    return n ? { kind: chapter[2], n } : null;
  }
  const volume = value.match(new RegExp(`^卷第?\\s*(${HAN_ORDINAL_RE})`, "u"))
    || value.match(new RegExp(`^卷之\\s*(${HAN_ORDINAL_RE})`, "u"));
  if (volume) {
    const n = parseHanOrdinalNumber(volume[1]);
    return n ? { kind: "卷", n } : null;
  }
  return null;
}

function trimChineseChapterTitleProseTail(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  const recitationStart = value.search(/\s+(?:詩曰|诗曰|詞曰|词曰)[:：]/u);
  if (recitationStart > 0 && CHINESE_CHAPTER_PREFIX_RE.test(value)) {
    return value.slice(0, recitationStart).trim();
  }
  const withoutRecitationMarker = value.replace(/\s+(?:詩曰|诗曰|詞曰|词曰)[:：]?$/u, "").trim();
  if (withoutRecitationMarker !== value) return withoutRecitationMarker;
  if (!CHINESE_CHAPTER_PREFIX_RE.test(value) || !/[。！？；;]/u.test(value)) return value;
  const chunks = value.split(/\s+/).filter(Boolean);
  if (chunks.length < 4) return value;
  const last = chunks[chunks.length - 1] || "";
  const bodyChunks = chunks.slice(1, -1);
  if (bodyChunks.length < 2) return value;
  if (bodyChunks.some((chunk) => /[，。！？；;:：]/u.test(chunk))) return value;
  if (!/[，。！？；;]/u.test(last) || !/[。！？；;]$/u.test(last)) return value;
  if ([...last].length > 28) return value;
  return chunks.slice(0, -1).join(" ");
}

function looksLikeShortChineseProseTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  if (!value || !/\p{Script=Han}/u.test(value)) return false;
  if (CHINESE_CHAPTER_PREFIX_RE.test(value) || isVolumeMarker(value)) return false;
  if (/^\d{1,3}[.、]\s+[\p{Script=Han}]{1,16}$/u.test(value)) return false;
  return [...value].length <= 48 && /(?:[。！？!?；;﹗﹖﹔]|……|…+)$/u.test(value);
}

function chineseBookPrefixedChapterTitle(title, bookTitle) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  const book = String(bookTitle || "").replace(/\s+/g, " ").trim();
  if (!value || !book || !/\p{Script=Han}/u.test(book)) return null;
  const dotted = value.match(new RegExp(`^${escapeRegExp(book)}\\s*[‧·・．.]\\s*([\\p{Script=Han}]{1,24})$`, "u"));
  if (dotted) return dotted[1];
  const match = value.match(new RegExp(`^${escapeRegExp(book)}\\s+([\\p{Script=Han}]{1,24}(?:本紀|世家|列傳|列传|書|书|表|志|傳|传))$`, "u"));
  return match?.[1] || null;
}

function isSameBookTitle(title, bookTitle) {
  const a = comparableTitle(title);
  const b = comparableTitle(bookTitle);
  return Boolean(a && b && (a === b || a.startsWith(b) || (a.length >= 8 && b.startsWith(a))));
}

function undecorateTitle(block) {
  const lines = String(block || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  let title = lines[0].replace(/\s+/g, " ").trim();
  const bracketed = title.match(/^[《〈「『【]([^《》〈〉「」『』【】]{1,80})[》〉」』】]$/u);
  if (bracketed) title = bracketed[1].trim();
  return title || null;
}

function isVolumeMarker(title) {
  return CHINESE_VOLUME_MARKER_RE.test(title);
}

function isChineseVolumeMarkerTitle(title) {
  return isVolumeMarker(String(title || "").replace(/\s+/g, " ").trim());
}

function isNoiseTitle(title, bookTitle) {
  return isProjectGutenbergBoilerplateBlock(title)
    || /^produced by\b/i.test(title)
    || /^title\s*:/i.test(title)
    || /^author\s*:/i.test(title)
    || /^the project gutenberg ebook\b/i.test(title)
    || /^the project gutenberg e-?text\b/i.test(title)
    || /^this etext was prepared\b/i.test(title)
    || /^full project gutenberg/i.test(title)
    || /^the full project gutenberg/i.test(title)
    || /^transcriber'?s notes?\b/i.test(title)
    || /^linked image$/i.test(title)
    || isSameBookTitle(title, bookTitle);
}

function looksLikeChapterTitle(title, wasBracketed) {
  if (wasBracketed && title.length <= 40 && /[\p{L}\p{N}]/u.test(title)) return true;
  return Boolean(englishChapterTitle(title))
    || /^(?:preface|prologue|epilogue)\.?$/i.test(title)
    || /^LIBER\s+[IVXLCDM]+$/u.test(title)
    || /^[\p{L}]+ runo$/iu.test(title)
    || /^KSIĘGA\s+[\p{L}]+\.?$/iu.test(title)
    || new RegExp(`^第\\s*${HAN_ORDINAL_RE}\\s*(?:章|回|節|节|篇|卦|卷).{0,80}$`, "u").test(title)
    || new RegExp(`^卷第?${HAN_ORDINAL_RE}\\s+.{1,40}$`, "u").test(title)
    || new RegExp(`^卷之${HAN_ORDINAL_RE}[\\p{Script=Han}]{1,16}(?:上|中|下)?$`, "u").test(title)
    || new RegExp(`^[\\p{Script=Han}]{1,16}篇${HAN_ORDINAL_RE}$`, "u").test(title)
    || new RegExp(`^[\\p{Script=Han}]{1,16}(?:上|中|下)?第${HAN_ORDINAL_RE}$`, "u").test(title)
    || /^\d{1,3}[.、]\s+[\p{Script=Han}]{1,12}$/u.test(title)
    || /^\d{3}[.、\s]+[\p{Script=Han}][^\n:：。！？；「」“”]{1,80}$/u.test(title);
}

function classifyLogicalHeading(block, bookTitle) {
  const raw = String(block || "").trim();
  const wasBracketed = /^[《〈「『【][^《》〈〉「」『』【】]{1,80}[》〉」』】]$/u.test(raw);
  const title = trimChineseChapterTitleProseTail(undecorateTitle(raw));
  if (!title) return null;
  const prefixed = chineseBookPrefixedChapterTitle(title, bookTitle);
  if (prefixed) return { kind: "chapter", title: prefixed };
  if (isNoiseTitle(title, bookTitle)) return null;
  if (isVolumeMarker(title)) return { kind: "volume", title };
  if (looksLikeChapterTitle(title, wasBracketed)) return { kind: "chapter", title };
  if (looksLikeProseTitle(title)) return null;
  if (looksLikeProseBlock(title)) return null;
  return null;
}

function splitAnthologyBlock(block) {
  const text = String(block || "").trim();
  const re = /(?:^|\s)(\d{3})\s+(.{1,50}?)\s+作者：(.{1,20}?)(?=\s|$)/gu;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return null;

  const parts = [];
  const first = matches[0];
  const preface = text.slice(0, first.index).trim();
  if (preface && !/^(?:唐詩三百首|唐诗三百首|Title\s*:|Author\s*:)/i.test(preface)) parts.push(preface);

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const title = `${m[1]} ${m[2].trim()} · ${m[3].trim()}`;
    const body = text.slice(m.index + m[0].length, next?.index ?? text.length).trim();
    parts.push(title);
    if (body) parts.push(body);
  }
  return parts;
}

function splitNumberedPoemBlock(block) {
  const text = String(block || "").trim();
  const re = /(^|\s)(\d{1,3})[.、]\s+([\p{Script=Han}]{1,12})(?=\s)/gu;
  const matches = [...text.matchAll(re)].filter((m) => {
    const afterTitle = text.slice(m.index + m[0].length).trimStart();
    return !/^[:：]/.test(afterTitle);
  });
  if (!matches.length) return null;

  const parts = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const bodyStart = m.index + m[0].length;
    const next = matches[i + 1];
    const nextStart = next ? next.index + next[1].length : text.length;
    const body = text.slice(bodyStart, nextStart).trim();
    parts.push(`${m[2]}. ${m[3].trim()}`);
    if (body) parts.push(body);
  }
  return parts;
}

function splitInlineChineseChapterBlock(block) {
  const text = String(block || "").trim();
  const re = new RegExp(`(^|[\\s。！？；;])((?:第\\s*${HAN_ORDINAL_RE}\\s*回\\s*[:：]?\\s*[\\p{Script=Han}][^\\n。！？；;，、]{1,80})|(?:第\\s*${HAN_ORDINAL_RE}\\s*回)|(?:第\\s*${HAN_ORDINAL_RE}\\s*(?:章|節|节|篇|卦|卷)))(?=\\s|　|$|[。！？；;:：])`, "gu");
  const matches = [...text.matchAll(re)];
  if (!matches.length) return null;
  if (matches.length === 1 && matches[0].index === 0 && !matches[0][1]) {
    const bodyStart = matches[0].index + matches[0][0].length;
    if (!text.slice(bodyStart).trim()) return null;
  }

  const parts = [];
  const preface = text.slice(0, matches[0].index).trim();
  if (preface) parts.push(preface);
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const headingStart = m.index + m[1].length;
    let bodyStart = m.index + m[0].length;
    let heading = text.slice(headingStart, bodyStart).trim();
    const recitation = heading.match(/\s+(?=(?:詩曰|诗曰|詞曰|词曰)[:：])/u);
    if (recitation?.index != null) {
      bodyStart = headingStart + recitation.index + recitation[0].length;
      heading = heading.slice(0, recitation.index).trim();
    }
    const body = text.slice(bodyStart, next?.index ?? text.length).trim();
    parts.push(heading);
    if (body) parts.push(body);
  }
  return parts;
}

function splitInlineVolumeBlock(block) {
  const text = String(block || "").trim();
  const re = new RegExp(`(?:^|\\s)((?:卷之${HAN_ORDINAL_RE}(?:[\\p{Script=Han}]{1,16}(?:上|中|下)?)?)|(?:卷第?${HAN_ORDINAL_RE}(?:補遺|补遗)?))(?=\\s|　|$)`, "gu");
  const matches = [...text.matchAll(re)];
  if (!matches.length) return null;

  const parts = [];
  const first = matches[0];
  const preface = text.slice(0, first.index).trim();
  if (preface) parts.push(preface);

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const body = text.slice(m.index + m[0].length, next?.index ?? text.length).trim();
    parts.push(m[1].trim());
    if (body) parts.push(body);
  }
  return parts;
}

function splitTrailingChineseHeadingBlock(block) {
  const text = String(block || "").trim();
  if (!text || classifyLogicalHeading(text, "")?.kind === "chapter") return null;
  const re = new RegExp(`((?:卷${HAN_ORDINAL_RE})|[\\p{Script=Han}]{2,18}(?:篇)?第${HAN_ORDINAL_RE}|[\\p{Script=Han}]{2,18}篇${HAN_ORDINAL_RE})$`, "u");
  const match = text.match(re);
  if (!match || match.index == null) return null;
  const title = match[1].trim();
  if (!classifyLogicalHeading(title, "") || looksLikeProseTitle(title)) return null;
  const body = text.slice(0, match.index).trim();
  if (match.index < 80 && !/[。！？」』”"]$/u.test(body)) return null;
  if (!body || (!/[。！？」』”"]$/u.test(body) && !(body.length > 120 && /\p{Script=Han}$/u.test(body)))) return null;
  return [body, title];
}

function splitInlineEnglishChapterBlock(block) {
  const text = String(block || "").trim();
  const re = /\b(?:CHAPTER\s*(?:[IVXLCDM]+|\d+)\.?|Chapter\s+(?:[IVXLCDM]+|\d+)\.?|LETTER\s+\d+\.?|Letter\s+\d+\.?|BOOK\s+(?:[IVXLCDM]+|\d+)\.?|Book\s+(?:[IVXLCDM]+|\d+)\.?|Epilogue|EPILOGUE)\b/gu;
  const matches = [...text.matchAll(re)].filter((m) => {
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    return !/chapter\s*:\s*$/i.test(before);
  });
  if (!matches.length) return null;

  const parts = [];
  const preface = text.slice(0, matches[0].index).trim();
  if (preface && !/^(?:contents?|list of illustrations?|cover|linked image)$/i.test(preface)) parts.push(preface);

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const headingStart = m.index;
    const after = text.slice(headingStart, next?.index ?? text.length).trim();
    const lines = after.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = englishChapterTitle(lines[0]) || m[0].replace(/^CHAPTER/i, "CHAPTER ").replace(/\s+/g, " ").trim();
    const body = after.slice(lines[0]?.length || m[0].length).trim();
    parts.push(title);
    if (body) parts.push(body);
  }
  return parts;
}

function expandLogicalBlocks(blocks) {
  const out = [];
  for (const block of blocks) {
    const anthology = splitAnthologyBlock(block);
    if (anthology) {
      out.push(...anthology);
      continue;
    }

    const inlineChinese = splitInlineChineseChapterBlock(block);
    if (inlineChinese) {
      out.push(...inlineChinese);
      continue;
    }

    const numberedPoem = splitNumberedPoemBlock(block);
    if (numberedPoem) {
      out.push(...numberedPoem);
      continue;
    }

    const inlineVolume = splitInlineVolumeBlock(block);
    if (inlineVolume) {
      out.push(...inlineVolume);
      continue;
    }

    const trailingChineseHeading = splitTrailingChineseHeadingBlock(block);
    if (trailingChineseHeading) {
      out.push(...trailingChineseHeading);
      continue;
    }

    const inlineEnglish = splitInlineEnglishChapterBlock(block);
    if (inlineEnglish) {
      out.push(...inlineEnglish);
      continue;
    }

    const bracketed = block.match(/^([《〈「『【][^《》〈〉「」『』【】]{1,80}[》〉」』】])\s+([\s\S]+)$/u);
    if (bracketed) {
      out.push(bracketed[1].trim());
      out.push(bracketed[2].trim());
      continue;
    }

    const standaloneChapterWithTitle = block.replace(/\s+/g, " ").trim();
    if (new RegExp(`^第\\s*${HAN_ORDINAL_RE}\\s*回(?:\\s+[\\p{Script=Han}][^。！？；;，、]{1,80})?$`, "u").test(standaloneChapterWithTitle)) {
      out.push(standaloneChapterWithTitle);
      continue;
    }

    const numbered = block.match(new RegExp(`^(第\\s*${HAN_ORDINAL_RE}\\s*(?:章|回|節|节|篇|卦|卷).{0,80})\\s+([\\s\\S]+)$`, "u"));
    if (numbered) {
      out.push(numbered[1].trim());
      out.push(numbered[2].trim());
      continue;
    }

    out.push(block);
  }
  return out;
}

function splitLogicalChapters(text, bookTitle, leadingTitle = null) {
  const blocks = expandLogicalBlocks(String(text || "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean));
  const build = (volumesAsChapters = false) => {
    const chapters = [];
    let current = leadingTitle ? { title: leadingTitle, blocks: [] } : null;
    let leadingBlocks = [];

    const finish = (keepEmpty = false) => {
      if (!current) return;
      const body = normalizeTextBlocks(current.blocks.join("\n\n"));
      if (body || keepEmpty) chapters.push({ title: current.title, text: body });
      current = null;
    };
    const inferLeadingChineseFirstChapter = (nextTitle) => {
      const match = String(nextTitle || "")
        .replace(/\s+/g, " ")
        .trim()
        .match(/^第\s*二\s*(章|回|節|节|篇|卦|卷)/u);
      return match ? `第一${match[1]}` : null;
    };
    const flushLeadingBlocks = (nextTitle) => {
      if (current || !leadingBlocks.length) return;
      const inferredTitle = inferLeadingChineseFirstChapter(nextTitle);
      if (!inferredTitle) {
        leadingBlocks = [];
        return;
      }
      const body = normalizeTextBlocks(leadingBlocks.join("\n\n"));
      const proseBlocks = leadingBlocks.filter(looksLikeProseBlock).length;
      if (body.length >= 200 && proseBlocks && !looksLikeNavigationOnlyText(body, bookTitle)) {
        chapters.push({ title: inferredTitle, text: body });
      }
      leadingBlocks = [];
    };

    for (const block of blocks) {
      const heading = classifyLogicalHeading(block, bookTitle);
      if (heading?.kind === "volume") {
        leadingBlocks = [];
        if (volumesAsChapters || isChineseVolumeMarkerTitle(current?.title)) {
          finish();
          current = { title: heading.title, blocks: [] };
        }
        continue;
      }
      if (heading?.kind === "chapter") {
        flushLeadingBlocks(heading.title);
        finish();
        current = { title: heading.title, blocks: [] };
        continue;
      }
      if (current) current.blocks.push(block);
      else if (!leadingTitle && !isProjectGutenbergBoilerplateBlock(block)) leadingBlocks.push(block);
    }

    finish(true);
    return chapters;
  };

  const chapters = build(false);
  const volumeChapters = build(true);
  if (shouldPreferVolumeLogicalChapters(chapters, volumeChapters, leadingTitle)) return volumeChapters;
  return chapters.length ? chapters : volumeChapters;
}

function shouldPreferVolumeLogicalChapters(chapters, volumeChapters, leadingTitle = null) {
  if (!volumeChapters.length) return false;
  const volumeCount = volumeChapters.filter((chapter) => isChineseVolumeMarkerTitle(chapter.title)).length;
  if (!volumeCount) return false;
  if (!chapters.length) return true;
  const volumeTextLength = volumeChapters.reduce((sum, chapter) => sum + String(chapter.text || "").length, 0);
  const chapterTextLength = chapters.reduce((sum, chapter) => sum + String(chapter.text || "").length, 0);
  if (leadingTitle && volumeChapters.length > chapters.length && volumeTextLength >= chapterTextLength) return true;
  return volumeCount >= 2
    && volumeChapters.length > chapters.length
    && volumeTextLength >= chapterTextLength;
}

function isMoziCanonTitle(title) {
  return /^(?:經|经)[上下]$/u.test(String(title || "").replace(/\s+/g, "").trim());
}

function moziCommentaryTitle(title) {
  const compact = String(title || "").replace(/\s+/g, "").trim();
  if (/^(?:經|经)上$/u.test(compact)) return "經說上";
  if (/^(?:經|经)下$/u.test(compact)) return "經說下";
  return null;
}

function moziCommentaryMarker(title) {
  const compact = String(title || "").replace(/\s+/g, "").trim();
  if (/^(?:經|经)上$/u.test(compact)) return /^(?:經|经)[說说説]上\s*[:：]\s*/u;
  if (/^(?:經|经)下$/u.test(compact)) return /^(?:經|经)[說说説]下\s*[:：]\s*/u;
  return null;
}

function isMoziFootnoteBlock(block) {
  return /^\d{1,3}\.\s*.{1,28}\s*[:：]\s*(?:原錯|原错|舊脫|旧脱|自|刪除|删除|衍文|移到|由王校改|孫|孙|吳|吴|清)/u
    .test(String(block || "").replace(/\s+/g, " ").trim());
}

function splitInterleavedMoziCanonChapter(chapter) {
  if (!isMoziCanonTitle(chapter.title)) return [chapter];
  const marker = moziCommentaryMarker(chapter.title);
  const commentaryTitle = moziCommentaryTitle(chapter.title);
  if (!marker || !commentaryTitle) return [chapter];

  const blocks = String(chapter.text || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (!blocks.some((block) => marker.test(block))) return [chapter];
  const canonBlocks = [];
  const commentaryBlocks = [];
  let lastTarget = canonBlocks;
  for (const block of blocks) {
    if (marker.test(block)) {
      commentaryBlocks.push(block.replace(marker, "").trim());
      lastTarget = commentaryBlocks;
      continue;
    }
    if (/^\d{1,3}\.\s+/u.test(block) && !isMoziFootnoteBlock(block)) {
      canonBlocks.push(block);
      lastTarget = canonBlocks;
      continue;
    }
    lastTarget.push(block);
  }

  const canonText = normalizeTextBlocks(canonBlocks.join("\n\n"));
  const commentaryText = normalizeTextBlocks(commentaryBlocks.join("\n\n"));
  if (!canonText || !commentaryText) return [chapter];
  return [
    { ...chapter, text: canonText },
    { ...chapter, title: commentaryTitle, text: commentaryText },
  ];
}

function shouldMergeProseTitleContinuation(chapter, index) {
  if (index <= 0) return false;
  const title = String(chapter?.title || "").replace(/\s+/g, " ").trim();
  if (!title) return false;
  if (englishChapterTitle(title)) return false;
  if (classifyLogicalHeading(title, "")?.kind === "chapter") return false;
  if (CHINESE_CHAPTER_PREFIX_RE.test(title)) return false;
  if (/^\d{1,3}[.、]\s+[\p{Script=Han}]{1,16}$/u.test(title)) return false;
  return looksLikeProseTitle(title)
    || looksLikeProseBlock(title)
    || (/\p{Script=Han}/u.test(title) && title.length > 24 && /[，。、；：？！“”"「」]/u.test(title));
}

function shouldMergeDuplicateTitleContinuation(previous, chapter) {
  const left = comparableTitle(previous?.title);
  const right = comparableTitle(chapter?.title);
  if (!left || left !== right) return false;
  return left.length >= 2;
}

function shouldMergeShortChineseReviewContinuation(chapter) {
  const title = String(chapter?.title || "").replace(/\s+/g, " ").trim();
  const text = String(chapter?.text || "").trim();
  return /^(?:評|评)$/u.test(title) && text.length <= 600;
}

function isShortChineseInterludeTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  return /^[\p{Script=Han}]{2,6}$/u.test(value)
    && !isChineseOrdinalChapterTitle(value)
    && !isVolumeMarker(value)
    && !/^(?:評|评|序|跋|自序|序言|例言|目錄|目录|附錄|附录|附記|附记|後記|后记)$/u.test(value);
}

function shouldMergeShortChineseInterludes(chapters) {
  const ordinalCount = chapters.filter((chapter) => isChineseOrdinalChapterTitle(chapter.title)).length;
  const interludeCount = chapters.filter((chapter) => isShortChineseInterludeTitle(chapter.title)).length;
  return ordinalCount >= 5
    && interludeCount >= 1
    && ordinalCount / Math.max(1, chapters.length) >= 0.45;
}

function shouldMergeChineseOrdinalRunInterruption(chapters, index, previous) {
  const title = String(chapters[index]?.title || "").replace(/\s+/g, " ").trim();
  if (!previous || !title || !/\p{Script=Han}/u.test(title)) return false;
  if (chineseOrdinalFromTitle(title) || isVolumeMarker(title)) return false;
  if (/^(?:評|评|序|跋|自序|序言|例言|目錄|目录|附錄|附录|附記|附记|後記|后记)$/u.test(title)) return false;
  if ([...title].length > 24) return false;
  const previousOrdinal = chineseOrdinalFromTitle(previous.title);
  const nextOrdinal = chineseOrdinalFromTitle(chapters[index + 1]?.title);
  if (!previousOrdinal || !nextOrdinal || previousOrdinal.kind !== nextOrdinal.kind) return false;
  if (nextOrdinal.n !== previousOrdinal.n + 1) return false;
  const ordinalCount = chapters.filter((chapter) => chineseOrdinalFromTitle(chapter.title)).length;
  return ordinalCount >= 5 && ordinalCount / Math.max(1, chapters.length) >= 0.45;
}

function mergeProseTitleContinuations(chapters, bookTitle = "") {
  const out = [];
  const mergeShortInterludes = shouldMergeShortChineseInterludes(chapters);
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (
      !out.length
      && index === 0
      && chapters[index + 1]
      && isSameBookTitle(chapter.title, bookTitle)
      && String(chapter.text || "").length < 1600
    ) {
      const next = chapters[index + 1];
      out.push({
        ...next,
        text: cleanExtractedChapterText(next.title, `${chapter.text}\n\n${next.text}`),
      });
      index += 1;
      continue;
    }
    if (!out.length && index === 0 && chapters[index + 1] && shouldMergeProseTitleContinuation(chapter, 1)) {
      const next = chapters[index + 1];
      out.push({
        ...next,
        text: cleanExtractedChapterText(next.title, `${chapter.title}\n\n${chapter.text}\n\n${next.text}`),
      });
      index += 1;
      continue;
    }
    const previous = out[out.length - 1];
    if (out.length && shouldMergeDuplicateTitleContinuation(previous, chapter)) {
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${chapter.text}`);
      continue;
    }
    if (out.length && shouldMergeShortChineseReviewContinuation(chapter)) {
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${chapter.title}\n\n${chapter.text}`);
      continue;
    }
    if (
      mergeShortInterludes
      && out.length
      && isChineseOrdinalChapterTitle(previous.title)
      && isShortChineseInterludeTitle(chapter.title)
    ) {
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${chapter.title}\n\n${chapter.text}`);
      continue;
    }
    if (out.length && shouldMergeChineseOrdinalRunInterruption(chapters, index, previous)) {
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${chapter.title}\n\n${chapter.text}`);
      continue;
    }
    if (out.length && shouldMergeProseTitleContinuation(chapter, index)) {
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${chapter.title}\n\n${chapter.text}`);
      continue;
    }
    out.push({ ...chapter });
  }
  return out;
}

function finalizeExtractedChapters(chapters, bookTitle = "") {
  return mergeProseTitleContinuations(chapters, bookTitle)
    .flatMap(splitInterleavedMoziCanonChapter)
    .filter((chapter) => chapter.text)
    .map((chapter, index) => ({ ...chapter, n: index + 1 }));
}

function isProjectGutenbergOnlyChapter(title, text) {
  const haystack = `${title}\n${text}`.toLowerCase();
  return /preface to the project gutenberg etext/.test(haystack)
    || /project gutenberg etext of/.test(haystack)
    || isProjectGutenbergBoilerplateBlock(title)
    || /^the full project gutenberg(?:™|\(tm\))?\s+license\b/i.test(String(title || "").trim());
}

function isStandaloneGutenbergJunkTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  return /^preface to the project gutenberg e-?text\b/i.test(value)
    || /^the full project gutenberg(?:™|\(tm\))?\s+license\b/i.test(value)
    || /^full project gutenberg(?:™|\(tm\))?\s+license\b/i.test(value)
    || /^transcriber'?s notes?\b/i.test(value)
    || /^linked image$/i.test(value);
}

function isTitlePageOnlyChapter(rawTitle, text) {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const body = String(text || "").replace(/\s+/g, " ").trim();
  const creditTitle = looksLikeCreditTitle(title) || /^[A-Z]\.\s*[\p{Lu}\p{M}'’ -]{2,48}$/u.test(title);
  if (!creditTitle) return false;
  const frontMatterSignal = /(illustrat|incisioni|nuova edizione|editori|letteraria|copyright|all rights reserved)/i.test(body);
  if (!frontMatterSignal) return false;
  const firstBodyLine = body.split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.replace(/\s+/g, " ") !== title) || "";
  return body.length < 1600
    && !englishChapterTitle(firstBodyLine);
}

function isBookTitleFrontMatter(rawTitle, text, bookTitle) {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  if (!isSameBookTitle(title, bookTitle)) return false;
  const blocks = String(text || "").split(/\n{2,}/).map((block) => block.replace(/\s+/g, " ").trim()).filter(Boolean);
  const first = blocks.find((block) => !isGeneratedEpubPageMarker(block)) || "";
  if (/^(?:to\b|dedicat|contents?|part\s+)/i.test(first)) return true;
  if (looksLikeNavigationOnlyText(text, bookTitle)) return true;
  const prose = blocks.filter(looksLikeProseBlock).length;
  return blocks.join(" ").length < 1800 && prose <= 1 && !hasExplicitChapterHeading(text, bookTitle);
}

function isContentsOnlyChapter(rawTitle, text) {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const blocks = String(text || "").split(/\n{2,}/).map((block) => block.replace(/\s+/g, " ").trim()).filter(Boolean);
  const body = blocks.join(" ");
  if (/^contents?$/i.test(title)) return true;
  const tocSignals = [...body.matchAll(/\b(?:STAVE|CHAPTER|BOOK|PART)\b/gi)].length;
  return /^[A-Z]\.\s*[A-Z]\.?$/u.test(title)
    && /\bcontents?\b/i.test(body)
    && (tocSignals >= 3 || blocks.filter(looksLikeProseBlock).length === 0);
}

function looksLikeCreditFrontMatterText(text, bookTitle) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body || body.length >= 1600 || !/(illustrat|nuova edizione|editori|letteraria|copyright|all rights reserved)/i.test(body)) return false;
  return !hasExplicitChapterHeading(text, bookTitle);
}

function isSpineContinuation(title, bookTitle) {
  if (!title || isNoiseTitle(title, bookTitle)) return false;
  if (classifyLogicalHeading(title, bookTitle)?.kind === "chapter") return false;
  return /^\d{1,3}[.、]\s+/.test(title);
}

function isChineseOrdinalChapterTitle(title) {
  return Boolean(chineseOrdinalFromTitle(title));
}

function navigationLosesChineseCoverage(navigationChapters, spineChapters) {
  if (!spineChapters.length || navigationChapters.length >= spineChapters.length) return false;
  const spineChinese = spineChapters.filter((chapter) => isChineseOrdinalChapterTitle(chapter.title)).length;
  const navigationChinese = navigationChapters.filter((chapter) => isChineseOrdinalChapterTitle(chapter.title)).length;
  return spineChinese >= 8 && navigationChinese >= 8 && spineChinese > navigationChinese;
}

function looksLikeChineseProseNavigationTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  if (!value || isChineseOrdinalChapterTitle(value)) return false;
  if (!/\p{Script=Han}/u.test(value)) return false;
  return [...value].length >= 8 && /[。！？；;﹗﹖]$/u.test(value);
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
  const bookTitle = pkg.parsed.metadata.title || "";
  const navigationChapters = chaptersFromNavigation(pkg, items, bookTitle);
  let pendingLogicalTitle = null;

  for (const item of items) {
    const raw = entryText(pkg.entries, item.href);
    if (!raw) continue;
    const text = stripProjectGutenbergBoilerplate(htmlToText(raw));
    if (!text) continue;
    if (looksLikeNavigationOnlyText(text, bookTitle)) continue;
    if (looksLikeCreditFrontMatterText(text, bookTitle)) continue;
    const rawTitle = chapterTitleFromHtml(raw, `Chapter ${chapters.length + 1}`);
    if (isStandaloneGutenbergJunkTitle(rawTitle)) continue;
    if (isTitlePageOnlyChapter(rawTitle, text)) continue;
    if (!pendingLogicalTitle && isBookTitleFrontMatter(rawTitle, text, bookTitle)) continue;
    if (isContentsOnlyChapter(rawTitle, text)) continue;
    let title = cleanChapterTitle(
      rawTitle,
      text,
      `Chapter ${chapters.length + 1}`,
      bookTitle,
    );
    if (
      chapters.length
      && isSameBookTitle(title, bookTitle)
      && shouldMergeProseTitleContinuation({ title: rawTitle }, 1)
    ) {
      title = String(rawTitle || "").replace(/\s+/g, " ").trim();
    }
    if (/^[A-Z]\.\s*[\p{Lu}\p{M}'’ -]{2,80}$/u.test(title) && /(illustrat|nuova edizione|editori|letteraria)/i.test(text)) continue;
    if (isTitlePageOnlyChapter(title, text)) continue;
    if (isProjectGutenbergOnlyChapter(title, text)) continue;
    const logical = splitLogicalChapters(text, bookTitle, pendingLogicalTitle);
    if (logical.length) {
      pendingLogicalTitle = null;
      for (let i = 0; i < logical.length; i += 1) {
        const ch = logical[i];
        if (!ch.text) {
          if (i === logical.length - 1) pendingLogicalTitle = ch.title;
          continue;
        }
        const chapter = makeChapter(chapters.length + 1, ch.title, ch.text);
        if (chapter.text) chapters.push(chapter);
      }
    } else if (pendingLogicalTitle && !hasExplicitChapterHeading(text, bookTitle)) {
      const chapter = makeChapter(chapters.length + 1, pendingLogicalTitle, text);
      if (chapter.text) chapters.push(chapter);
      pendingLogicalTitle = null;
    } else if (isNavigationNoiseTitle(title, bookTitle) && !(isSameBookTitle(title, bookTitle) && !chapters.length)) {
      continue;
    } else if (isSameBookTitle(title, bookTitle) && chapters.length) {
      const previous = chapters[chapters.length - 1];
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${text}`);
    } else if (chapters.length && isSpineContinuation(title, bookTitle)) {
      const previous = chapters[chapters.length - 1];
      previous.text = cleanExtractedChapterText(previous.title, `${previous.text}\n\n${title}\n\n${text}`);
    } else {
      const chapter = makeChapter(chapters.length + 1, title, text);
      if (chapter.text) chapters.push(chapter);
    }
  }

  if (navigationChapters.length) {
    const enoughCoverage = !chapters.length
      || navigationChapters.length >= chapters.length * 0.7
      || navigationChapters.length >= 20;
    const notOversegmented = !chapters.length
      || navigationChapters.length <= Math.max(chapters.length * 1.8, chapters.length + 8);
    if (enoughCoverage && notOversegmented && !navigationLosesChineseCoverage(navigationChapters, chapters)) {
      const finalized = finalizeExtractedChapters(navigationChapters, bookTitle);
      if (!finalized.some((chapter) => looksLikeChineseProseNavigationTitle(chapter.title))) {
        assertReadableChapters(finalized);
        return finalized;
      }
    }
  }
  if (!chapters.length) throw new LiberCliError("EPUB_NO_TEXT", "EPUB spine has no readable XHTML/HTML text chapters.");
  const finalized = finalizeExtractedChapters(chapters, bookTitle);
  assertReadableChapters(finalized);
  return finalized;
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
    ["COPYRIGHTED", /\bcopyrighted\b|copyright\s*\(c\)|©/i],
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
  const includeSource = options.includeSource !== false;
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
    ...(includeSource ? { epubBase64: epubBytes.toString("base64") } : {}),
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
  const payload = options.ingestPayload || await createIngestPayload(manifest, options);
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
    throw new LiberCliError("PUBLISH_NETWORK_FAILED", `Publish request failed for ${ingestUrl}: ${describeFetchError(error)}`);
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

function describeFetchError(error) {
  const parts = [error?.message || String(error)];
  if (error?.cause?.code) parts.push(error.cause.code);
  if (error?.cause?.message) parts.push(error.cause.message);
  return [...new Set(parts.filter(Boolean))].join(": ");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(attempt) {
  return Math.min(5000, 350 * (2 ** attempt));
}

async function postPublishJson(fetcher, url, token, payload, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 4) || 4);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let res;
    try {
      res = await fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = new LiberCliError("PUBLISH_NETWORK_FAILED", `Publish request failed for ${url}: ${describeFetchError(error)}`);
      if (attempt < attempts - 1) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw lastError;
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { text };
    }
    if (res.ok) return body;
    lastError = new LiberCliError("PUBLISH_FAILED", `Publish failed with HTTP ${res.status}: ${text}`);
    if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
      await sleep(retryDelayMs(attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError || new LiberCliError("PUBLISH_FAILED", `Publish failed for ${url}`);
}

function withoutLargeBookFields(payload) {
  const { chapters, epubBase64, text, ...rest } = payload;
  return rest;
}

export async function publishBookManifestChunked(manifest, options = {}) {
  const config = options.config || await loadCliConfig({ configPath: options.configPath });
  const resolved = resolvePublishOptions(options, config);
  if (!resolved.adminToken) {
    throw new LiberCliError("AUTH_REQUIRED", "Publish token is required. Run `liber auth browser --api-url <url>` or configure ADMIN_TOKEN for headless admin use.");
  }
  const payload = options.ingestPayload || await createIngestPayload(manifest, options);
  const fetcher = options.fetchImpl || fetch;
  const base = resolved.apiUrl;
  const meta = withoutLargeBookFields(payload);
  const total = payload.chapters.length;
  const words = payload.chapters.reduce((sum, ch) => sum + String(ch.text || "").replace(/\s+/g, "").length, 0);
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency || 1) || 1));

  options.onProgress?.({ stage: "begin", current: 0, total });
  const begin = await postPublishJson(fetcher, `${base}/api/books/ingest/begin`, resolved.adminToken, {
    ...meta,
    epubBase64: payload.epubBase64,
  });

  const chapters = new Array(total);
  let next = 0;
  const publishNext = async () => {
    while (next < total) {
      const i = next;
      next += 1;
      const chapter = payload.chapters[i];
      options.onProgress?.({ stage: "chapter", current: i + 1, total, chapter });
      chapters[i] = await postPublishJson(fetcher, `${base}/api/books/ingest/chapter`, resolved.adminToken, {
        ...meta,
        index: i,
        chapter,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, publishNext));

  options.onProgress?.({ stage: "finalize", current: total, total });
  const finalize = await postPublishJson(fetcher, `${base}/api/books/ingest/finalize`, resolved.adminToken, {
    ...meta,
    chapterNumbers: payload.chapters.map((ch) => ch.n).filter(Boolean),
    words,
  });
  return { ok: true, begin, chapters, finalize, book: finalize.book, manifest: finalize.manifest };
}
