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

books.get("/books/:id/proof", (c) => {
  const b = S.bookById(c.req.param("id"));
  if (!b) return c.json({ error: "未找到该书" }, 404);
  return c.json({ blob: b.blob, backup: b.backup, index: b.index, license: "CC0 1.0 Universal" });
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
