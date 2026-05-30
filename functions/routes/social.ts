import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { requireUser } from "../lib/auth";
import { putBlob } from "../lib/storage";
import * as S from "../lib/seed";

// Co-reading & social: annotations, feed, shares, groups, threads, works.
// Every list endpoint merges seed baselines with live D1 rows.
const social = new Hono<{ Bindings: Env; Variables: Variables }>();

// others' annotations on a sentence = seed + public D1 notes (all users)
social.get("/annotations/:bookId/:sid", async (c) => {
  const { bookId, sid } = c.req.param();
  const seedAnnos = S.ANNOTATIONS[sid] || [];
  const rows = await all(
    c.env.DB,
    `SELECT n.text, n.color, n.up, u.name FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.book_id = ? AND n.sid = ? AND n.public = 1 ORDER BY n.created_at DESC LIMIT 50`,
    bookId, sid,
  );
  const extra = rows.map((r) => ({ u: r.name || "读者", color: r.color || "#3a4fb0", t: r.text, up: r.up || 0, replies: 0 }));
  return c.json({ annotations: [...seedAnnos, ...extra] });
});

social.get("/feed", (c) => c.json({ feed: S.FEED }));

// shared AI conversations: user-published (D1) on top of the seeds
social.get("/shares", async (c) => {
  const mine = c.get("userId");
  const rows = await all(
    c.env.DB,
    `SELECT s.*, u.name AS author_name, u.seal AS author_seal, u.color AS author_color
     FROM shares s JOIN users u ON u.id = s.user_id
     WHERE s.visibility = 'public' ORDER BY s.created_at DESC LIMIT 50`,
  );
  const published = rows.map((r) => {
    const data = JSON.parse(r.data || "{}");
    return {
      id: r.id, form: r.form, book: r.book_id, bookT: S.bookById(r.book_id)?.t || "", seal: data.seal || r.author_seal || "道",
      chap: data.chap || "", quote: r.quote, sid: r.sid, title: r.title, insight: r.insight,
      author: { name: r.author_name, ava: r.author_seal || "读", color: r.author_color || "#3a4fb0" },
      forks: 0, agree: r.agree || 0, comments: 0, saves: 0, when: "刚刚", msgs: data.msgs || [], mine: r.user_id === mine,
    };
  });
  return c.json({ shares: [...published, ...S.SHARED_CONVOS] });
});

social.post("/shares", async (c) => {
  const uid = requireUser(c);
  const b = await c.req.json();
  const sid = id("sh_");
  const data = JSON.stringify({ msgs: b.msgs || [], chap: b.chap, seal: b.seal });
  await run(
    c.env.DB,
    `INSERT INTO shares (id, user_id, book_id, sid, form, title, insight, quote, visibility, parent_id, data, agree, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    sid, uid, b.bookId || null, b.sid || null, b.form || "card", b.title || null, b.insight || null,
    b.quote || null, b.visibility || "public", b.parentId || null, data, now(),
  );
  // persist the shared conversation as a content-addressed blob (Walrus when configured, R2 always)
  const ref = await putBlob(c.env, `share/${sid}`, data, "application/json");
  return c.json({ ok: true, id: sid, walrus: ref.walrus });
});

social.post("/shares/:id/save", async (c) => {
  const uid = requireUser(c);
  const sid = c.req.param("id");
  const exists = await first(c.env.DB, `SELECT 1 AS x FROM convo_saves WHERE user_id = ? AND share_id = ?`, uid, sid);
  if (exists) {
    await run(c.env.DB, `DELETE FROM convo_saves WHERE user_id = ? AND share_id = ?`, uid, sid);
    return c.json({ saved: false });
  }
  await run(c.env.DB, `INSERT INTO convo_saves (user_id, share_id) VALUES (?,?)`, uid, sid);
  return c.json({ saved: true });
});

social.get("/groups", (c) => c.json({ groups: S.GROUPS }));

social.get("/groups/:id", async (c) => {
  const g = S.GROUPS.find((x) => x.id === c.req.param("id")) || S.GROUPS[0];
  const posts = await all(
    c.env.DB,
    `SELECT gp.text, gp.chap, gp.up, u.name, u.color FROM group_posts gp JOIN users u ON u.id = gp.user_id
     WHERE gp.group_id = ? ORDER BY gp.created_at DESC LIMIT 50`,
    g.id,
  );
  const extra = posts.map((p) => ({ u: p.name || "读者", color: p.color || "#3a4fb0", when: "刚刚", chap: p.chap, t: p.text, up: p.up || 0, replies: 0, mine: true }));
  return c.json({ group: { ...g, discussion: [...extra, ...g.discussion] } });
});

social.post("/groups/:id/posts", async (c) => {
  const uid = requireUser(c);
  const gid = c.req.param("id");
  const { text, chap } = await c.req.json();
  if (!text?.trim()) return c.json({ error: "内容为空" }, 400);
  const pid = id("gp_");
  await run(c.env.DB, `INSERT INTO group_posts (id, group_id, user_id, text, chap, up, created_at) VALUES (?,?,?,?,?,0,?)`, pid, gid, uid, text.trim(), chap || null, now());
  return c.json({ ok: true, id: pid });
});

social.post("/groups/:id/join", async (c) => {
  const uid = requireUser(c);
  const gid = c.req.param("id");
  const ex = await first(c.env.DB, `SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?`, gid, uid);
  if (ex) {
    await run(c.env.DB, `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, gid, uid);
    return c.json({ joined: false });
  }
  await run(c.env.DB, `INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?)`, gid, uid, now());
  return c.json({ joined: true });
});

social.get("/threads/:key", async (c) => {
  const replies = await all(
    c.env.DB,
    `SELECT tr.text, tr.up, u.name, u.color FROM thread_replies tr JOIN users u ON u.id = tr.user_id
     WHERE tr.thread_key = ? ORDER BY tr.created_at ASC`,
    c.req.param("key"),
  );
  return c.json({ thread: S.THREAD, replies: replies.map((r) => ({ u: r.name, color: r.color, when: "刚刚", t: r.text, up: r.up || 0, mine: true })) });
});

social.post("/threads/:key", async (c) => {
  const uid = requireUser(c);
  const { text } = await c.req.json();
  if (!text?.trim()) return c.json({ error: "内容为空" }, 400);
  await run(c.env.DB, `INSERT INTO thread_replies (id, thread_key, user_id, text, up, created_at) VALUES (?,?,?,?,0,?)`, id("tr_"), c.req.param("key"), uid, text.trim(), now());
  return c.json({ ok: true });
});

social.get("/works", async (c) => {
  const rows = await all(c.env.DB, `SELECT w.id, w.title, w.body, w.addr, w.license, w.cited, w.created_at, u.name FROM works w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 50`);
  return c.json({ works: rows });
});

social.post("/works", async (c) => {
  const uid = requireUser(c);
  const { title, body } = await c.req.json();
  if (!body?.trim()) return c.json({ error: "内容为空" }, 400);
  const wid = id("w_");
  // store the essay as a content-addressed blob (Walrus when configured, R2 always)
  const ref = await putBlob(c.env, `work/${wid}`, body, "text/markdown");
  await run(
    c.env.DB,
    `INSERT INTO works (id, user_id, title, body, addr, license, cited, created_at) VALUES (?,?,?,?,?,?,0,?)`,
    wid, uid, (title || "未命名导读").trim(), body.trim(), `liber://work/${wid}`, "CC0-1.0", now(),
  );
  return c.json({ ok: true, id: wid, addr: `liber://work/${wid}`, walrus: ref.walrus, arweave: ref.arweave });
});

export default social;
