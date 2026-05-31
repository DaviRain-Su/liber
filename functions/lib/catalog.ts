import type { Env } from "./types";
import { all, first, run, id, now } from "./db";
import { putBlob, getBlob } from "./storage";
import { chain } from "./chains";
import * as S from "./seed";
import { assertPublishableLicense } from "./license";
import { enqueueSids } from "./graph/embed";

const COVER_CLASSES = ["ink", "cinnabar", "cream", "indigo", "jade", "slate"];

export interface IngestChapterInput {
  n?: number;
  title?: string;
  text?: string;
  paras?: Array<Array<{ t?: string; text?: string }>>;
}

export interface IngestBookInput {
  id?: string;
  title: string;
  subtitle?: string;
  author?: string;
  category?: string;
  lang?: string;
  year?: string;
  blurb?: string;
  description?: string;
  license?: string;
  sourceUrl?: string;
  featured?: boolean;
  text?: string;
  chapters?: IngestChapterInput[];
  epubBase64?: string;
  epubSha256?: string;
  epubMediaType?: string;
}

export interface ChunkedIngestFinalizeInput extends IngestBookInput {
  chapterNumbers?: number[];
  words?: number;
}

function compact(s?: string | null): string {
  return (s || "").trim();
}

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string): Uint8Array {
  const raw = value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function safeId(raw: string | undefined, title: string): string {
  const base = compact(raw) || title;
  const slug = base
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || id("book_");
}

function sealFor(title: string): string {
  return [...(title || "书")][0] || "书";
}

function coverClassFor(bookId: string): string {
  let sum = 0;
  for (const ch of bookId) sum += ch.charCodeAt(0);
  return COVER_CLASSES[sum % COVER_CLASSES.length];
}

function wordsLabel(words: number): string {
  if (words <= 0) return "约 0 字";
  if (words >= 10000) return `约 ${(words / 10000).toFixed(words >= 100000 ? 0 : 1)} 万字`;
  return `约 ${words.toLocaleString("zh-CN")} 字`;
}

function isEnglishSentenceDot(text: string, i: number): boolean {
  if (text[i] !== ".") return false;
  const before = text.slice(Math.max(0, i - 18), i + 1);
  const after = text.slice(i + 1);
  if (/\d\.\d/.test(text.slice(Math.max(0, i - 1), i + 2))) return false;
  if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Capt|Col|Gen|St|Mt|No|Vol|Fig|cf|etc|vs)\.$/i.test(before)) return false;
  if (/\b(?:i\.e|e\.g|A\.D|B\.C|U\.S|U\.K)\.$/i.test(before)) return false;
  if (/\b[A-Z](?:\.[A-Z])+\.$/.test(before)) return false;
  if (/\b[A-Z]\.$/.test(before) && /^\s*[A-Z]\./.test(after)) return false;
  return /^\s*(?:["'”’)\]]+\s*)?(?:$|[A-Z0-9“"‘'\[(])/.test(after);
}

function splitSentences(para: string): string[] {
  const text = para.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const boundary = /[。！？!?；;]/.test(ch) || isEnglishSentenceDot(text, i);
    if (!boundary) continue;
    let end = i + 1;
    while (end < text.length && /["'”’)\]]/.test(text[end])) end += 1;
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.length ? out : [text];
}

function lineLooksHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 80) return false;
  if (/[\.\?!:;。！？；]$/.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function shouldReflowBlocks(blocks: string[]): boolean {
  if (blocks.length < 8) return false;
  const proseLines = blocks.filter((b) => b.length >= 35 && b.length <= 95).length;
  const unfinished = blocks.filter((b) => !/[\.\?!;:。！？；\]"”’)]$/.test(b)).length;
  return proseLines / blocks.length > 0.55 && unfinished / blocks.length > 0.35;
}

function joinWrappedLine(left: string, right: string): string {
  if (!left) return right;
  if (/-$/.test(left)) return left.slice(0, -1) + right;
  return `${left} ${right}`;
}

function reflowWrappedBlocks(blocks: string[]): string[] {
  const out: string[] = [];
  let acc = "";
  let prev = "";
  const flush = () => {
    if (acc.trim()) out.push(acc.replace(/\s+/g, " ").trim());
    acc = "";
    prev = "";
  };
  for (const block of blocks) {
    const line = block.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const startsStructure = /^\d+[\.\)]\s+/.test(line) || /^\[[^\]]/.test(line) || lineLooksHeading(line);
    const prevComplete = /[\.\?!。！？\]"”’)]$/.test(prev);
    if (acc && (startsStructure || prevComplete)) flush();
    if (lineLooksHeading(line)) {
      flush();
      out.push(line);
    } else {
      acc = joinWrappedLine(acc, line);
      prev = line;
    }
  }
  flush();
  return out;
}

function normalizeTextBlocks(text: string, title: string): string[] {
  const blocks = splitInlineChineseClassicSections(text, title)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").map((line) => line.replace(/[ \t\f\v]+/g, " ").trim()).filter(Boolean).join("\n"))
    .filter(Boolean);
  const normalizedTitle = title.replace(/\s+/g, " ").trim().toLowerCase();
  if (blocks[0]?.replace(/\s+/g, " ").trim().toLowerCase() === normalizedTitle) blocks.shift();
  const paras = shouldReflowBlocks(blocks) ? reflowWrappedBlocks(blocks) : blocks;
  return paras;
}

function splitInlineChineseClassicSections(text: string, title: string): string {
  const heading = title.replace(/\s+/g, "");
  if (!heading || heading.length > 24 || !/\p{Script=Han}/u.test(heading)) return text;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\s+(\\d{1,3}\\s+${escaped}\\s*[:：])`, "gu"), "\n\n$1")
    .replace(/\s+(\d{1,3}\.\s+[\p{Script=Han}]{1,8}\s*[:：])/gu, "\n\n$1")
    .trim();
}

export function textToChapter(bookId: string, n: number, title: string, text: string) {
  let sid = 1;
  const paras = normalizeTextBlocks(text, title || `第 ${n} 章`)
    .map((p) => splitSentences(p))
    .filter((p) => p.length)
    .map((p) => p.map((t) => ({ id: `${bookId}-c${n}-s${sid++}`, t })));
  return { n, title: title || `第 ${n} 章`, paras: paras.length ? paras : [[{ id: `${bookId}-c${n}-s1`, t: text.trim() }]] };
}

function chineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === "十") return 10;
  const ten = s.indexOf("十");
  if (ten >= 0) {
    const left = ten === 0 ? 1 : digits[s[ten - 1]];
    const right = ten === s.length - 1 ? 0 : digits[s[ten + 1]];
    return left * 10 + right;
  }
  return digits[s] ?? null;
}

export function parseTextChapters(text: string): IngestChapterInput[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chapters: IngestChapterInput[] = [];
  let current: { n: number; title: string; lines: string[] } = { n: 1, title: "正文", lines: [] };
  let sawHeading = false;
  const push = () => {
    const body = current.lines.join("\n").trim();
    if (body) chapters.push({ n: current.n, title: current.title, text: body });
  };
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(?:第\s*([一二两三四五六七八九十百〇零\d]+)\s*[章节回篇卷]|chapter\s+(\d+)|(\d+)[.、]\s+)(.*)$/i);
    if (m && (current.lines.length || !sawHeading)) {
      if (current.lines.length) push();
      sawHeading = true;
      const n = chineseNumber(m[1] || m[2] || m[3] || "") || chapters.length + 1;
      current = { n, title: (m[4] || `第 ${n} 章`).trim(), lines: [] };
    } else {
      current.lines.push(raw);
    }
  }
  push();
  if (chapters.length) return chapters;
  return [{ n: 1, title: "正文", text: text.trim() }];
}

function chapterText(ch: IngestChapterInput): string {
  if (typeof ch.text === "string") return ch.text.trim();
  if (Array.isArray(ch.paras)) return ch.paras.map((p) => p.map((s) => compact(s.t || s.text)).filter(Boolean).join("")).join("\n\n");
  return "";
}

function normalizeIngestChapter(ch: IngestChapterInput, idx: number) {
  const n = Number(ch.n || idx + 1) || idx + 1;
  return { n, title: compact(ch.title) || `第 ${n} 章`, text: chapterText(ch) };
}

function normalizeIngestMeta(input: IngestBookInput) {
  const title = compact(input.title);
  if (!title) throw new Error("书名不能为空");
  const license = assertPublishableLicense(input.license);
  return { title, license, bookId: safeId(input.id, title) };
}

async function storeEpubSource(env: Env, bookId: string, input: IngestBookInput) {
  if (!input.epubBase64) return null;
  const epubBytes = base64ToBytes(input.epubBase64);
  const actualHash = await sha256Hex(epubBytes);
  if (input.epubSha256 && actualHash !== input.epubSha256.toLowerCase()) {
    throw new Error("EPUB 哈希与 manifest 不一致");
  }
  return putBlob(env, `book/${bookId}/source.epub`, epubBytes, input.epubMediaType || "application/epub+zip");
}

async function storedBlobRef(env: Env, key: string) {
  return first<any>(
    env.DB,
    `SELECT key, walrus, arweave, sui_index, size, content_type FROM blobs WHERE key = ?`,
    key,
  );
}

async function storeChapter(env: Env, bookId: string, ch: { n: number; title: string; text: string }) {
  if (!ch.text) throw new Error("章节正文为空");
  await env.R2.delete(`book/${bookId}/reader.epub`).catch(() => {});
  const ref = await putBlob(env, `book/${bookId}/ch/${ch.n}`, ch.text, "text/plain; charset=utf-8");
  await run(
    env.DB,
    `INSERT INTO library_chapters (book_id, n, title, blob_key, walrus, arweave, sui_index, text_preview, text_size, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(book_id, n) DO UPDATE SET
       title = excluded.title, blob_key = excluded.blob_key, walrus = excluded.walrus,
       arweave = excluded.arweave, sui_index = excluded.sui_index, text_preview = excluded.text_preview,
       text_size = excluded.text_size, created_at = excluded.created_at`,
    bookId, ch.n, ch.title, ref.key, ref.walrus, ref.arweave, ref.sui_index,
    ch.text.slice(0, 5000), ch.text.length, now(),
  );
  // feed the knowledge graph: enqueue this chapter's sentences (inline text, so
  // the consumer needn't re-load). No-op unless GRAPH_ENABLED + queue bound.
  const parsed = textToChapter(bookId, ch.n, ch.title, ch.text);
  const texts: Record<string, string> = {};
  for (const para of parsed.paras) for (const s of para) texts[s.id] = s.t;
  const sids = Object.keys(texts);
  if (sids.length) await enqueueSids(env, sids, texts);
  return { ...ch, ref };
}

async function deleteStaleChapters(env: Env, bookId: string, keepNumbers: number[]) {
  const requestedNumbers = [...new Set(keepNumbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!requestedNumbers.length) return;
  const keep = new Set(requestedNumbers);
  const existing = await all<any>(env.DB, `SELECT n FROM library_chapters WHERE book_id = ?`, bookId);
  const stale = existing.map((r) => Number(r.n)).filter((n) => !keep.has(n));
  for (let i = 0; i < stale.length; i += 80) {
    const batch = stale.slice(i, i + 80);
    await run(
      env.DB,
      `DELETE FROM library_chapters WHERE book_id = ? AND n IN (${batch.map(() => "?").join(",")})`,
      bookId, ...batch,
    );
  }
  if (stale.length) await env.R2.delete(`book/${bookId}/reader.epub`).catch(() => {});
}

async function finalizeStoredBook(
  env: Env,
  input: ChunkedIngestFinalizeInput,
  meta: { title: string; license: string; bookId: string },
  createdBy?: string | null,
) {
  await deleteStaleChapters(env, meta.bookId, input.chapterNumbers || []);

  const rows = await all<any>(
    env.DB,
    `SELECT n, title, blob_key, walrus, arweave, sui_index, text_size
     FROM library_chapters WHERE book_id = ? ORDER BY n`,
    meta.bookId,
  );
  if (!rows.length) throw new Error("正文为空");

  const epubRef = await storedBlobRef(env, `book/${meta.bookId}/source.epub`);
  const manifest = {
    id: meta.bookId,
    title: meta.title,
    author: compact(input.author) || "佚名",
    license: meta.license,
    sourceUrl: input.sourceUrl || null,
    epub: epubRef ? {
      key: epubRef.key,
      walrus: epubRef.walrus,
      arweave: epubRef.arweave,
      sui_index: epubRef.sui_index,
      size: epubRef.size,
      sha256: input.epubSha256 || null,
      mediaType: epubRef.content_type,
    } : input.epubSha256 ? {
      sha256: input.epubSha256,
      mediaType: input.epubMediaType || "application/epub+zip",
    } : null,
    chapters: rows.map((r) => ({ n: Number(r.n), title: r.title, walrus: r.walrus, size: Number(r.text_size || 0) })),
  };
  const manifestRef = await putBlob(env, `book/${meta.bookId}/manifest`, JSON.stringify(manifest), "application/json");
  const chainRef = await chain(env).registerObject(env, { contentId: manifestRef.walrus, kind: "book", license: meta.license });
  const suiIndex = chainRef?.objectId || chainRef?.digest || manifestRef.sui_index;
  if (chainRef) await run(env.DB, `UPDATE blobs SET sui_index = ? WHERE key = ?`, suiIndex, manifestRef.key);

  const words = Number(input.words) || rows.reduce((sum, r) => sum + Number(r.text_size || 0), 0);
  await run(
    env.DB,
    `INSERT INTO library_books
      (id, title, subtitle, author, category, lang, year, pages, words, cover_class, seal,
       blurb, description, license, source_url, featured, manifest_key, walrus, arweave,
       sui_index, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, author = excluded.author,
       category = excluded.category, lang = excluded.lang, year = excluded.year,
       pages = excluded.pages, words = excluded.words, cover_class = excluded.cover_class,
       seal = excluded.seal, blurb = excluded.blurb, description = excluded.description,
       license = excluded.license, source_url = excluded.source_url, featured = excluded.featured,
       manifest_key = excluded.manifest_key, walrus = excluded.walrus, arweave = excluded.arweave,
       sui_index = excluded.sui_index, updated_at = excluded.updated_at`,
    meta.bookId, meta.title, input.subtitle || "", input.author || "佚名", input.category || "文学 · 诗",
    input.lang || "中文", input.year || "", rows.length, words, coverClassFor(meta.bookId), meta.title[0] || "书",
    input.blurb || rows[0]?.text_preview?.slice(0, 90) || "", input.description || "", meta.license,
    input.sourceUrl || null, input.featured ? 1 : 0, manifestRef.key, manifestRef.walrus, manifestRef.arweave,
    suiIndex, createdBy || null, now(), now(),
  );

  return { book: await getBook(env, meta.bookId), manifest: manifestRef, epub: epubRef, chapters: rows.length, sui: chainRef };
}

export function normalizeBook(row: any) {
  const readsN = Number(row.readsN ?? row.reads ?? 0) || 0;
  const liners = Number(row.liners ?? 0) || 0;
  const pages = Number(row.pages ?? 0) || 0;
  const words = Number(row.words_count ?? row.words ?? 0) || 0;
  return {
    id: row.id,
    t: row.title ?? row.t,
    sub: row.subtitle ?? row.sub ?? "",
    a: row.author ?? row.a ?? "佚名",
    cls: row.cover_class ?? row.cls ?? coverClassFor(row.id),
    seal: row.seal ?? sealFor(row.title ?? row.t),
    cat: row.category ?? row.cat ?? "文学 · 诗",
    lang: row.lang ?? "中文",
    year: row.year ?? "",
    pages,
    words: typeof row.words === "string" ? row.words : wordsLabel(words),
    reads: readsN.toLocaleString("zh-CN"),
    readsN,
    lines: liners.toLocaleString("zh-CN"),
    liners,
    annos: Number(row.annos ?? 0) || 0,
    blob: row.walrus ?? row.blob ?? "",
    backup: row.arweave ?? row.backup ?? "",
    index: row.sui_index ?? row.index ?? "",
    blurb: row.blurb ?? "",
    long: row.description ?? row.long ?? "",
    featured: !!row.featured,
    dynamic: row.dynamic ?? true,
    createdAt: Number(row.created_at ?? row.createdAt ?? 0) || 0,
    license: row.license ?? "CC0-1.0",
    sourceUrl: row.source_url ?? row.sourceUrl ?? "",
    hasEpub: Boolean(
      row.id
      || row.has_epub
      || row.hasEpub
      || /^https:\/\/www\.gutenberg\.org\/ebooks\/\d+$/i.test(row.source_url ?? row.sourceUrl ?? "")
      || /^https:\/\/.+\.epub(?:\?.*)?$/i.test(row.source_url ?? row.sourceUrl ?? ""),
    ),
  };
}

export async function hasLibraryBooks(env: Env) {
  const row = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM library_books`);
  return Number(row?.n || 0) > 0;
}

function scopedCategory(cat?: string) {
  const value = compact(cat);
  return value && !value.startsWith("全部") ? value : "";
}

export async function countBooks(env: Env, opts: { cat?: string } = {}) {
  const cat = scopedCategory(opts.cat);
  const row = cat
    ? await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM library_books WHERE category = ?`, cat)
    : await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM library_books`);
  const total = Number(row?.n || 0);
  if (total > 0) return total;
  const seed = S.BOOKS.map((b) => ({ ...b, dynamic: false }));
  return cat ? seed.filter((b) => b.cat === cat).length : seed.length;
}

export async function listBooks(env: Env, opts: { cat?: string; sort?: string; limit?: number } = {}) {
  const cat = scopedCategory(opts.cat);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 1000, 2000));
  // Sort in SQL on real metrics so the ranking is correct even with a LIMIT.
  // readsN = distinct readers (progress), liners = total highlights.
  const sort = opts.sort || "reads";
  const order =
    sort === "lines" || sort === "划线最多" ? "liners DESC, lb.created_at DESC"
      : sort === "recent" || sort === "new" || sort === "最近上链" ? "lb.created_at DESC"
        : "readsN DESC, lb.created_at DESC";
  const sql = `SELECT lb.id, lb.title, lb.subtitle, lb.author, lb.category, lb.lang, lb.year, lb.pages,
                      lb.words AS words_count, lb.cover_class, lb.seal, lb.blurb, lb.description,
                      lb.featured, lb.walrus, lb.arweave, lb.sui_index, lb.license, lb.source_url,
                      lb.created_at,
                      COALESCE(p.readers, 0) AS readsN,
                      COALESCE(h.lines_n, 0) AS liners
               FROM library_books lb
               LEFT JOIN (SELECT book_id, COUNT(DISTINCT user_id) AS readers FROM progress GROUP BY book_id) p ON p.book_id = lb.id
               LEFT JOIN (SELECT book_id, COUNT(*) AS lines_n FROM highlights GROUP BY book_id) h ON h.book_id = lb.id
               ${cat ? "WHERE lb.category = ?" : ""}
               ORDER BY ${order}
               LIMIT ?`;
  const rows = await all<any>(env.DB, sql, ...(cat ? [cat, limit] : [limit]));
  const dynamic = rows.map(normalizeBook);
  if (dynamic.length) return dynamic;
  // seed fallback (no live catalog yet)
  let list = S.BOOKS.map((b) => ({ ...b, dynamic: false }));
  if (cat) list = list.filter((b) => b.cat === cat);
  if (sort === "lines" || sort === "划线最多") list = [...list].sort((a, b) => (b.liners || 0) - (a.liners || 0));
  else if (!(sort === "recent" || sort === "new" || sort === "最近上链")) list = [...list].sort((a, b) => (b.readsN || 0) - (a.readsN || 0));
  return list;
}

export async function getBook(env: Env, bookId: string) {
  const row = await first<any>(
    env.DB,
    `SELECT id, title, subtitle, author, category, lang, year, pages, words AS words_count,
            cover_class, seal, blurb, description, featured, walrus, arweave, sui_index,
            license, source_url, created_at
     FROM library_books WHERE id = ?`,
    bookId,
  );
  if (row) return normalizeBook(row);
  if (await hasLibraryBooks(env)) return null;
  const seed = S.bookById(bookId);
  return seed ? { ...seed, dynamic: false } : null;
}

export async function getToc(env: Env, bookId: string) {
  const rows = await all<any>(env.DB, `SELECT n, title FROM library_chapters WHERE book_id = ? ORDER BY n ASC`, bookId);
  if (rows.length) return rows.map((r) => ({ n: r.n, title: r.title, has: true }));
  if (await hasLibraryBooks(env)) return [];
  return S.BOOK_CONTENT[bookId]?.toc || [];
}

export async function getChapters(env: Env, bookId: string) {
  const rows = await all<any>(env.DB, `SELECT n, title, blob_key, text_preview FROM library_chapters WHERE book_id = ? ORDER BY n ASC`, bookId);
  if (!rows.length) return !(await hasLibraryBooks(env)) ? (S.BOOK_CONTENT[bookId]?.chapters || []) : [];
  const chapters: Array<{ n: number; title: string; paras: Array<Array<{ id: string; t: string }>> }> = [];
  for (const r of rows) {
    const buf = await getBlob(env, r.blob_key);
    const text = buf ? new TextDecoder().decode(buf) : r.text_preview;
    chapters.push(textToChapter(bookId, r.n, r.title, text));
  }
  return chapters;
}

export async function getChapterText(env: Env, bookId: string, n: number) {
  const row = await first<any>(env.DB, `SELECT title, blob_key, text_preview FROM library_chapters WHERE book_id = ? AND n = ?`, bookId, n);
  if (row) {
    const buf = await getBlob(env, row.blob_key);
    return { source: "library", n, title: row.title, text: buf ? new TextDecoder().decode(buf) : row.text_preview };
  }
  if (await hasLibraryBooks(env)) return null;
  const seedChapters = S.BOOK_CONTENT[bookId]?.chapters;
  if (seedChapters) {
    const ch = seedChapters.find((x: any) => x.n === n);
    if (ch) return { source: "seed", n, title: ch.title, text: ch.paras.flat().map((s: any) => s.t).join("\n") };
  }
  return null;
}

function xmlEscape(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xhtmlParagraph(block: string): string {
  const raw = String(block || "").trim();
  const html = raw.split("\n").map((line) => xmlEscape(line.trim())).filter(Boolean).join("<br/>");
  const klass = /^\d{1,3}[.、]\s+.{1,16}\s*[:：]\s*(?:原錯|原错|舊脫|旧脱|刪除|删除|自|由|孫|孙|清|吳|吴|王校)/u.test(raw)
    ? ` class="footnote"`
    : "";
  return html ? `<p${klass}>${html}</p>` : "";
}

function chapterXhtml(bookTitle: string, lang: string, ch: { n: number; title: string; text: string }): string {
  const blocks = normalizeTextBlocks(ch.text, ch.title || `第 ${ch.n} 章`);
  const body = blocks.map(xhtmlParagraph).filter(Boolean).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head>
  <title>${xmlEscape(ch.title || bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h1>${xmlEscape(ch.title || `第 ${ch.n} 章`)}</h1>
    ${body || `<p>${xmlEscape(ch.text || "")}</p>`}
  </section>
</body>
</html>`;
}

function readerEpubFiles(book: { id: string; title: string; author: string; lang: string }, chapters: Array<{ n: number; title: string; text: string }>) {
  const id = `liber-${book.id}`;
  const title = xmlEscape(book.title);
  const author = xmlEscape(book.author || "佚名");
  const lang = xmlEscape(book.lang || "zh");
  const chapterItems = chapters.map((ch, i) => ({ id: `c${i + 1}`, href: `chapter-${ch.n}.xhtml`, ch }));
  const manifestItems = chapterItems.map((item) =>
    `    <item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`,
  ).join("\n");
  const spineItems = chapterItems.map((item) => `    <itemref idref="${item.id}"/>`).join("\n");
  const navItems = chapterItems.map((item) =>
    `      <li><a href="${item.href}">${xmlEscape(item.ch.title || `第 ${item.ch.n} 章`)}</a></li>`,
  ).join("\n");
  const ncxItems = chapterItems.map((item, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(item.ch.title || `第 ${item.ch.n} 章`)}</text></navLabel>
      <content src="${item.href}"/>
    </navPoint>`).join("\n");

  return [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>` },
    { name: "OEBPS/styles.css", data: `body {
  color: #2d261f;
  font-family: "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif;
  line-height: 1.85;
  margin: 0;
  padding: 2rem 8%;
}
h1 {
  font-size: 1.45rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0 0 1.6rem;
  text-align: center;
}
p {
  margin: 0 0 1em;
  text-indent: 2em;
}
p.footnote {
  border-left: 2px solid #d7c8ad;
  color: #6d6255;
  font-size: .86em;
  padding-left: .8em;
  text-indent: 0;
}` },
    { name: "OEBPS/nav.xhtml", data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${title}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>` },
    { name: "OEBPS/toc.ncx", data: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(id)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${ncxItems}
  </navMap>
</ncx>` },
    { name: "OEBPS/content.opf", data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${xmlEscape(id)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2026-05-31T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>` },
    ...chapterItems.map((item) => ({
      name: `OEBPS/${item.href}`,
      data: chapterXhtml(book.title, lang, item.ch),
    })),
  ];
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function zipStore(files: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (5 << 5) | 31;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.byteLength);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, dosTime, true);
    l.setUint16(12, dosDate, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.byteLength, true);
    l.setUint32(22, data.byteLength, true);
    l.setUint16(26, name.byteLength, true);
    l.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.byteLength);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.byteLength, true);
    c.setUint32(24, data.byteLength, true);
    c.setUint16(28, name.byteLength, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, 0, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  const central = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, central.byteLength, true);
  e.setUint32(16, centralOffset, true);
  e.setUint16(20, 0, true);
  return concatBytes([...localParts, central, end]);
}

export async function getReaderEpub(env: Env, bookId: string): Promise<Uint8Array | null> {
  const cacheKey = `book/${bookId}/reader.epub`;
  const cached = await env.R2.get(cacheKey);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const book = await getBook(env, bookId);
  if (!book) return null;
  const rows = await all<any>(
    env.DB,
    `SELECT n, title, blob_key, text_preview FROM library_chapters WHERE book_id = ? ORDER BY n ASC`,
    bookId,
  );
  if (!rows.length) return null;
  const chapters = (await Promise.all(rows.map(async (row) => {
    const buf = await getBlob(env, row.blob_key);
    const text = (buf ? new TextDecoder().decode(buf) : row.text_preview || "").trim();
    return text ? { n: Number(row.n), title: row.title || `第 ${row.n} 章`, text } : null;
  }))).filter(Boolean) as Array<{ n: number; title: string; text: string }>;
  if (!chapters.length) return null;
  const epub = zipStore(readerEpubFiles({
    id: book.id,
    title: book.t || bookId,
    author: book.a || "佚名",
    lang: book.lang || "zh",
  }, chapters));
  await env.R2.put(cacheKey, epub, { httpMetadata: { contentType: "application/epub+zip" } }).catch(() => {});
  return epub;
}

export async function searchDynamic(env: Env, term: string) {
  if (!term) return { books: [], sentences: [] };
  const like = `%${term}%`;
  const rows = await all<any>(
    env.DB,
    `SELECT id, title, subtitle, author, category, lang, year, pages, words AS words_count,
            cover_class, seal, blurb, description, featured, walrus, arweave, sui_index,
            license, source_url, created_at
     FROM library_books
     WHERE title LIKE ? OR subtitle LIKE ? OR author LIKE ? OR category LIKE ? OR blurb LIKE ?
     ORDER BY created_at DESC LIMIT 20`,
    like, like, like, like, like,
  );
  const hitRows = await all<any>(
    env.DB,
    `SELECT lc.book_id, lb.title AS book_title, lc.n, lc.title, lc.text_preview
     FROM library_chapters lc JOIN library_books lb ON lb.id = lc.book_id
     WHERE lc.title LIKE ? OR lc.text_preview LIKE ? ORDER BY lc.book_id, lc.n LIMIT 20`,
    like, like,
  );
  const sentences = hitRows.flatMap((r) => {
    const pieces = splitSentences(r.text_preview).filter((s) => s.includes(term)).slice(0, 2);
    return pieces.map((t, i) => ({ sid: `${r.book_id}-c${r.n}-s${i + 1}`, t, book: r.book_title, bookId: r.book_id, chap: `第${r.n}章` }));
  });
  return { books: rows.map(normalizeBook), sentences };
}

export async function ingestBook(env: Env, input: IngestBookInput, createdBy?: string | null) {
  const meta = normalizeIngestMeta(input);
  const chapters = (input.chapters?.length ? input.chapters : parseTextChapters(input.text || ""))
    .map(normalizeIngestChapter)
    .filter((ch) => ch.text);
  if (!chapters.length) throw new Error("正文为空");

  const words = chapters.reduce((sum, ch) => sum + ch.text.replace(/\s+/g, "").length, 0);
  const epubRef = await storeEpubSource(env, meta.bookId, input);

  const refs: Array<{ n: number; title: string; text: string; ref: any }> = [];
  for (const ch of chapters) {
    refs.push(await storeChapter(env, meta.bookId, ch));
  }
  const chapterNumbers = [...new Set(refs.map((r) => r.n))];
  await deleteStaleChapters(env, meta.bookId, chapterNumbers);

  const manifest = {
    id: meta.bookId,
    title: meta.title,
    author: compact(input.author) || "佚名",
    license: meta.license,
    sourceUrl: input.sourceUrl || null,
    epub: epubRef ? {
      key: epubRef.key,
      walrus: epubRef.walrus,
      arweave: epubRef.arweave,
      sui_index: epubRef.sui_index,
      size: epubRef.size,
      sha256: input.epubSha256 || null,
      mediaType: epubRef.content_type,
    } : input.epubSha256 ? {
      sha256: input.epubSha256,
      mediaType: input.epubMediaType || "application/epub+zip",
    } : null,
    chapters: refs.map((r) => ({ n: r.n, title: r.title, walrus: r.ref.walrus, size: r.ref.size })),
  };
  const manifestRef = await putBlob(env, `book/${meta.bookId}/manifest`, JSON.stringify(manifest), "application/json");
  const chainRef = await chain(env).registerObject(env, { contentId: manifestRef.walrus, kind: "book", license: meta.license });
  const suiIndex = chainRef?.objectId || chainRef?.digest || manifestRef.sui_index;
  if (chainRef) await run(env.DB, `UPDATE blobs SET sui_index = ? WHERE key = ?`, suiIndex, manifestRef.key);

  await run(
    env.DB,
    `INSERT INTO library_books
      (id, title, subtitle, author, category, lang, year, pages, words, cover_class, seal,
       blurb, description, license, source_url, featured, manifest_key, walrus, arweave,
       sui_index, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, author = excluded.author,
       category = excluded.category, lang = excluded.lang, year = excluded.year,
       pages = excluded.pages, words = excluded.words, cover_class = excluded.cover_class,
       seal = excluded.seal, blurb = excluded.blurb, description = excluded.description,
       license = excluded.license, source_url = excluded.source_url, featured = excluded.featured,
       manifest_key = excluded.manifest_key, walrus = excluded.walrus, arweave = excluded.arweave,
       sui_index = excluded.sui_index, updated_at = excluded.updated_at`,
    meta.bookId, meta.title, input.subtitle || "", input.author || "佚名", input.category || "文学 · 诗",
    input.lang || "中文", input.year || "", chapters.length, words, coverClassFor(meta.bookId), meta.title[0] || "书",
    input.blurb || chapters[0].text.slice(0, 90), input.description || "", meta.license,
    input.sourceUrl || null, input.featured ? 1 : 0, manifestRef.key, manifestRef.walrus, manifestRef.arweave,
    suiIndex, createdBy || null, now(), now(),
  );

  return { book: await getBook(env, meta.bookId), manifest: manifestRef, epub: epubRef, chapters: refs.length, sui: chainRef };
}

export async function beginChunkedBookIngest(env: Env, input: IngestBookInput) {
  const meta = normalizeIngestMeta(input);
  const epub = await storeEpubSource(env, meta.bookId, input);
  return { id: meta.bookId, title: meta.title, license: meta.license, epub };
}

export async function ingestBookChapter(env: Env, input: IngestBookInput, chapter: IngestChapterInput, idx = 0) {
  const meta = normalizeIngestMeta(input);
  const normalized = normalizeIngestChapter(chapter, idx);
  return storeChapter(env, meta.bookId, normalized);
}

export async function finalizeChunkedBookIngest(env: Env, input: ChunkedIngestFinalizeInput, createdBy?: string | null) {
  const meta = normalizeIngestMeta(input);
  return finalizeStoredBook(env, input, meta, createdBy);
}
