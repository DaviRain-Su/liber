#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBookManifest,
  createIngestPayload,
  inspectEpub,
  publishBookManifestChunked,
  verifyPublishLicense,
} from "../packages/liber-cli/src/liber-core.mjs";

const BOOKS = [
  {
    id: "yueyanglou-ji-wikisource-zh",
    title: "岳陽樓記",
    author: "范仲淹",
    lang: "zh",
    category: "中文 · 古文",
    year: "北宋",
    sourceTitle: "岳陽樓記",
    evidence: "Wikisource Chinese text of a 1046 public-domain work by Fan Zhongyan.",
    blurb: "先天下之憂而憂，後天下之樂而樂。",
    description: "范仲淹《岳陽樓記》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "zuiwengting-ji-wikisource-zh",
    title: "醉翁亭記",
    author: "歐陽脩",
    lang: "zh",
    category: "中文 · 古文",
    year: "北宋",
    sourceTitle: "醉翁亭記",
    evidence: "Wikisource Chinese text of a public-domain work by Ouyang Xiu.",
    blurb: "醉翁之意不在酒，在乎山水之間也。",
    description: "歐陽脩《醉翁亭記》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "lantingji-xu-wikisource-zh",
    title: "蘭亭集序",
    author: "王羲之",
    lang: "zh",
    category: "中文 · 古文",
    year: "東晉",
    sourceTitle: "蘭亭集序",
    evidence: "Wikisource Chinese text of a public-domain Eastern Jin work by Wang Xizhi.",
    blurb: "群賢畢至，少長咸集。",
    description: "王羲之《蘭亭集序》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "tengwangge-xu-wikisource-zh",
    title: "滕王閣序",
    author: "王勃",
    lang: "zh",
    category: "中文 · 古文",
    year: "唐",
    sourceTitle: "滕王閣序",
    evidence: "Wikisource Chinese text of a public-domain Tang work by Wang Bo.",
    blurb: "落霞與孤鶩齊飛，秋水共長天一色。",
    description: "王勃《滕王閣序》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "qian-chibifu-wikisource-zh",
    title: "前赤壁賦",
    author: "蘇軾",
    lang: "zh",
    category: "中文 · 辭賦",
    year: "北宋",
    sourceTitle: "前赤壁賦",
    evidence: "Wikisource Chinese text of a 1082 public-domain work by Su Shi.",
    blurb: "清風徐來，水波不興。",
    description: "蘇軾《前赤壁賦》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "hou-chibifu-wikisource-zh",
    title: "後赤壁賦",
    author: "蘇軾",
    lang: "zh",
    category: "中文 · 辭賦",
    year: "北宋",
    sourceTitle: "後赤壁賦",
    evidence: "Wikisource Chinese text of a public-domain work by Su Shi.",
    blurb: "山高月小，水落石出。",
    description: "蘇軾《後赤壁賦》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "loushi-ming-wikisource-zh",
    title: "陋室銘",
    author: "劉禹錫",
    lang: "zh",
    category: "中文 · 古文",
    year: "唐",
    sourceTitle: "陋室銘",
    evidence: "Wikisource Chinese text of a public-domain Tang work by Liu Yuxi.",
    blurb: "斯是陋室，惟吾德馨。",
    description: "劉禹錫《陋室銘》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "ailian-shuo-wikisource-zh",
    title: "愛蓮說",
    author: "周敦頤",
    lang: "zh",
    category: "中文 · 古文",
    year: "北宋",
    sourceTitle: "愛蓮說",
    evidence: "Wikisource Chinese text of a public-domain Song work by Zhou Dunyi.",
    blurb: "出淤泥而不染，濯清漣而不妖。",
    description: "周敦頤《愛蓮說》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "shi-shuo-wikisource-zh",
    title: "師說",
    author: "韓愈",
    lang: "zh",
    category: "中文 · 古文",
    year: "唐",
    sourceTitle: "師說",
    evidence: "Wikisource Chinese text of a public-domain Tang work by Han Yu.",
    blurb: "師者，所以傳道受業解惑也。",
    description: "韓愈《師說》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "bushezhe-shuo-wikisource-zh",
    title: "捕蛇者說",
    author: "柳宗元",
    lang: "zh",
    category: "中文 · 古文",
    year: "唐",
    sourceTitle: "捕蛇者說",
    evidence: "Wikisource Chinese text of a public-domain Tang work by Liu Zongyuan.",
    blurb: "孰知賦斂之毒，有甚是蛇者乎。",
    description: "柳宗元《捕蛇者說》，依中文維基文庫公版文本整理為 EPUB。",
  },
  {
    id: "ma-shuo-wikisource-zh",
    title: "馬說",
    author: "韓愈",
    lang: "zh",
    category: "中文 · 古文",
    year: "唐",
    sourceTitle: "雜說四",
    evidence: "Wikisource Chinese text of a public-domain Tang work by Han Yu.",
    blurb: "世有伯樂，然後有千里馬。",
    description: "韓愈《馬說》，依中文維基文庫《雜說四》公版文本整理為 EPUB。",
  },
  {
    id: "wuliu-xiansheng-zhuan-wikisource-zh",
    title: "五柳先生傳",
    author: "陶淵明",
    lang: "zh",
    category: "中文 · 古文",
    year: "東晉",
    sourceTitle: "五柳先生傳",
    evidence: "Wikisource Chinese text of a public-domain Eastern Jin work by Tao Yuanming.",
    blurb: "不戚戚於貧賤，不汲汲於富貴。",
    description: "陶淵明《五柳先生傳》，依中文維基文庫公版文本整理為 EPUB。",
  },
];

function sourceUrl(book) {
  return `https://zh.wikisource.org/wiki/${encodeURIComponent(book.sourceTitle)}`;
}

function rawUrl(book) {
  return `https://zh.wikisource.org/w/index.php?title=${encodeURIComponent(book.sourceTitle)}&action=raw`;
}

function parsePositiveInteger(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be positive`);
  return n;
}

function parseArgs(argv) {
  const options = {
    publish: false,
    skipExisting: false,
    continueOnError: false,
    summary: false,
    json: false,
    apiUrl: "https://liber.davirain.xyz",
    ids: null,
    concurrency: null,
    chapterConcurrency: 6,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish" || arg === "--skip-existing" || arg === "--continue-on-error" || arg === "--summary" || arg === "--json") {
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    if (arg === "--ids" || arg === "--api-url" || arg === "--concurrency" || arg === "--chapter-concurrency") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--ids") options.ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (arg === "--api-url") options.apiUrl = value.replace(/\/+$/, "");
      else if (arg === "--concurrency") options.concurrency = parsePositiveInteger(value, arg);
      else options.chapterConcurrency = parsePositiveInteger(value, arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function importBookConcurrency(options) {
  if (options.concurrency != null) return Number(options.concurrency);
  return options.publish ? 4 : 8;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function chooseVariant(body) {
  const compact = body.trim();
  if (!compact.includes(":")) return compact;
  const variants = compact.split(";").map((part) => part.trim()).filter(Boolean);
  for (const key of ["zh-hant", "zh"]) {
    const hit = variants.find((part) => part.toLowerCase().startsWith(`${key}:`));
    if (hit) return hit.slice(hit.indexOf(":") + 1).trim();
  }
  const first = variants.find((part) => part.includes(":"));
  return first ? first.slice(first.indexOf(":") + 1).trim() : compact;
}

function splitTemplateArgs(body) {
  return body.split("|").map((part) => part.trim());
}

function renderKnownTemplate(body) {
  const args = splitTemplateArgs(body);
  const name = (args[0] || "").toLowerCase();
  if (name === "*" || name === "textquality" || name === "references") return "";
  if (name === "!" || name === "br") return "";
  if (["專", "另", "另2"].includes(args[0]) || ["propernoun", "lang", "yl", "u"].includes(name)) {
    if (name === "lang") return args[2] || args[1] || "";
    return args[1] || "";
  }
  return "";
}

function stripTemplates(text) {
  let out = text;
  for (let i = 0; i < 30 && /\{\{[^{}]*\}\}/u.test(out); i += 1) {
    out = out.replace(/\{\{([^{}]*)\}\}/gu, (_, body) => renderKnownTemplate(body));
  }
  return out.replace(/\{\{[^{}]*\}\}/gu, "");
}

function extractWikisourceBody(raw) {
  const text = String(raw);
  const only = [...text.matchAll(/<onlyinclude>([\s\S]*?)<\/onlyinclude>/giu)].map((match) => match[1]);
  if (only.length) return only.join("\n\n");
  const sectionStart = text.search(/<section\s+begin\s*=/iu);
  if (sectionStart >= 0) return text.slice(sectionStart);
  return text
    .replace(/\{\{\s*header[\s\S]*?\}\}/iu, "")
    .replace(/\{\{\s*textquality[^}]*\}\}/giu, "");
}

function cleanWikisourceWikitext(raw) {
  let text = extractWikisourceBody(raw);
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/giu, "");
  text = text.replace(/<ref\b[^/]*\/>/giu, "");
  text = text.replace(/<references\b[^/]*\/>/giu, "");
  text = text.replace(/<templatestyles\b[^/]*\/>/giu, "");
  text = text.replace(/<section\b[^/]*\/>/giu, "");
  text = text.replace(/<\/?poem[^>]*>/giu, "");
  text = text.replace(/<\/?div[^>]*>/giu, "");
  text = text.replace(/<\/?span[^>]*>/giu, "");
  text = text.replace(/<\/?small[^>]*>/giu, "");
  text = text.replace(/<\/?u[^>]*>/giu, "");
  text = text.replace(/<br\s*\/?>/giu, "");
  text = text.replace(/<\/br>/giu, "");
  text = text.replace(/-\{([^{}]+)\}-/gu, (_, body) => chooseVariant(body));
  text = text.replace(/\[\[(?:File|Category|分類|Image):[^\]]+\]\]/giu, "");
  text = text.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/gu, "$1");
  text = text.replace(/\[\[([^\]]+)\]\]/gu, "$1");
  text = text.replace(/\[https?:\/\/[^\]\s]+(?:\s+([^\]]+))?\]/giu, "$1");
  text = stripTemplates(text);
  text = text.replace(/'''?/g, "");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text.replace(/[ \t\f\v]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function cnOrdinal(n) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 10) return n === 10 ? "十" : digits[n];
  if (n < 20) return `十${digits[n - 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(n);
}

function paragraphText(part) {
  return part
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWikisourceChapters(book, raw) {
  const cleaned = cleanWikisourceWikitext(raw);
  const paragraphs = cleaned
    .split(/\n\s*\n/g)
    .map(paragraphText)
    .filter((text) => text && /[\p{Script=Han}]/u.test(text));
  if (!paragraphs.length) throw new Error(`${book.id} has no Chinese body text`);
  return paragraphs.map((text, index) => ({
    n: index + 1,
    title: paragraphs.length === 1 ? "全文" : `第${cnOrdinal(index + 1)}段`,
    text,
  }));
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

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
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
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), name, body,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

function xml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xhtmlParagraphs(text) {
  return `<p>${xml(text)}</p>`;
}

async function writeEpub(book, chapters) {
  const dir = await mkdtemp(path.join(tmpdir(), "liber-wikisource-"));
  const epubPath = path.join(dir, `${book.id}.epub`);
  const manifestItems = chapters
    .map((_, i) => `    <item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = chapters.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join("\n");
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="bookid" version="3.0">
  <metadata>
    <dc:identifier id="bookid">urn:liber:${xml(book.id)}</dc:identifier>
    <dc:title>${xml(book.title)}</dc:title>
    <dc:creator>${xml(book.author)}</dc:creator>
    <dc:language>${xml(book.lang)}</dc:language>
    <dc:rights>PUBLIC-DOMAIN</dc:rights>
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
    ...chapters.map((chapter, i) => ({
      name: `OEBPS/chapter${i + 1}.xhtml`,
      body: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xml(book.lang)}">
  <head><title>${xml(chapter.title)}</title></head>
  <body><h1>${xml(chapter.title)}</h1>${xhtmlParagraphs(chapter.text)}</body>
</html>`,
    })),
  ]);
  await writeFile(epubPath, zip);
  return { epubPath, sha256: createHash("sha256").update(zip).digest("hex") };
}

async function fetchRaw(book) {
  const res = await fetch(rawUrl(book), {
    headers: { "user-agent": "Liber public-domain importer (https://liber.davirain.xyz)" },
  });
  if (!res.ok) throw new Error(`Wikisource raw fetch failed for ${book.sourceTitle}: HTTP ${res.status}`);
  return await res.text();
}

async function probe(apiUrl, book) {
  const [bookRes, contentRes, searchRes] = await Promise.all([
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`),
    fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}/content/1`),
    fetch(`${apiUrl}/api/search?q=${encodeURIComponent(book.title)}`),
  ]);
  return {
    bookFound: bookRes.ok && Boolean((await bookRes.json()).book),
    contentFound: contentRes.ok && Boolean((await contentRes.json()).text),
    searchReturned: searchRes.ok && Array.isArray((await searchRes.json()).books),
  };
}

async function liveBookExists(apiUrl, book) {
  const res = await fetch(`${apiUrl}/api/books/${encodeURIComponent(book.id)}`);
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  return Boolean(body?.book);
}

async function importOne(book, options) {
  process.stderr.write(`[wikisource] ${book.id} fetch ${book.sourceTitle}...\n`);
  const raw = await fetchRaw(book);
  const chapters = parseWikisourceChapters(book, raw);
  const { epubPath } = await writeEpub(book, chapters);
  const info = await inspectEpub(epubPath);
  const license = await verifyPublishLicense(info, { source: sourceUrl(book), license: "PUBLIC-DOMAIN", evidence: book.evidence });
  const manifest = await createBookManifest(epubPath, { source: sourceUrl(book), license: "PUBLIC-DOMAIN", evidence: book.evidence });
  const payload = await createIngestPayload(manifest, {
    ...book,
    sourceUrl: sourceUrl(book),
    sourceTextUrl: rawUrl(book),
    license: "PUBLIC-DOMAIN",
    chapters,
  });

  let publish = null;
  let live = null;
  if (options.publish) {
    process.stderr.write(`[wikisource] ${book.id} publish ${chapters.length} chapters...\n`);
    publish = await publishBookManifestChunked(manifest, {
      apiUrl: options.apiUrl,
      id: book.id,
      category: book.category,
      lang: book.lang,
      ingestPayload: payload,
      concurrency: options.chapterConcurrency,
      onProgress: (event) => {
        if (event.stage === "chapter") {
          process.stderr.write(`[wikisource] ${book.id} chapter ${event.current}/${event.total}: ${event.chapter.title}\n`);
        } else {
          process.stderr.write(`[wikisource] ${book.id} ${event.stage}...\n`);
        }
      },
    });
    live = await probe(options.apiUrl, book);
  }

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    lang: book.lang,
    category: book.category,
    source: sourceUrl(book),
    raw: rawUrl(book),
    sha256: info.sha256,
    license: license.license,
    accepted: license.accepted,
    chapters: chapters.length,
    sampleTitles: chapters.slice(0, 6).map((chapter) => chapter.title),
    published: Boolean(publish),
    live,
  };
}

function summarizeOutput(output) {
  const failures = [];
  const byLang = {};
  const results = output.results.map((result) => {
    byLang[result.lang || "unknown"] = (byLang[result.lang || "unknown"] || 0) + 1;
    if (result.error || !result.accepted) {
      failures.push({ id: result.id, title: result.title, error: result.error || "not accepted" });
    }
    return {
      id: result.id,
      title: result.title,
      lang: result.lang,
      category: result.category,
      accepted: Boolean(result.accepted),
      license: result.license || null,
      chapters: result.chapters || 0,
      published: Boolean(result.published),
      skipped: Boolean(result.skipped),
      live: result.live || null,
      error: result.error || null,
    };
  });
  return {
    mode: output.mode,
    apiUrl: output.apiUrl,
    total: output.results.length,
    accepted: output.results.filter((result) => result.accepted).length,
    failed: failures.length,
    published: output.results.filter((result) => result.published).length,
    skipped: output.results.filter((result) => result.skipped).length,
    byLang,
    failures,
    results,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const ids = options.ids || BOOKS.map((book) => book.id);
  const selected = BOOKS.filter((book) => ids.includes(book.id));
  if (!selected.length) throw new Error(`No matching Wikisource books for --ids ${ids.join(",")}`);
  const bookConcurrency = importBookConcurrency(options);
  process.stderr.write(`[wikisource] selected ${selected.length} Chinese books; book concurrency ${bookConcurrency}${options.publish ? `; chapter concurrency ${options.chapterConcurrency}` : ""}\n`);
  const results = await mapWithConcurrency(selected, bookConcurrency, async (book) => {
    try {
      if (options.publish && options.skipExisting && await liveBookExists(options.apiUrl, book)) {
        process.stderr.write(`[wikisource] ${book.id} exists; skip\n`);
        return {
          id: book.id,
          title: book.title,
          lang: book.lang,
          category: book.category,
          accepted: true,
          skipped: true,
        };
      }
      return await importOne(book, options);
    } catch (error) {
      if (!options.continueOnError) throw error;
      process.stderr.write(`[wikisource] ${book.id} failed: ${error.message}\n`);
      return {
        id: book.id,
        title: book.title,
        lang: book.lang,
        category: book.category,
        accepted: false,
        error: error.message,
      };
    }
  });
  const output = { mode: options.publish ? "publish" : "dry-run", apiUrl: options.apiUrl, results };
  const body = options.summary ? summarizeOutput(output) : output;
  process.stdout.write(options.json ? `${JSON.stringify(body, null, 2)}\n` : `${results.map((r) => `${r.id}: ${r.title}`).join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  BOOKS,
  cleanWikisourceWikitext,
  extractWikisourceBody,
  importBookConcurrency,
  main,
  parseArgs,
  parseWikisourceChapters,
  rawUrl,
  sourceUrl,
  summarizeOutput,
};
