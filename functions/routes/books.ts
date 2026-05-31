import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import * as S from "../lib/seed";
import { chain } from "../lib/chains";
import { getBlob, putBlob } from "../lib/storage";
import {
  beginChunkedBookIngest,
  finalizeChunkedBookIngest,
  countBooks,
  getBook,
  getChapters,
  getChapterText,
  getReaderEpub,
  getToc,
  hasLibraryBooks,
  ingestBook,
  ingestBookChapter,
  listBooks,
  searchDynamic,
  textToChapter,
} from "../lib/catalog";
import { bearerToken, getCliPublishToken, hasAdminToken } from "../lib/auth";

const books = new Hono<{ Bindings: Env; Variables: Variables }>();

// Book publishing: ADMIN_TOKEN (constant-time) or any valid CLI publish token.
async function ingestAuth(c: any): Promise<{ ok: boolean; userId?: string | null }> {
  const token = bearerToken(c);
  if (hasAdminToken(c.env, token)) return { ok: true, userId: c.get("userId") };
  const cli = await getCliPublishToken(c.env, token);
  if (cli) return { ok: true, userId: cli.userId };
  return { ok: false };
}

// SSRF guard for the optional server-side fetch of `sourceUrl` in /books/ingest:
// https only, a small public-domain host allowlist (extend via INGEST_HOSTS),
// and explicit rejection of loopback/private hosts and IP literals.
const INGEST_HOST_ALLOW = [/(^|\.)gutenberg\.org$/i, /(^|\.)gutenberg\.net$/i, /(^|\.)archive\.org$/i, /(^|\.)wikisource\.org$/i];
function isAllowedIngestUrl(raw: string | undefined, env: Env): boolean {
  if (!raw) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
    host.includes(":") || host.startsWith("[") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) return false;
  const extra = (env.INGEST_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(host)) return true;
  return INGEST_HOST_ALLOW.some((re) => re.test(host));
}

books.get("/books", async (c) => {
  const cat = c.req.query("cat");
  const sort = c.req.query("sort") || "reads";
  const rawLimit = Number(c.req.query("limit") || 1000);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 1000;
  const [list, total] = await Promise.all([
    listBooks(c.env, { cat, sort, limit }),
    countBooks(c.env, { cat }),
  ]);
  return c.json({ books: list, total });
});

books.get("/books/:id", async (c) => {
  const b = await getBook(c.env, c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const toc = await getToc(c.env, b.id);
  const hasSeed = b.id === "daodejing";
  return c.json({ book: b, toc: toc.length ? toc : null, highlights: hasSeed ? S.HIGHLIGHTS : null, reviews: hasSeed ? S.REVIEWS : null });
});

books.get("/books/:id/chapters", async (c) => {
  const b = await getBook(c.env, c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const chapters = await getChapters(c.env, b.id);
  const toc = await getToc(c.env, b.id);
  return c.json({ chapters, toc });
});

books.get("/books/:id/reader.epub", async (c) => {
  const bookId = c.req.param("id");
  const b = await getBook(c.env, bookId);
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const bytes = await getReaderEpub(c.env, b.id);
  if (!bytes) return c.json({ error: "暂无可生成的 EPUB 阅读版" }, 404);
  const filename = `${b.id}-reader.epub`;
  const utf8Name = encodeURIComponent(`${b.t || b.id}-reader.epub`);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

books.get("/books/:id/source.epub", async (c) => {
  const bookId = c.req.param("id");
  const b = await getBook(c.env, bookId);
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const bytes = await getBlob(c.env, `book/${b.id}/source.epub`);
  const filename = `${b.id}.epub`;
  const utf8Name = encodeURIComponent(`${b.t || b.id}.epub`);
  if (!bytes) {
    const row = await c.env.DB.prepare(`SELECT source_url FROM library_books WHERE id = ?`).bind(bookId).first<{ source_url?: string }>();
    const sourceUrl = row?.source_url || "";
    const m = sourceUrl.match(/^https:\/\/www\.gutenberg\.org\/ebooks\/(\d+)$/);
    const epubUrls = m
      ? [
          `https://www.gutenberg.org/ebooks/${m[1]}.epub.images`,
          `https://www.gutenberg.org/ebooks/${m[1]}.epub.noimages`,
          `https://www.gutenberg.org/ebooks/${m[1]}.epub`,
        ]
      : (/^https:\/\/.+\.epub(?:\?.*)?$/i.test(sourceUrl) ? [sourceUrl] : []);
    for (const epubUrl of epubUrls) {
      try {
        const res = await fetch(epubUrl, { headers: { "user-agent": "liber-epub-proxy/0.1" } });
        if (!res.ok || !res.body) continue;
        return new Response(res.body, {
          headers: {
            "Content-Type": "application/epub+zip",
            "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${utf8Name}`,
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        // Try the next known Gutenberg EPUB URL variant.
      }
    }
    return c.json({ error: "未找到 EPUB 源文件" }, 404);
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// live reachability probe: a thrown fetch = unreachable; any HTTP response
// (even 404) means DNS/TLS/route works. null when the endpoint isn't configured.
async function reachable(url?: string): Promise<boolean | null> {
  if (!url) return null;
  try { await fetch(url, { method: "GET" }); return true; } catch { return false; }
}

books.get("/books/:id/proof", async (c) => {
  const b = await getBook(c.env, c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const [walrus, arweave, chainStatus] = await Promise.all([
    reachable(c.env.WALRUS_AGGREGATOR),
    reachable(c.env.ARWEAVE_GATEWAY),
    chain(c.env).chainInfo(c.env), // active-chain liveness (checkpoint/block) or null when unset
  ]);
  return c.json({
    blob: b.blob, backup: b.backup, index: b.index, license: b.license || "CC0-1.0",
    networks: {
      configured: !!(c.env.WALRUS_AGGREGATOR || c.env.SUI_RPC || c.env.EVM_RPC),
      walrus, arweave,
      chain: chainStatus?.chain ?? null,
      // back-compat alias: the certificate UI still reads `sui`
      sui: chainStatus ? chainStatus.live : null,
      checkpoint: chainStatus?.checkpoint ?? null,
      chainId: chainStatus?.chainId ?? null,
    },
  });
});

// Resolve a real on-chain object by id (read-only verification, active chain).
books.get("/chain/object/:id", async (c) => {
  const data = await chain(c.env).getObject(c.env, c.req.param("id"));
  if (!data) return c.json({ error: "对象不存在或链上验证未配置" }, 404);
  return c.json({ object: data });
});
// back-compat alias
books.get("/sui/object/:id", async (c) => {
  const data = await chain(c.env).getObject(c.env, c.req.param("id"));
  if (!data) return c.json({ error: "对象不存在或链上验证未配置" }, 404);
  return c.json({ object: data });
});

// Real, content-addressed blobs published by users (works / shares). Looks up
// the D1 record and, when a Walrus aggregator is configured and the id is real,
// probes live availability against it.
books.get("/blobs/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const rec = await c.env.DB.prepare(
    `SELECT key, walrus, arweave, sui_index, size, content_type, created_at FROM blobs WHERE key = ?`,
  ).bind(key).first<any>();
  if (!rec) return c.json({ error: "未找到该 blob" }, 404);
  let available: boolean | null = null;
  const agg = c.env.WALRUS_AGGREGATOR;
  const blobId = typeof rec.walrus === "string" && rec.walrus.startsWith("walrus://") ? rec.walrus.slice(9) : null;
  if (agg && blobId && !blobId.includes("…")) {
    try { const res = await fetch(`${agg.replace(/\/$/, "")}/v1/blobs/${blobId}`); available = res.ok; } catch { available = false; }
  }
  return c.json({ blob: rec, available });
});

books.get("/search", async (c) => {
  const term = (c.req.query("q") || "").trim();
  const dynamicOnly = await hasLibraryBooks(c.env);
  const seedBooks = term
    ? S.BOOKS.filter((b) => b.t.includes(term) || b.a.includes(term) || (b.sub || "").toLowerCase().includes(term.toLowerCase()) || b.cat.includes(term))
    : S.BOOKS.slice(0, 4);
  const idx = S.sentenceIndex();
  const seedSentences = term
    ? Object.entries(idx).filter(([, v]) => v.t.includes(term)).map(([sid, v]) => ({ sid, t: v.t, book: "道德经", bookId: "daodejing", chap: v.chap }))
    : [];
  const dynamic = await searchDynamic(c.env, term);
  if (dynamicOnly) return c.json({ books: dynamic.books, sentences: dynamic.sentences.slice(0, 12) });
  const ids = new Set(dynamic.books.map((b: any) => b.id));
  return c.json({ books: [...dynamic.books, ...seedBooks.filter((b) => !ids.has(b.id))], sentences: [...dynamic.sentences, ...seedSentences].slice(0, 12) });
});

// ---- Book text on decentralized storage ----

// Publish-gated ingest: write chapter text to Walrus (+R2), recording one blob
// per chapter plus a manifest. Requires ADMIN_TOKEN or a CLI publish token.
books.post("/books/ingest", async (c) => {
  const auth = await ingestAuth(c);
  if (!auth.ok) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  if (Number(c.req.header("content-length") || 0) > 12_000_000) {
    return c.json({ error: "请求体过大，超大书籍请使用分块上传接口" }, 413);
  }
  const body = await c.req.json();
  if (!body.text && !body.epubBase64 && !body.chapters?.length && body.sourceUrl) {
    // Follow redirects MANUALLY, re-validating every hop against the allowlist —
    // otherwise an allowlisted host could 30x-redirect us to an internal address
    // (SSRF) since the literal sourceUrl check alone does not cover redirects.
    let url: string = body.sourceUrl;
    let res: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
      if (!isAllowedIngestUrl(url, c.env)) {
        return c.json({ error: "sourceUrl 不在允许的来源白名单内（仅限 https 公有领域来源）" }, 400);
      }
      res = await fetch(url, { redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      url = new URL(loc, url).toString();
    }
    if (!res || !res.ok) return c.json({ error: `源文本下载失败：${res?.status ?? "重定向过多"}` }, 400);
    body.text = await res.text();
  }
  try {
    const result = await ingestBook(c.env, body, auth.userId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});

books.post("/books/ingest/begin", async (c) => {
  const auth = await ingestAuth(c);
  if (!auth.ok) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  try {
    const result = await beginChunkedBookIngest(c.env, await c.req.json(), auth.userId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});

books.post("/books/ingest/chapter", async (c) => {
  const auth = await ingestAuth(c);
  if (!auth.ok) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  try {
    const body = await c.req.json();
    const result = await ingestBookChapter(c.env, body, body.chapter, Number(body.index || 0), auth.userId);
    return c.json({ ok: true, chapter: result.n, title: result.title, ref: result.ref });
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});

books.post("/books/ingest/finalize", async (c) => {
  const auth = await ingestAuth(c);
  if (!auth.ok) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  try {
    const result = await finalizeChunkedBookIngest(c.env, await c.req.json(), auth.userId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});

books.post("/books/:id/ingest", async (c) => {
  const auth = await ingestAuth(c);
  if (!auth.ok) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const chapters = S.BOOK_CONTENT[b.id]?.chapters || [];
  if (!chapters.length) return c.json({ error: "暂无可入库的正文" }, 400);

  const refs: Array<{ n: number; title: string; walrus: string; size: number }> = [];
  for (const ch of chapters) {
    const text = ch.paras.flat().map((s: any) => s.t).join("\n");
    const ref = await putBlob(c.env, `book/${b.id}/ch/${ch.n}`, text, "text/plain; charset=utf-8");
    refs.push({ n: ch.n, title: ch.title, walrus: ref.walrus, size: ref.size });
  }
  const manifest = JSON.stringify({ book: b.id, title: b.t, license: "CC0-1.0", chapters: refs });
  const mref = await putBlob(c.env, `book/${b.id}/manifest`, manifest, "application/json");
  try {
    await ingestBook(c.env, {
      id: b.id,
      title: b.t,
      subtitle: b.sub,
      author: b.a,
      category: b.cat,
      lang: b.lang,
      year: b.year,
      blurb: b.blurb,
      description: b.long,
      license: "CC0-1.0",
      featured: !!b.featured,
      chapters: chapters.map((ch: any) => ({ n: ch.n, title: ch.title, paras: ch.paras })),
    }, auth.userId);
  } catch {
    // legacy ingest still succeeded; don't fail the request after blob writes.
  }
  return c.json({ ok: true, book: b.id, manifest: mref.walrus, chapters: refs });
});

// Serve a chapter's text from storage (Walrus/R2) when ingested, else from seed.
books.get("/books/:id/content/:n", async (c) => {
  const b = await getBook(c.env, c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const n = Number(c.req.param("n"));
  const content = await getChapterText(c.env, b.id, n);
  if (!content) return c.json({ error: "未找到该章" }, 404);
  return c.json({ ...content, chapter: textToChapter(b.id, content.n, content.title, content.text) });
});

export default books;
