import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { requireUser } from "../lib/auth";

// Direct messages (私信) between readers. A message may quote a passage/annotation.
const messages = new Hono<{ Bindings: Env; Variables: Variables }>();

const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const safeParse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// My DM threads: each partner + last message + unread count.
messages.get("/threads", async (c) => {
  const uid = requireUser(c);
  const rows = await all<any>(
    c.env.DB,
    `SELECT id, from_id, to_id, body, quote, read_at, created_at,
            CASE WHEN from_id = ? THEN to_id ELSE from_id END AS partner_id
     FROM dm_messages WHERE from_id = ? OR to_id = ?
     ORDER BY created_at DESC LIMIT 500`,
    uid, uid, uid,
  );
  const byPartner: Record<string, { last: any; unread: number }> = {};
  for (const m of rows) {
    const pid = m.partner_id;
    if (!byPartner[pid]) byPartner[pid] = { last: m, unread: 0 }; // rows are DESC → first seen is latest
    if (m.to_id === uid && !m.read_at) byPartner[pid].unread++;
  }
  const partnerIds = Object.keys(byPartner);
  const profiles: Record<string, any> = {};
  if (partnerIds.length) {
    const q = partnerIds.map(() => "?").join(",");
    for (const u of await all<any>(c.env.DB, `SELECT id, name, handle, color, seal FROM users WHERE id IN (${q})`, ...partnerIds)) profiles[u.id] = u;
  }
  const threads = partnerIds.map((pid) => {
    const t = byPartner[pid];
    const p = profiles[pid] || {};
    return {
      userId: pid, name: p.name || "读者", handle: p.handle || "", color: p.color || "#3a4fb0", seal: p.seal || String(p.name || "读")[0],
      lastText: t.last.body || (t.last.quote ? "「引用」" : ""), lastFromMe: t.last.from_id === uid, unread: t.unread, createdAt: t.last.created_at,
    };
  }).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return c.json({ threads });
});

// Total unread DMs — drives the AppBar mail dot.
messages.get("/unread", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ unread: 0 });
  const r = await first<any>(c.env.DB, `SELECT COUNT(*) AS n FROM dm_messages WHERE to_id = ? AND read_at IS NULL`, uid);
  return c.json({ unread: Number(r?.n || 0) });
});

// Conversation with a specific user (and mark incoming as read).
messages.get("/with/:userId", async (c) => {
  const uid = requireUser(c);
  const other = c.req.param("userId");
  const rows = await all<any>(
    c.env.DB,
    `SELECT id, from_id, to_id, body, quote, created_at FROM dm_messages
     WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
     ORDER BY created_at ASC LIMIT 300`,
    uid, other, other, uid,
  );
  if (rows.length) await run(c.env.DB, `UPDATE dm_messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL`, now(), uid, other);
  const p = await first<any>(c.env.DB, `SELECT id, name, handle, color, seal FROM users WHERE id = ?`, other);
  return c.json({
    partner: p ? { userId: p.id, name: p.name || "读者", handle: p.handle || "", color: p.color || "#3a4fb0", seal: p.seal || String(p.name || "读")[0] } : null,
    messages: rows.map((m) => ({ id: m.id, fromMe: m.from_id === uid, t: m.body, quote: safeParse(m.quote), when: "刚刚" })),
  });
});

// Send a DM (text + optional quote). Also drops a notification to the recipient.
messages.post("/with/:userId", async (c) => {
  const uid = requireUser(c);
  const other = c.req.param("userId");
  if (other === uid) return c.json({ error: "不能给自己发私信" }, 400);
  if (!(await first(c.env.DB, `SELECT 1 AS x FROM users WHERE id = ?`, other))) return c.json({ error: "对方不存在" }, 404);
  const b = await c.req.json();
  const body = cap(b.text, 4000);
  let quote: string | null = null;
  if (b.quote && typeof b.quote === "object") {
    quote = JSON.stringify({ q: cap(b.quote.q, 600), note: cap(b.quote.note, 600), book: cap(b.quote.book, 120), chap: cap(b.quote.chap, 60) });
  }
  if (!body && !quote) return c.json({ error: "消息为空" }, 400);
  const mid = id("dm_");
  await run(c.env.DB, `INSERT INTO dm_messages (id, from_id, to_id, body, quote, created_at) VALUES (?,?,?,?,?,?)`, mid, uid, other, body, quote, now());
  const me = await first<any>(c.env.DB, `SELECT name, color FROM users WHERE id = ?`, uid);
  await run(
    c.env.DB,
    `INSERT INTO notifications (id, user_id, kind, actor_id, actor_name, actor_color, text, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    id("nt_"), other, "dm", uid, me?.name || "读者", me?.color || "#3a4fb0", "给你发来一条私信", now(),
  );
  return c.json({ ok: true, id: mid });
});

export default messages;
