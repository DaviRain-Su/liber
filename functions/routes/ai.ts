import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { companionReply } from "../lib/ai";
import { withinQuota, recordUsage, getUsage, estimateTokens } from "../lib/usage";
import * as S from "../lib/seed";

// AI book companion (Workers AI). Guests can chat; logged-in users get their
// conversation persisted (and a 'convo' signal recorded for the rankings).
const ai = new Hono<{ Bindings: Env; Variables: Variables }>();

ai.post("/chat", async (c) => {
  const uid = c.get("userId");
  const b = await c.req.json();
  const question = (b.question || "").trim();
  if (!question) return c.json({ error: "问题为空" }, 400);
  const lens = b.lens || "companion";
  const book = b.bookId ? S.bookById(b.bookId) : null;

  // metered free-tier quota (logged-in users only; guests unmetered for now)
  if (uid && !(await withinQuota(c.env, uid))) {
    const u = await getUsage(c.env, uid);
    return c.json({ error: "本月免费 AI 额度已用完，升级会员可无限畅聊。", usage: u, upgrade: true }, 429);
  }

  let convoId: string | null = b.conversationId || null;
  let history: Array<{ role: "user" | "assistant"; content: string }> = b.history || [];
  if (uid && convoId) {
    const owned = await first(c.env.DB, `SELECT 1 AS x FROM conversations WHERE id = ? AND user_id = ?`, convoId, uid);
    if (!owned) return c.json({ error: "未找到该对话" }, 404);
    const msgs = await all(c.env.DB, `SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 16`, convoId);
    history = msgs.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  }

  const reply = await companionReply(c.env, { lens, question, context: b.context, bookTitle: book?.t, chapter: b.chapter, history });

  if (uid) {
    if (!convoId) {
      convoId = id("c_");
      await run(c.env.DB, `INSERT INTO conversations (id, user_id, book_id, sid, lens, created_at) VALUES (?,?,?,?,?,?)`, convoId, uid, b.bookId || null, b.sid || null, lens, now());
    }
    await run(c.env.DB, `INSERT INTO messages (id, conversation_id, role, text, ref, created_at) VALUES (?,?,?,?,?,?)`, id("m_"), convoId, "user", question, null, now());
    await run(c.env.DB, `INSERT INTO messages (id, conversation_id, role, text, ref, created_at) VALUES (?,?,?,?,?,?)`, id("m_"), convoId, "assistant", reply.text, reply.ref, now());
    if (b.bookId) await run(c.env.DB, `INSERT INTO events (id, type, book_id, sid, user_id, created_at) VALUES (?,?,?,?,?,?)`, id("e_"), "convo", b.bookId, b.sid || null, uid, now());
    await recordUsage(c.env, uid, estimateTokens(question, reply.text));
  }
  return c.json({ ...reply, conversationId: convoId });
});

// Current month's AI usage + plan/quota (for a usage meter / upgrade prompt).
ai.get("/usage", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ usage: null });
  return c.json({ usage: await getUsage(c.env, uid) });
});

ai.get("/conversations", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ conversations: [] });
  const rows = await all(c.env.DB, `SELECT id, book_id, sid, lens, created_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, uid);
  return c.json({ conversations: rows });
});

ai.get("/conversations/:id", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ error: "未登录" }, 401);
  const owned = await first(c.env.DB, `SELECT 1 AS x FROM conversations WHERE id = ? AND user_id = ?`, c.req.param("id"), uid);
  if (!owned) return c.json({ error: "未找到该对话" }, 404);
  const msgs = await all(c.env.DB, `SELECT role, text, ref, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`, c.req.param("id"));
  return c.json({ messages: msgs });
});

export default ai;
