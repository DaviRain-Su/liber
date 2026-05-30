import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import * as S from "../lib/seed";
import { getChainInfo, getObject } from "../lib/sui";
import { putBlob, getBlob } from "../lib/storage";

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
  const [walrus, arweave, sui] = await Promise.all([
    reachable(c.env.WALRUS_AGGREGATOR),
    reachable(c.env.ARWEAVE_GATEWAY),
    getChainInfo(c.env), // real Sui liveness (latest checkpoint) or null when unset
  ]);
  return c.json({
    blob: b.blob, backup: b.backup, index: b.index, license: "CC0 1.0 Universal",
    networks: {
      configured: !!(c.env.WALRUS_AGGREGATOR || c.env.SUI_RPC),
      walrus, arweave,
      sui: sui ? sui.live : null,
      checkpoint: sui?.checkpoint ?? null,
      chainId: sui?.chainId ?? null,
    },
  });
});

// Resolve a real on-chain Sui object by id (read-only verification).
books.get("/sui/object/:id", async (c) => {
  const data = await getObject(c.env, c.req.param("id"));
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

// ---- Book text on decentralized storage ----

// Admin-gated ingest: publish a book's available chapter text to Walrus (+R2),
// recording one blob per chapter plus a manifest. Disabled (401) unless
// ADMIN_TOKEN is configured and presented as a bearer token.
books.post("/books/:id/ingest", async (c) => {
  const admin = c.env.ADMIN_TOKEN;
  const auth = c.req.header("Authorization");
  if (!admin || auth !== `Bearer ${admin}`) return c.json({ error: "需要管理员令牌" }, 401);
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const chapters = b.id === "daodejing" ? S.CHAPTERS : [];
  if (!chapters.length) return c.json({ error: "暂无可入库的正文" }, 400);

  const refs: Array<{ n: number; title: string; walrus: string; size: number }> = [];
  for (const ch of chapters) {
    const text = ch.paras.flat().map((s: any) => s.t).join("\n");
    const ref = await putBlob(c.env, `book/${b.id}/ch/${ch.n}`, text, "text/plain; charset=utf-8");
    refs.push({ n: ch.n, title: ch.title, walrus: ref.walrus, size: ref.size });
  }
  const manifest = JSON.stringify({ book: b.id, title: b.t, license: "CC0-1.0", chapters: refs });
  const mref = await putBlob(c.env, `book/${b.id}/manifest`, manifest, "application/json");
  return c.json({ ok: true, book: b.id, manifest: mref.walrus, chapters: refs });
});

// Serve a chapter's text from storage (Walrus/R2) when ingested, else from seed.
books.get("/books/:id/content/:n", async (c) => {
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  const n = Number(c.req.param("n"));
  const buf = await getBlob(c.env, `book/${b.id}/ch/${n}`);
  if (buf) return c.json({ source: "walrus", n, text: new TextDecoder().decode(buf) });
  const ch = (b.id === "daodejing" ? S.CHAPTERS : []).find((x: any) => x.n === n);
  if (!ch) return c.json({ error: "未找到该章" }, 404);
  return c.json({ source: "seed", n, title: ch.title, text: ch.paras.flat().map((s: any) => s.t).join("\n") });
});

export default books;
