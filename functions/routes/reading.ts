import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { requireUser } from "../lib/auth";
import { readingSummary } from "../lib/reading-summary";
import { enqueueSids } from "../lib/graph/embed";

// Per-user reading data (highlights / notes / progress) — replaces the
// frontend's localStorage keys with server-side, cross-device storage.
const reading = new Hono<{ Bindings: Env; Variables: Variables }>();

reading.get("/summary", async (c) => {
  return c.json(await readingSummary(c.env, c.get("userId")));
});

reading.get("/:bookId", async (c) => {
  const uid = requireUser(c);
  const bid = c.req.param("bookId");
  const [hls, notes, progress, heatRows] = await Promise.all([
    all(c.env.DB, `SELECT sid, color FROM highlights WHERE user_id = ? AND book_id = ?`, uid, bid),
    all(c.env.DB, `SELECT sid, text, color, up FROM notes WHERE user_id = ? AND book_id = ?`, uid, bid),
    first(c.env.DB, `SELECT chapter_n, percent FROM progress WHERE user_id = ? AND book_id = ?`, uid, bid),
    all(c.env.DB, `SELECT sid, COUNT(DISTINCT user_id) AS n FROM highlights WHERE book_id = ? GROUP BY sid`, bid),
  ]);
  const hlMap: Record<string, string> = {};
  for (const h of hls) hlMap[h.sid] = h.color;
  const noteMap: Record<string, any[]> = {};
  for (const n of notes) (noteMap[n.sid] ||= []).push({ u: "林知秋", color: n.color || "#3a4fb0", t: n.text, up: n.up || 0, replies: 0, mine: true });
  const heat: Record<string, number> = {};
  for (const row of heatRows) heat[row.sid] = Number(row.n || 0);
  return c.json({ highlights: hlMap, notes: noteMap, progress, heat });
});

reading.put("/:bookId/highlight", async (c) => {
  const uid = requireUser(c);
  const bid = c.req.param("bookId");
  const { sid, color } = await c.req.json();
  if (!sid) return c.json({ error: "缺少 sid" }, 400);
  if (color === null) {
    await run(c.env.DB, `DELETE FROM highlights WHERE user_id = ? AND book_id = ? AND sid = ?`, uid, bid, sid);
    return c.json({ ok: true, removed: true });
  }
  // color becomes a CSS class on the sentence — only accept the known swatches.
  if (!["hl-user", "hl-yellow", "hl-green"].includes(color)) return c.json({ error: "无效的划线颜色" }, 400);
  await run(
    c.env.DB,
    `INSERT INTO highlights (id, user_id, book_id, sid, color, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, book_id, sid) DO UPDATE SET color = excluded.color`,
    id("hl_"), uid, bid, sid, color, now(),
  );
  await run(c.env.DB, `INSERT INTO events (id, type, book_id, sid, user_id, created_at) VALUES (?,?,?,?,?,?)`, id("e_"), "line", bid, sid, uid, now());
  // strong signal: a highlighted sentence is worth embedding + linking. Best-effort, off the response path.
  c.executionCtx.waitUntil(enqueueSids(c.env, [sid]));
  return c.json({ ok: true });
});

reading.post("/:bookId/note", async (c) => {
  const uid = requireUser(c);
  const bid = c.req.param("bookId");
  const body = await c.req.json();
  const text = (body.text || "").trim();
  if (!body.sid || !text) return c.json({ error: "缺少内容" }, 400);
  const nid = id("n_");
  await run(
    c.env.DB,
    `INSERT INTO notes (id, user_id, book_id, sid, text, public, color, up, created_at) VALUES (?,?,?,?,?,?,?,0,?)`,
    nid, uid, bid, body.sid, text, body.public === false ? 0 : 1, body.color || "#3a4fb0", now(),
  );
  c.executionCtx.waitUntil(enqueueSids(c.env, [body.sid]));
  return c.json({ ok: true, id: nid });
});

reading.put("/:bookId/progress", async (c) => {
  const uid = requireUser(c);
  const bid = c.req.param("bookId");
  const { chapter_n, percent } = await c.req.json();
  await run(
    c.env.DB,
    `INSERT INTO progress (user_id, book_id, chapter_n, percent, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, book_id) DO UPDATE SET chapter_n = excluded.chapter_n, percent = excluded.percent, updated_at = excluded.updated_at`,
    uid, bid, chapter_n ?? null, percent ?? 0, now(),
  );
  return c.json({ ok: true });
});

export default reading;
