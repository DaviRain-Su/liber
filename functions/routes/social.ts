import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { requireUser } from "../lib/auth";
import { putBlob } from "../lib/storage";
import { chain } from "../lib/chains";
import { getToc, hasLibraryBooks, listBooks } from "../lib/catalog";
import * as S from "../lib/seed";

// Co-reading & social: annotations, feed, shares, groups, threads, works.
// Every list endpoint merges seed baselines with live D1 rows.
const social = new Hono<{ Bindings: Env; Variables: Variables }>();

async function liveGroups(env: Env, userId?: string | null) {
  const books = await listBooks(env);
  const liveBooks = books.filter((b: any) => b.dynamic);
  const groups: any[] = [];
  for (const b of liveBooks) {
    const gid = `live-${b.id}`;
    const [memberRows, postCount, progressRows, annoRows, toc] = await Promise.all([
      all<any>(
        env.DB,
        `SELECT u.name, u.color, u.seal, gm.user_id
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ? ORDER BY gm.joined_at ASC LIMIT 8`,
        gid,
      ),
      all<any>(env.DB, `SELECT COUNT(*) AS n FROM group_posts WHERE group_id = ?`, gid),
      all<any>(env.DB, `SELECT percent FROM progress WHERE book_id = ?`, b.id),
      all<any>(
        env.DB,
        `SELECT COUNT(*) AS n FROM notes WHERE book_id = ?
         UNION ALL
         SELECT COUNT(*) AS n FROM highlights WHERE book_id = ?`,
        b.id, b.id,
      ),
      getToc(env, b.id),
    ]);
    const progressPct = progressRows.length
      ? Math.round(progressRows.reduce((sum, r) => sum + Number(r.percent || 0), 0) / progressRows.length)
      : 0;
    const annos = annoRows.reduce((sum, r) => sum + Number(r.n || 0), 0);
    const first = toc[0];
    const next = toc[Math.min(2, Math.max(0, toc.length - 1))];
    groups.push({
      id: gid,
      name: `《${b.t}》共读`,
      color: "#1f8a5b",
      seal: b.seal || "读",
      book: b.id,
      bookT: b.t,
      desc: "围绕真实入库文本的共读小组。成员、讨论、批注和进度都来自线上数据。",
      members: memberRows.length,
      joined: !!userId && memberRows.some((m) => m.user_id === userId),
      lead: memberRows[0]?.name || "",
      weekRange: first && next ? `${first.title} — ${next.title}` : first?.title || "从第一章开始",
      progressPct,
      annos,
      posts: Number(postCount[0]?.n || 0),
      memberAvatars: memberRows.map((m) => ({ n: m.seal || String(m.name || "读")[0], c: m.color || "#3a4fb0" })),
      schedule: toc.slice(0, 5).map((t, i) => ({
        wk: i === 0 ? "开始" : `第 ${i + 1} 节`,
        chap: t.title,
        state: i === 0 ? "current" : "upcoming",
      })),
      discussion: [],
      topAnno: null,
    });
  }
  return groups;
}

async function liveFeed(env: Env) {
  const [notes, shares, posts] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT n.text, n.up, n.created_at, n.book_id, lb.title AS book_title, u.name, u.color
       FROM notes n JOIN users u ON u.id = n.user_id
       LEFT JOIN library_books lb ON lb.id = n.book_id
       WHERE n.public = 1 ORDER BY n.created_at DESC LIMIT 20`,
    ),
    all<any>(
      env.DB,
      `SELECT s.id, s.title, s.quote, s.book_id, s.created_at, lb.title AS book_title, u.name, u.color
       FROM shares s JOIN users u ON u.id = s.user_id
       LEFT JOIN library_books lb ON lb.id = s.book_id
       WHERE s.visibility = 'public' ORDER BY s.created_at DESC LIMIT 20`,
    ),
    all<any>(
      env.DB,
      `SELECT gp.group_id, gp.text, gp.chap, gp.up, gp.created_at, u.name, u.color
       FROM group_posts gp JOIN users u ON u.id = gp.user_id
       ORDER BY gp.created_at DESC LIMIT 20`,
    ),
  ]);
  return [
    ...notes.map((n) => ({
      kind: "anno", u: n.name || "读者", color: n.color || "#3a4fb0", book: n.book_title || n.book_id,
      chap: "", t: n.text, up: n.up || 0, replies: 0, when: "刚刚", createdAt: n.created_at,
    })),
    ...shares.map((s) => ({
      kind: "convo", u: s.name || "读者", color: s.color || "#3a4fb0", book: s.book_title || s.book_id,
      title: s.title || "分享了一段阅读对话", quote: s.quote, up: 0, saved: 0, when: "刚刚", createdAt: s.created_at,
    })),
    ...posts.map((p) => ({
      kind: "group", u: p.name || "读者", color: p.color || "#3a4fb0", groupId: p.group_id, t: p.text, chap: p.chap || "",
      up: p.up || 0, members: 0, when: "刚刚", createdAt: p.created_at,
    })),
  ].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 30);
}

// others' annotations on a sentence = seed + public D1 notes (all users)
social.get("/annotations/:bookId/:sid", async (c) => {
  const { bookId, sid } = c.req.param();
  const dynamicOnly = await hasLibraryBooks(c.env);
  const seedAnnos = dynamicOnly ? [] : S.ANNOTATIONS[sid] || [];
  const rows = await all(
    c.env.DB,
    `SELECT n.text, n.color, n.up, u.name FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.book_id = ? AND n.sid = ? AND n.public = 1 ORDER BY n.created_at DESC LIMIT 50`,
    bookId, sid,
  );
  const extra = rows.map((r) => ({ u: r.name || "读者", color: r.color || "#3a4fb0", t: r.text, up: r.up || 0, replies: 0 }));
  return c.json({ annotations: [...seedAnnos, ...extra] });
});

social.get("/feed", async (c) => {
  if (await hasLibraryBooks(c.env)) return c.json({ feed: await liveFeed(c.env) });
  return c.json({ feed: S.FEED });
});

// shared AI conversations: user-published (D1) on top of the seeds
social.get("/shares", async (c) => {
  const mine = c.get("userId");
  const rows = await all(
    c.env.DB,
    `SELECT s.*, u.name AS author_name, u.seal AS author_seal, u.color AS author_color
     FROM shares s JOIN users u ON u.id = s.user_id
     WHERE s.visibility = 'public' ORDER BY s.created_at DESC LIMIT 50`,
  );
  // real aggregate counts for share cards: comments, saves, agree (votes)
  const cmtCounts: Record<string, number> = {};
  try {
    for (const r2 of await all(c.env.DB, `SELECT target_id, COUNT(*) AS n FROM comments WHERE target_type='share' GROUP BY target_id`)) cmtCounts[r2.target_id] = r2.n;
  } catch {
    // Older D1 databases may not have 0002 yet; don't take down /shares.
  }
  const saveCounts: Record<string, number> = {};
  for (const r2 of await all(c.env.DB, `SELECT share_id, COUNT(*) AS n FROM convo_saves GROUP BY share_id`)) saveCounts[r2.share_id] = r2.n;
  const voteCounts: Record<string, number> = {};
  try {
    for (const r2 of await all(c.env.DB, `SELECT target_id, COUNT(*) AS n FROM votes WHERE target_type='share' GROUP BY target_id`)) voteCounts[r2.target_id] = r2.n;
  } catch {
    // Same migration window as comments.
  }

  const byId: Record<string, any> = {};
  const children: Record<string, any[]> = {};
  for (const r of rows) {
    const data = JSON.parse(r.data || "{}");
    byId[r.id] = {
      id: r.id, parent: r.parent_id || null, form: r.form, book: r.book_id, bookT: S.bookById(r.book_id)?.t || "",
      seal: data.seal || r.author_seal || "道", chap: data.chap || "", quote: r.quote, sid: r.sid, title: r.title, insight: r.insight,
      author: { name: r.author_name, ava: r.author_seal || "读", color: r.author_color || "#3a4fb0" },
      agree: (r.agree || 0) + (voteCounts[r.id] || 0), comments: cmtCounts[r.id] || 0, saves: saveCounts[r.id] || 0,
      when: "刚刚", msgs: data.msgs || [], mine: r.user_id === mine,
    };
    if (r.parent_id) (children[r.parent_id] ||= []).push(r.id);
  }
  // a published fork rendered as a tree node (matches the client ForkTree shape)
  const toNode = (cid: string): any => {
    const c2 = byId[cid];
    const kids = (children[cid] || []).map(toNode);
    const q = (c2.msgs.find((m: any) => m.r === "q") || {}).t || c2.title || c2.insight || "";
    return { id: c2.id, name: c2.author.name, ava: c2.author.ava, color: c2.author.color, q, agree: c2.agree, forks: kids.length, children: kids };
  };
  const descendants = (cid: string): number => (children[cid] || []).reduce((s, k) => s + 1 + descendants(k), 0);
  // top-level cards = roots only; their forks nest as a real tree that grows with each continuation
  const published = rows
    .filter((r) => !r.parent_id || !byId[r.parent_id])
    .map((r) => ({ ...byId[r.id], forks: descendants(r.id), tree: (children[r.id] || []).map(toNode) }));
  if (await hasLibraryBooks(c.env)) return c.json({ shares: published });
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
  // register on Sui when configured (no-op otherwise); record the real digest/objectId
  const chainRef = await chain(c.env).registerObject(c.env, { contentId: ref.walrus, kind: "conversation", license: "CC0-1.0" });
  if (chainRef) await run(c.env.DB, `UPDATE blobs SET sui_index = ? WHERE key = ?`, chainRef.objectId || chainRef.digest, `share/${sid}`);
  return c.json({ ok: true, id: sid, walrus: ref.walrus, sui: chainRef });
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

social.get("/groups", async (c) => {
  if (await hasLibraryBooks(c.env)) return c.json({ groups: await liveGroups(c.env, c.get("userId")) });
  return c.json({ groups: S.GROUPS });
});

social.get("/groups/:id", async (c) => {
  const dynamicOnly = await hasLibraryBooks(c.env);
  const g = dynamicOnly
    ? (await liveGroups(c.env, c.get("userId"))).find((x) => x.id === c.req.param("id"))
    : S.GROUPS.find((x) => x.id === c.req.param("id")) || S.GROUPS[0];
  if (!g) return c.json({ error: "未找到共读小组" }, 404);
  const posts = await all(
    c.env.DB,
    `SELECT gp.text, gp.chap, gp.up, u.name, u.color FROM group_posts gp JOIN users u ON u.id = gp.user_id
     WHERE gp.group_id = ? ORDER BY gp.created_at DESC LIMIT 50`,
    g.id,
  );
  const extra = posts.map((p) => ({ u: p.name || "读者", color: p.color || "#3a4fb0", when: "刚刚", chap: p.chap, t: p.text, up: p.up || 0, replies: 0, mine: true }));
  return c.json({ group: { ...g, discussion: [...extra, ...(dynamicOnly ? [] : g.discussion)] } });
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
  // register the CC0 work on Sui when configured (no-op otherwise)
  const chainRef = await chain(c.env).registerObject(c.env, { contentId: ref.walrus, kind: "work", license: "CC0-1.0" });
  if (chainRef) await run(c.env.DB, `UPDATE blobs SET sui_index = ? WHERE key = ?`, chainRef.objectId || chainRef.digest, `work/${wid}`);
  return c.json({ ok: true, id: wid, addr: `liber://work/${wid}`, walrus: ref.walrus, arweave: ref.arweave, sui: chainRef });
});

// ---- Comments (generic over targets: share | work | book | …) ----
// Stored in D1 now; the comments.walrus column is reserved for an optional
// later move to decentralized permanent storage.
social.get("/comments/:type/:id", async (c) => {
  const { type, id: tid } = c.req.param();
  const rows = await all(
    c.env.DB,
    `SELECT cm.id, cm.text, cm.up, cm.walrus, cm.created_at, u.name, u.color, u.seal, cm.user_id
     FROM comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.target_type = ? AND cm.target_id = ? ORDER BY cm.created_at ASC LIMIT 200`,
    type, tid,
  );
  const mine = c.get("userId");
  return c.json({
    comments: rows.map((r) => ({
      id: r.id, u: r.name || "读者", color: r.color || "#3a4fb0", seal: r.seal || "读",
      t: r.text, up: r.up || 0, when: "刚刚", mine: r.user_id === mine, walrus: r.walrus || null,
    })),
  });
});

social.post("/comments/:type/:id", async (c) => {
  const uid = requireUser(c);
  const { type, id: tid } = c.req.param();
  const { text } = await c.req.json();
  const body = (text || "").trim();
  if (!body) return c.json({ error: "评论内容为空" }, 400);
  const cid = id("cm_");
  // step 2: persist the comment to decentralized storage (Walrus when configured,
  // R2 always); record the walrus address on the row. Never blocks posting.
  const meta = JSON.stringify({ type, target: tid, user: uid, text: body, at: now() });
  const ref = await putBlob(c.env, `comment/${cid}`, meta, "application/json");
  await run(
    c.env.DB,
    `INSERT INTO comments (id, target_type, target_id, user_id, text, up, walrus, created_at)
     VALUES (?,?,?,?,?,0,?,?)`,
    cid, type, tid, uid, body, ref.walrus, now(),
  );
  // register the comment on Sui when configured (no-op otherwise); record the digest/objectId
  const chainRef = await chain(c.env).registerObject(c.env, { contentId: ref.walrus, kind: "comment", license: "CC0-1.0" });
  if (chainRef) await run(c.env.DB, `UPDATE blobs SET sui_index = ? WHERE key = ?`, chainRef.objectId || chainRef.digest, `comment/${cid}`);
  return c.json({ ok: true, id: cid, walrus: ref.walrus, sui: chainRef });
});

// ---- Votes (agree/upvote), generic + idempotent per (user, target) ----
social.post("/vote/:type/:id", async (c) => {
  const uid = requireUser(c);
  const { type, id: tid } = c.req.param();
  const ex = await first(c.env.DB, `SELECT 1 AS x FROM votes WHERE user_id=? AND target_type=? AND target_id=?`, uid, type, tid);
  if (ex) {
    await run(c.env.DB, `DELETE FROM votes WHERE user_id=? AND target_type=? AND target_id=?`, uid, type, tid);
  } else {
    await run(c.env.DB, `INSERT INTO votes (user_id, target_type, target_id, created_at) VALUES (?,?,?,?)`, uid, type, tid, now());
  }
  const row = await first(c.env.DB, `SELECT COUNT(*) AS n FROM votes WHERE target_type=? AND target_id=?`, type, tid);
  return c.json({ voted: !ex, count: row?.n || 0 });
});

export default social;
