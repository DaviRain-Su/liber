import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import * as S from "../lib/seed";

const books = new Hono<{ Bindings: Env; Variables: Variables }>();

books.get("/books", (c) => {
  const cat = c.req.query("cat");
  const sort = c.req.query("sort") || "reads";
  let list = S.BOOKS.filter((b) => !cat || cat.startsWith("全部") || b.cat === cat);
  if (sort === "lines") list = [...list].sort((a, b) => b.liners - a.liners);
  else list = [...list].sort((a, b) => b.readsN - a.readsN);
  return c.json({ books: list, total: 1284 });
});

books.get("/books/:id", (c) => {
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const has = b.id === "daodejing";
  return c.json({ book: b, toc: has ? S.TOC : null, highlights: has ? S.HIGHLIGHTS : null, reviews: has ? S.REVIEWS : null });
});

books.get("/books/:id/chapters", (c) => {
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  return c.json({ chapters: b.id === "daodejing" ? S.CHAPTERS : [], toc: S.TOC });
});

// live reachability probe: a thrown fetch = unreachable; any HTTP response
// (even 404) means DNS/TLS/route works. null when the endpoint isn't configured.
async function reachable(url?: string): Promise<boolean | null> {
  if (!url) return null;
  try { await fetch(url, { method: "GET" }); return true; } catch { return false; }
}

books.get("/books/:id/proof", async (c) => {
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const [walrus, arweave] = await Promise.all([
    reachable(c.env.WALRUS_AGGREGATOR),
    reachable(c.env.ARWEAVE_GATEWAY),
  ]);
  return c.json({
    blob: b.blob, backup: b.backup, index: b.index, license: "CC0 1.0 Universal",
    networks: { configured: !!c.env.WALRUS_AGGREGATOR, walrus, arweave },
  });
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

books.get("/search", (c) => {
  const term = (c.req.query("q") || "").trim();
  const matched = term
    ? S.BOOKS.filter((b) => b.t.includes(term) || b.a.includes(term) || (b.sub || "").toLowerCase().includes(term.toLowerCase()) || b.cat.includes(term))
    : S.BOOKS.slice(0, 4);
  const idx = S.sentenceIndex();
  const sentences = term
    ? Object.entries(idx).filter(([, v]) => v.t.includes(term)).map(([sid, v]) => ({ sid, t: v.t, book: "道德经", bookId: "daodejing", chap: v.chap }))
    : [];
  return c.json({ books: matched, sentences: sentences.slice(0, 8) });
});

export default books;
