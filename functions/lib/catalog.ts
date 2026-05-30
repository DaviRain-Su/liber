import type { Env } from "./types";
import { all, first, run, id, now } from "./db";
import { putBlob, getBlob } from "./storage";
import { chain } from "./chains";
import * as S from "./seed";
import { assertPublishableLicense } from "./license";

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

function splitSentences(para: string): string[] {
  const text = para.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const parts = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function textToChapter(bookId: string, n: number, title: string, text: string) {
  let sid = 1;
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
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

function normalizeBook(row: any) {
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
    license: row.license ?? "CC0-1.0",
  };
}

export async function listBooks(env: Env, opts: { cat?: string; sort?: string } = {}) {
  const rows = await all<any>(
    env.DB,
    `SELECT id, title, subtitle, author, category, lang, year, pages, words AS words_count,
            cover_class, seal, blurb, description, featured, walrus, arweave, sui_index,
            license, created_at
     FROM library_books ORDER BY created_at DESC LIMIT 200`,
  );
  const dynamic = rows.map(normalizeBook);
  const dynamicIds = new Set(dynamic.map((b) => b.id));
  let list = [...dynamic, ...S.BOOKS.filter((b) => !dynamicIds.has(b.id)).map((b) => ({ ...b, dynamic: false }))];
  if (opts.cat && !opts.cat.startsWith("全部")) list = list.filter((b) => b.cat === opts.cat);
  if (opts.sort === "lines") list = [...list].sort((a, b) => b.liners - a.liners);
  else list = [...list].sort((a, b) => b.readsN - a.readsN);
  return list;
}

export async function getBook(env: Env, bookId: string) {
  const row = await first<any>(
    env.DB,
    `SELECT id, title, subtitle, author, category, lang, year, pages, words AS words_count,
            cover_class, seal, blurb, description, featured, walrus, arweave, sui_index,
            license, created_at
     FROM library_books WHERE id = ?`,
    bookId,
  );
  if (row) return normalizeBook(row);
  const seed = S.bookById(bookId);
  return seed ? { ...seed, dynamic: false } : null;
}

export async function getToc(env: Env, bookId: string) {
  const rows = await all<any>(env.DB, `SELECT n, title FROM library_chapters WHERE book_id = ? ORDER BY n ASC`, bookId);
  if (rows.length) return rows.map((r) => ({ n: r.n, title: r.title, has: true }));
  const seed = S.bookById(bookId);
  return seed?.id === "daodejing" ? S.TOC : [];
}

export async function getChapters(env: Env, bookId: string) {
  const rows = await all<any>(env.DB, `SELECT n, title, blob_key, text_preview FROM library_chapters WHERE book_id = ? ORDER BY n ASC`, bookId);
  if (!rows.length) return bookId === "daodejing" ? S.CHAPTERS : [];
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
  if (bookId === "daodejing") {
    const ch = S.CHAPTERS.find((x: any) => x.n === n);
    if (ch) return { source: "seed", n, title: ch.title, text: ch.paras.flat().map((s: any) => s.t).join("\n") };
  }
  return null;
}

export async function searchDynamic(env: Env, term: string) {
  if (!term) return { books: [], sentences: [] };
  const like = `%${term}%`;
  const rows = await all<any>(
    env.DB,
    `SELECT id, title, subtitle, author, category, lang, year, pages, words AS words_count,
            cover_class, seal, blurb, description, featured, walrus, arweave, sui_index,
            license, created_at
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
  const title = compact(input.title);
  if (!title) throw new Error("书名不能为空");
  const license = assertPublishableLicense(input.license);
  const bookId = safeId(input.id, title);
  const chapters = (input.chapters?.length ? input.chapters : parseTextChapters(input.text || ""))
    .map((ch, idx) => ({ n: ch.n || idx + 1, title: compact(ch.title) || `第 ${ch.n || idx + 1} 章`, text: chapterText(ch) }))
    .filter((ch) => ch.text);
  if (!chapters.length) throw new Error("正文为空");

  const words = chapters.reduce((sum, ch) => sum + ch.text.replace(/\s+/g, "").length, 0);
  let epubRef: any = null;
  if (input.epubBase64) {
    const epubBytes = base64ToBytes(input.epubBase64);
    const actualHash = await sha256Hex(epubBytes);
    if (input.epubSha256 && actualHash !== input.epubSha256.toLowerCase()) {
      throw new Error("EPUB 哈希与 manifest 不一致");
    }
    epubRef = await putBlob(env, `book/${bookId}/source.epub`, epubBytes, input.epubMediaType || "application/epub+zip");
  }

  const refs: Array<{ n: number; title: string; text: string; ref: any }> = [];
  for (const ch of chapters) {
    const ref = await putBlob(env, `book/${bookId}/ch/${ch.n}`, ch.text, "text/plain; charset=utf-8");
    refs.push({ ...ch, ref });
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
  }
  const chapterNumbers = [...new Set(refs.map((r) => r.n))];
  if (chapterNumbers.length) {
    await run(
      env.DB,
      `DELETE FROM library_chapters WHERE book_id = ? AND n NOT IN (${chapterNumbers.map(() => "?").join(",")})`,
      bookId, ...chapterNumbers,
    );
  }

  const manifest = {
    id: bookId,
    title,
    author: compact(input.author) || "佚名",
    license,
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
  const manifestRef = await putBlob(env, `book/${bookId}/manifest`, JSON.stringify(manifest), "application/json");
  const chainRef = await chain(env).registerObject(env, { contentId: manifestRef.walrus, kind: "book", license });
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
    bookId, title, input.subtitle || "", input.author || "佚名", input.category || "文学 · 诗",
    input.lang || "中文", input.year || "", chapters.length, words, coverClassFor(bookId), input.title[0] || "书",
    input.blurb || chapters[0].text.slice(0, 90), input.description || "", license,
    input.sourceUrl || null, input.featured ? 1 : 0, manifestRef.key, manifestRef.walrus, manifestRef.arweave,
    suiIndex, createdBy || null, now(), now(),
  );

  return { book: await getBook(env, bookId), manifest: manifestRef, epub: epubRef, chapters: refs.length, sui: chainRef };
}
