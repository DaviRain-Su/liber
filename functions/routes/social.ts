import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { getUser, requireUser, type UserRow } from "../lib/auth";
import { notifyFrom, targetOwnerId } from "../lib/notify";
import { putBlob } from "../lib/storage";
import { chain } from "../lib/chains";
import { getBook, getChapterText, hasLibraryBooks, textToChapter } from "../lib/catalog";
import { readingStats } from "../lib/reading-summary";
import { relTime } from "../lib/time";
import * as S from "../lib/seed";

// Co-reading & social: annotations, feed, shares, groups, threads, works.
// Every list endpoint merges seed baselines with live D1 rows.
const social = new Hono<{ Bindings: Env; Variables: Variables }>();

function shortWallet(wallet?: string | null): string {
  if (!wallet || wallet.startsWith("guest:")) return "未连接钱包";
  if (wallet.length <= 14) return wallet;
  return `${wallet.slice(0, 8)}...${wallet.slice(-6)}`;
}

function formatJoined(ms?: number | null): string {
  if (!ms) return "刚刚加入";
  return `${new Date(ms).toISOString().slice(0, 7)} 加入`;
}

// Trim + length-cap user-supplied text. Mirrors the comment-body cap (slice 4000)
// so create endpoints can't push unbounded bytes into D1/R2/Walrus.
const cap = (v: unknown, n: number) =>
  String(v ?? "")
    .trim()
    .slice(0, n);

function chapterNumberFromSid(sid?: string | null): number | null {
  const m = String(sid || "").match(/-c(\d+)-s\d+$/);
  return m ? Number(m[1]) : null;
}

async function countRows(env: Env, sql: string, ...params: unknown[]): Promise<number> {
  try {
    const row = await first<any>(env.DB, sql, ...params);
    return Number(row?.n || 0);
  } catch {
    return 0;
  }
}

async function isFollowing(
  env: Env,
  viewerId: string | null | undefined,
  targetId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === targetId) return false;
  try {
    return !!(await first(
      env.DB,
      `SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?`,
      viewerId,
      targetId,
    ));
  } catch {
    return false;
  }
}

async function publicReaderProfile(env: Env, user: UserRow) {
  const [stats, followerCount, followingCount, readingRows, noteRows] = await Promise.all([
    readingStats(env, user.id),
    countRows(env, `SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`, user.id),
    countRows(env, `SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`, user.id),
    all<any>(
      env.DB,
      `SELECT p.book_id, p.chapter_n, p.percent, p.updated_at, lb.title
       FROM progress p JOIN library_books lb ON lb.id = p.book_id
       WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 12`,
      user.id,
    ),
    all<any>(
      env.DB,
      `SELECT n.book_id, n.sid, n.text, n.up, n.created_at, lb.title
       FROM notes n JOIN library_books lb ON lb.id = n.book_id
       WHERE n.user_id = ? AND n.public = 1 ORDER BY n.created_at DESC LIMIT 20`,
      user.id,
    ),
  ]);

  const chapterCache = new Map<string, Promise<any | null>>();
  const sentenceFor = async (bookId: string, sid: string) => {
    const n = chapterNumberFromSid(sid);
    if (!n) return { text: sid, chap: "" };
    const key = `${bookId}:${n}`;
    if (!chapterCache.has(key)) {
      chapterCache.set(
        key,
        (async () => {
          const content = await getChapterText(env, bookId, n);
          return content ? textToChapter(bookId, content.n, content.title, content.text) : null;
        })(),
      );
    }
    const ch = await chapterCache.get(key);
    const sentence = ch?.paras?.flat?.().find((s: any) => s.id === sid);
    return { text: sentence?.t || sid, chap: ch ? `第 ${ch.n} 章 · ${ch.title}` : `第 ${n} 章` };
  };

  const publicNotes: any[] = [];
  for (const n of noteRows) {
    const sentence = await sentenceFor(n.book_id, n.sid);
    publicNotes.push({
      q: sentence.text,
      t: n.text,
      bookId: n.book_id,
      book: n.title || n.book_id,
      chap: sentence.chap,
      when: relTime(n.created_at),
      up: n.up || 0,
      createdAt: n.created_at,
    });
  }

  const reading = readingRows.map((p) => ({
    id: p.book_id,
    at: p.chapter_n
      ? `第 ${p.chapter_n} 章 · ${Math.round(Number(p.percent || 0))}%`
      : `${Math.round(Number(p.percent || 0))}%`,
    chapter: p.chapter_n,
    percent: Number(p.percent || 0),
    updatedAt: p.updated_at,
  }));

  const name = user.name || "读者";
  return {
    id: user.id,
    userId: user.id,
    name,
    handle:
      user.handle ||
      (user.sui_address ? `@${user.sui_address.slice(0, 8)}` : `@${user.id.slice(0, 8)}`),
    color: user.color || "#3a4fb0",
    seal: user.seal || name.slice(0, 1) || "读",
    bio: user.bio || "正在 Liber 阅读真实入库的 CC0 图书。",
    joined: formatJoined(user.created_at),
    wallet: shortWallet(user.sui_address),
    stats: { ...stats, followers: followerCount, following: followingCount },
    reading,
    finished: reading.filter((r) => Number(r.percent || 0) >= 100).map((r) => r.id),
    publicNotes,
  };
}

// Count agree-votes for ONLY the target ids on the page, so the hot list
// endpoints don't GROUP BY the entire votes table on every load.
async function voteCountsFor(
  env: Env,
  type: string,
  ids: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const q = ids.map(() => "?").join(",");
  try {
    for (const v of await all<any>(
      env.DB,
      `SELECT target_id, COUNT(*) AS n FROM votes WHERE target_type = ? AND target_id IN (${q}) GROUP BY target_id`,
      type,
      ...ids,
    ))
      out[v.target_id] = v.n;
  } catch {
    /* votes table may predate migration 0002 */
  }
  return out;
}

// Build the full payload for MANY groups in a fixed number of grouped queries
// (not ~6 per group), so /api/groups stays sub-second as the catalogue grows.
// substr(group_id, 6) strips the "live-" prefix → the group's book_id, letting
// the per-(group, book) joins run once across every group.
async function buildLiveGroupsBatch(env: Env, books: any[], userId?: string | null) {
  if (!books.length) return [];
  const gids = books.map((b) => `live-${b.id}`);
  const bookIds = books.map((b) => b.id);
  const gp = gids.map(() => "?").join(",");
  const bp = bookIds.map(() => "?").join(",");
  // One D1 batch = ONE round-trip for all aggregates (Promise.all over separate
  // .all() calls serialises on D1's single connection).
  const res = await env.DB.batch([
    env.DB.prepare(
      `SELECT gm.group_id, u.name, u.color, u.seal, gm.user_id FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id IN (${gp}) ORDER BY gm.joined_at ASC`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT group_id, COUNT(*) AS n FROM group_members WHERE group_id IN (${gp}) GROUP BY group_id`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT group_id, COUNT(*) AS n FROM group_posts WHERE group_id IN (${gp}) GROUP BY group_id`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT gm.group_id, p.percent FROM group_members gm JOIN progress p ON p.user_id = gm.user_id WHERE gm.group_id IN (${gp}) AND p.book_id = substr(gm.group_id, 6)`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT gm.group_id, COUNT(*) AS n FROM group_members gm JOIN notes nt ON nt.user_id = gm.user_id WHERE gm.group_id IN (${gp}) AND nt.book_id = substr(gm.group_id, 6) GROUP BY gm.group_id`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT gm.group_id, COUNT(*) AS n FROM group_members gm JOIN highlights h ON h.user_id = gm.user_id WHERE gm.group_id IN (${gp}) AND h.book_id = substr(gm.group_id, 6) GROUP BY gm.group_id`,
    ).bind(...gids),
    env.DB.prepare(
      `SELECT book_id, n, title FROM library_chapters WHERE book_id IN (${bp}) ORDER BY book_id, n`,
    ).bind(...bookIds),
  ]);
  const [members, memberCounts, postCounts, progress, noteCounts, hlCounts, chapters] = res.map(
    (r: any) => (r.results || []) as any[],
  );
  const listBy = (rows: any[], key: string) => {
    const m: Record<string, any[]> = {};
    for (const r of rows) (m[r[key]] ||= []).push(r);
    return m;
  };
  const numBy = (rows: any[], key: string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r[key]] = Number(r.n || 0);
    return m;
  };
  const membersByG = listBy(members, "group_id");
  const memberCountByG = numBy(memberCounts, "group_id");
  const postCountByG = numBy(postCounts, "group_id");
  const progressByG = listBy(progress, "group_id");
  const noteByG = numBy(noteCounts, "group_id");
  const hlByG = numBy(hlCounts, "group_id");
  const tocByBook = listBy(chapters, "book_id");
  return books.map((b) => {
    const gid = `live-${b.id}`;
    const memberRows = (membersByG[gid] || []).slice(0, 8);
    const progressRows = progressByG[gid] || [];
    const toc = (tocByBook[b.id] || []).map((r) => ({ n: r.n, title: r.title }));
    const progressPct = progressRows.length
      ? Math.round(
          progressRows.reduce((sum, r) => sum + Number(r.percent || 0), 0) / progressRows.length,
        )
      : 0;
    const annos = (noteByG[gid] || 0) + (hlByG[gid] || 0);
    const first = toc[0];
    const next = toc[Math.min(2, Math.max(0, toc.length - 1))];
    return {
      id: gid,
      name: `《${b.t}》共读`,
      color: "#1f8a5b",
      seal: b.seal || "读",
      book: b.id,
      bookT: b.t,
      desc: "围绕真实入库文本的共读小组。成员、讨论、批注和进度都来自线上数据。",
      members: Number(memberCountByG[gid] || memberRows.length),
      joined: !!userId && memberRows.some((m) => m.user_id === userId),
      lead: memberRows[0]?.name || "",
      weekRange: first && next ? `${first.title} — ${next.title}` : first?.title || "从第一章开始",
      progressPct,
      annos,
      posts: postCountByG[gid] || 0,
      memberAvatars: memberRows.map((m) => ({
        userId: m.user_id,
        name: m.name || "读者",
        n: m.seal || String(m.name || "读")[0],
        c: m.color || "#3a4fb0",
      })),
      schedule: toc.slice(0, 5).map((t, i) => ({
        wk: i === 0 ? "开始" : `第 ${i + 1} 节`,
        chap: t.title,
        state: i === 0 ? "current" : "upcoming",
      })),
      discussion: [],
      topAnno: null,
    };
  });
}

const GROUPS_CARDS_KEY = "groups:cards:v1";

// Build the full ranked set of user-INDEPENDENT group cards (joined=null baked
// to false). This is the expensive path: a books/active-groups batch + the 7-query
// buildLiveGroupsBatch. Cached whole-list under one KV key so the hot path avoids
// re-running ANY of it on a warm hit.
async function buildGroupsCards(env: Env) {
  // Only id/title/seal are needed here — NOT the reads/liners aggregates that
  // listBooks computes. Run the book list and the two "which groups are active"
  // scans in parallel (one round-trip) instead of sequentially.
  const [bRes, mRes, pRes] = await env.DB.batch([
    env.DB.prepare(`SELECT id, title, seal FROM library_books ORDER BY created_at DESC LIMIT 300`),
    env.DB.prepare(`SELECT DISTINCT group_id FROM group_members`),
    env.DB.prepare(`SELECT DISTINCT group_id FROM group_posts`),
  ]);
  const books = ((bRes as any).results || []) as any[];
  const memberGroups = ((mRes as any).results || []) as any[];
  const postGroups = ((pRes as any).results || []) as any[];
  if (!books.length) return [];
  const liveBooks = books.map((r) => ({ id: r.id, t: r.title, seal: r.seal }));
  const active = new Set<string>([...memberGroups, ...postGroups].map((r: any) => r.group_id));
  // Prioritise groups that actually have members/posts, fill up to a cap with
  // recent books, and build them all in a few batched queries.
  const ranked = [
    ...liveBooks.filter((b) => active.has(`live-${b.id}`)),
    ...liveBooks.filter((b) => !active.has(`live-${b.id}`)),
  ].slice(0, 24);
  return buildLiveGroupsBatch(env, ranked, null);
}

async function liveGroups(env: Env, userId?: string | null) {
  // Warm path = ONE KV.get (whole-list, 60s — KV's TTL floor): no book scan, no
  // 7-query build. Only the per-user `joined` is resolved live (below) so the cache
  // can stay user-independent. Cold/corrupt → rebuild + cache (awaited; an
  // un-awaited KV.put is cancelled when the response returns).
  let cards: any[] | null = null;
  try {
    const raw = await env.KV.get(GROUPS_CARDS_KEY);
    if (raw) cards = JSON.parse(raw);
  } catch {
    cards = null;
  }
  if (!Array.isArray(cards)) {
    cards = await buildGroupsCards(env);
    await env.KV.put(GROUPS_CARDS_KEY, JSON.stringify(cards), { expirationTtl: 60 }).catch(
      () => {},
    );
  }
  if (!cards.length) return [];
  // `joined` must stay accurate even on a cache hit, so resolve the viewer's
  // memberships fresh in one bounded, indexed query (cheap) rather than caching
  // per-user. Without a viewer, every card is simply not-joined.
  let joined = new Set<string>();
  if (userId) {
    const gids = cards.map((c) => c.id);
    try {
      const rows = await all<any>(
        env.DB,
        `SELECT group_id FROM group_members WHERE user_id = ? AND group_id IN (${gids.map(() => "?").join(",")})`,
        userId,
        ...gids,
      );
      joined = new Set(rows.map((r) => r.group_id));
    } catch {
      /* leave empty on a transient error → conservative not-joined */
    }
  }
  return cards.map((c) => ({ ...c, joined: joined.has(c.id) }));
}

async function liveFeed(env: Env) {
  const [notes, shares, posts] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT n.id, n.sid, n.text, n.up, n.created_at, n.book_id, n.user_id, lb.title AS book_title, u.name, u.color
       FROM notes n JOIN users u ON u.id = n.user_id
       LEFT JOIN library_books lb ON lb.id = n.book_id
       WHERE n.public = 1 ORDER BY n.created_at DESC LIMIT 20`,
    ),
    all<any>(
      env.DB,
      `SELECT s.id, s.title, s.quote, s.book_id, s.user_id, s.created_at, lb.title AS book_title, u.name, u.color
       FROM shares s JOIN users u ON u.id = s.user_id
       LEFT JOIN library_books lb ON lb.id = s.book_id
       WHERE s.visibility = 'public' ORDER BY s.created_at DESC LIMIT 20`,
    ),
    all<any>(
      env.DB,
      `SELECT gp.id, gp.group_id, gp.text, gp.chap, gp.up, gp.user_id, gp.created_at, u.name, u.color
       FROM group_posts gp JOIN users u ON u.id = gp.user_id
       ORDER BY gp.created_at DESC LIMIT 20`,
    ),
  ]);
  // Live agree counts — the votes table is the source of truth (the denormalized
  // s.agree column is never incremented), so the feed must merge it the same way
  // /shares does, or shared conversations always render 0 upvotes.
  const shareVotes = await voteCountsFor(
    env,
    "share",
    shares.map((s) => s.id),
  );
  // Each item carries a STABLE threadKey so the discussion overlay opens a real,
  // per-item thread (the root is the item itself; replies are live thread_replies)
  // instead of a shared seed thread.
  const items: any[] = [
    ...notes.map((n) => {
      const cn = chapterNumberFromSid(n.sid);
      return {
        kind: "anno",
        id: `note:${n.id}`,
        threadKey: `note:${n.id}`,
        userId: n.user_id,
        u: n.name || "读者",
        color: n.color || "#3a4fb0",
        book: n.book_title || n.book_id,
        bookId: n.book_id,
        sid: n.sid,
        chap: cn ? `第 ${cn} 章` : "",
        t: n.text,
        up: n.up || 0,
        replies: 0,
        when: relTime(n.created_at),
        createdAt: n.created_at,
      };
    }),
    ...shares.map((s) => ({
      kind: "convo",
      id: `share:${s.id}`,
      threadKey: `share:${s.id}`,
      userId: s.user_id,
      u: s.name || "读者",
      color: s.color || "#3a4fb0",
      book: s.book_title || s.book_id,
      title: s.title || "分享了一段阅读对话",
      quote: s.quote,
      up: shareVotes[s.id] || 0,
      saved: 0,
      replies: 0,
      when: relTime(s.created_at),
      createdAt: s.created_at,
    })),
    ...posts.map((p) => ({
      kind: "group",
      id: `gpost:${p.id}`,
      threadKey: `gpost:${p.id}`,
      userId: p.user_id,
      u: p.name || "读者",
      color: p.color || "#3a4fb0",
      groupId: p.group_id,
      t: p.text,
      chap: p.chap || "",
      up: p.up || 0,
      members: 0,
      replies: 0,
      when: relTime(p.created_at),
      createdAt: p.created_at,
    })),
  ]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 30);
  // Real reply counts, bounded to the visible items' thread keys.
  const keys = items.map((it) => it.threadKey);
  if (keys.length) {
    try {
      const counts: Record<string, number> = {};
      for (const r of await all<any>(
        env.DB,
        `SELECT thread_key, COUNT(*) AS n FROM thread_replies WHERE thread_key IN (${keys.map(() => "?").join(",")}) GROUP BY thread_key`,
        ...keys,
      ))
        counts[r.thread_key] = Number(r.n || 0);
      for (const it of items) it.replies = counts[it.threadKey] || 0;
    } catch {
      /* thread_replies may predate migration 0002 — leave replies at 0 */
    }
  }
  return items;
}

social.get("/readers", async (c) => {
  const rows = await all<UserRow>(
    c.env.DB,
    `SELECT * FROM users WHERE is_guest = 0 ORDER BY created_at DESC LIMIT 80`,
  );
  const readers = await Promise.all(rows.map((u) => publicReaderProfile(c.env, u)));
  return c.json({ readers });
});

social.get("/readers/following", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ readers: [] });
  const rows = await all<UserRow>(
    c.env.DB,
    `SELECT u.*
     FROM follows f JOIN users u ON u.id = f.followee_id
     WHERE f.follower_id = ? AND u.is_guest = 0
     ORDER BY f.created_at DESC LIMIT 100`,
    uid,
  );
  const readers = await Promise.all(rows.map((u) => publicReaderProfile(c.env, u)));
  return c.json({ readers });
});

social.get("/readers/:id", async (c) => {
  const user = await getUser(c.env, c.req.param("id"));
  if (!user || user.is_guest) return c.json({ error: "没有找到这位读者" }, 404);
  return c.json({
    person: await publicReaderProfile(c.env, user),
    following: await isFollowing(c.env, c.get("userId"), user.id),
  });
});

social.post("/readers/:id/follow", async (c) => {
  const uid = requireUser(c);
  const targetId = c.req.param("id");
  if (uid === targetId) return c.json({ error: "不能关注自己" }, 400);
  const target = await getUser(c.env, targetId);
  if (!target || target.is_guest) return c.json({ error: "没有找到这位读者" }, 404);
  const exists = await first(
    c.env.DB,
    `SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?`,
    uid,
    targetId,
  );
  if (exists) {
    await run(
      c.env.DB,
      `DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`,
      uid,
      targetId,
    );
  } else {
    await run(
      c.env.DB,
      `INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)`,
      uid,
      targetId,
      now(),
    );
    await notifyFrom(c.env, uid, { userId: targetId, kind: "follow", text: "关注了你" });
  }
  return c.json({
    following: !exists,
    followerCount: await countRows(
      c.env,
      `SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`,
      targetId,
    ),
    followingCount: await countRows(
      c.env,
      `SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`,
      targetId,
    ),
  });
});

// others' annotations on a sentence = seed + public D1 notes (all users)
social.get("/annotations/:bookId/:sid", async (c) => {
  const { bookId, sid } = c.req.param();
  const dynamicOnly = await hasLibraryBooks(c.env);
  const seedAnnos = dynamicOnly ? [] : S.ANNOTATIONS[sid] || [];
  const rows = await all(
    c.env.DB,
    `SELECT n.text, n.color, n.up, n.user_id, u.name FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.book_id = ? AND n.sid = ? AND n.public = 1 ORDER BY n.created_at DESC LIMIT 50`,
    bookId,
    sid,
  );
  const extra = rows.map((r) => ({
    userId: r.user_id,
    u: r.name || "读者",
    color: r.color || "#3a4fb0",
    t: r.text,
    up: r.up || 0,
    replies: 0,
  }));
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
    `SELECT s.*, lb.title AS book_title, u.name AS author_name, u.seal AS author_seal, u.color AS author_color
     FROM shares s JOIN users u ON u.id = s.user_id
     LEFT JOIN library_books lb ON lb.id = s.book_id
     WHERE s.visibility = 'public' ORDER BY s.created_at DESC LIMIT 50`,
  );
  // real aggregate counts for share cards: comments, saves, agree (votes).
  // Bound every aggregate to ONLY the visible share ids (IN (...)) instead of a
  // GROUP BY over the whole comments/convo_saves tables — same pattern as
  // voteCountsFor — so this stays cheap as those tables grow.
  const shareIds = rows.map((r: any) => r.id);
  const inQ = shareIds.map(() => "?").join(",");
  const cmtCounts: Record<string, number> = {};
  const saveCounts: Record<string, number> = {};
  if (shareIds.length) {
    try {
      for (const r2 of await all(
        c.env.DB,
        `SELECT target_id, COUNT(*) AS n FROM comments WHERE target_type='share' AND target_id IN (${inQ}) GROUP BY target_id`,
        ...shareIds,
      ))
        cmtCounts[r2.target_id] = r2.n;
    } catch {
      // Older D1 databases may not have 0002 yet; don't take down /shares.
    }
    try {
      for (const r2 of await all(
        c.env.DB,
        `SELECT share_id, COUNT(*) AS n FROM convo_saves WHERE share_id IN (${inQ}) GROUP BY share_id`,
        ...shareIds,
      ))
        saveCounts[r2.share_id] = r2.n;
    } catch {
      /* convo_saves may predate its migration; counts default to 0 */
    }
  }
  const voteCounts = await voteCountsFor(c.env, "share", shareIds);

  const byId: Record<string, any> = {};
  const children: Record<string, any[]> = {};
  for (const r of rows) {
    let data: any = {};
    try {
      data = JSON.parse(r.data || "{}");
    } catch {
      /* corrupt row — skip its data */
    }
    byId[r.id] = {
      id: r.id,
      parent: r.parent_id || null,
      form: r.form,
      book: r.book_id,
      bookT: r.book_title || S.bookById(r.book_id)?.t || "",
      seal: data.seal || r.author_seal || "道",
      chap: data.chap || "",
      quote: r.quote,
      sid: r.sid,
      title: r.title,
      insight: r.insight,
      author: {
        id: r.user_id,
        userId: r.user_id,
        name: r.author_name,
        ava: r.author_seal || "读",
        color: r.author_color || "#3a4fb0",
      },
      agree: (r.agree || 0) + (voteCounts[r.id] || 0),
      comments: cmtCounts[r.id] || 0,
      saves: saveCounts[r.id] || 0,
      when: "刚刚",
      msgs: data.msgs || [],
      mine: r.user_id === mine,
    };
    if (r.parent_id) (children[r.parent_id] ||= []).push(r.id);
  }
  // a published fork rendered as a tree node (matches the client ForkTree shape)
  const toNode = (cid: string): any => {
    const c2 = byId[cid];
    const kids = (children[cid] || []).map(toNode);
    const q = (c2.msgs.find((m: any) => m.r === "q") || {}).t || c2.title || c2.insight || "";
    return {
      id: c2.id,
      userId: c2.author.id,
      name: c2.author.name,
      ava: c2.author.ava,
      color: c2.author.color,
      q,
      agree: c2.agree,
      forks: kids.length,
      children: kids,
    };
  };
  const descendants = (cid: string): number =>
    (children[cid] || []).reduce((s, k) => s + 1 + descendants(k), 0);
  // top-level cards = roots only; their forks nest as a real tree that grows with each continuation
  const published = rows
    .filter((r) => !r.parent_id || !byId[r.parent_id])
    .map((r) => ({
      ...byId[r.id],
      forks: descendants(r.id),
      tree: (children[r.id] || []).map(toNode),
    }));
  if (await hasLibraryBooks(c.env)) return c.json({ shares: published });
  return c.json({ shares: [...published, ...S.SHARED_CONVOS] });
});

social.post("/shares", async (c) => {
  const uid = requireUser(c);
  const b = await c.req.json();
  const sid = id("sh_");
  // Bound the conversation payload: cap message count and per-field text, then a
  // hard total-size guard, so one share can't push unbounded bytes downstream.
  const msgs = (Array.isArray(b.msgs) ? b.msgs : [])
    .slice(0, 100)
    .map((m: any) => ({ ...m, r: cap(m?.r, 16), t: cap(m?.t, 4000) }));
  const data = JSON.stringify({ msgs, chap: cap(b.chap, 200), seal: cap(b.seal, 16) });
  if (data.length > 200000) return c.json({ error: "内容过长" }, 413);
  await run(
    c.env.DB,
    `INSERT INTO shares (id, user_id, book_id, sid, form, title, insight, quote, visibility, parent_id, data, agree, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    sid,
    uid,
    b.bookId || null,
    b.sid || null,
    cap(b.form, 32) || "card",
    cap(b.title, 500) || null,
    cap(b.insight, 4000) || null,
    cap(b.quote, 2000) || null,
    b.visibility === "private" ? "private" : "public",
    b.parentId || null,
    data,
    now(),
  );
  // persist the shared conversation as a content-addressed blob (Walrus when configured, R2 always)
  const ref = await putBlob(c.env, `share/${sid}`, data, "application/json");
  // register on Sui when configured (no-op otherwise); record the real digest/objectId
  const chainRef = await chain(c.env).registerObject(c.env, {
    contentId: ref.walrus,
    kind: "conversation",
    license: "CC0-1.0",
  });
  if (chainRef)
    await run(
      c.env.DB,
      `UPDATE blobs SET sui_index = ? WHERE key = ?`,
      chainRef.objectId || chainRef.digest,
      `share/${sid}`,
    );
  return c.json({ ok: true, id: sid, walrus: ref.walrus, sui: chainRef });
});

social.post("/shares/:id/save", async (c) => {
  const uid = requireUser(c);
  const sid = c.req.param("id");
  const exists = await first(
    c.env.DB,
    `SELECT 1 AS x FROM convo_saves WHERE user_id = ? AND share_id = ?`,
    uid,
    sid,
  );
  if (exists) {
    await run(c.env.DB, `DELETE FROM convo_saves WHERE user_id = ? AND share_id = ?`, uid, sid);
    return c.json({ saved: false });
  }
  await run(c.env.DB, `INSERT INTO convo_saves (user_id, share_id) VALUES (?,?)`, uid, sid);
  return c.json({ saved: true });
});

social.get("/groups", async (c) => {
  if (await hasLibraryBooks(c.env))
    return c.json({ groups: await liveGroups(c.env, c.get("userId")) });
  return c.json({ groups: S.GROUPS });
});

social.get("/groups/:id", async (c) => {
  const dynamicOnly = await hasLibraryBooks(c.env);
  let g: any;
  if (dynamicOnly) {
    // Load ONLY the requested group's book, not every group's full payload.
    const b = await getBook(c.env, c.req.param("id").replace(/^live-/, ""));
    g = b?.dynamic ? (await buildLiveGroupsBatch(c.env, [b], c.get("userId")))[0] : undefined;
  } else {
    g = S.GROUPS.find((x) => x.id === c.req.param("id")) || S.GROUPS[0];
  }
  if (!g) return c.json({ error: "未找到共读小组" }, 404);
  const posts = await all(
    c.env.DB,
    `SELECT gp.text, gp.chap, gp.up, gp.user_id, gp.created_at, u.name, u.color FROM group_posts gp JOIN users u ON u.id = gp.user_id
     WHERE gp.group_id = ? ORDER BY gp.created_at DESC LIMIT 50`,
    g.id,
  );
  const mine = c.get("userId");
  const extra = posts.map((p) => ({
    userId: p.user_id,
    u: p.name || "读者",
    color: p.color || "#3a4fb0",
    when: relTime(p.created_at),
    chap: p.chap,
    t: p.text,
    up: p.up || 0,
    replies: 0,
    mine: p.user_id === mine,
  }));
  return c.json({ group: { ...g, discussion: [...extra, ...(dynamicOnly ? [] : g.discussion)] } });
});

social.post("/groups/:id/posts", async (c) => {
  const uid = requireUser(c);
  const gid = c.req.param("id");
  const { text, chap } = await c.req.json();
  const body = cap(text, 4000);
  if (!body) return c.json({ error: "内容为空" }, 400);
  const pid = id("gp_");
  await run(
    c.env.DB,
    `INSERT INTO group_posts (id, group_id, user_id, text, chap, up, created_at) VALUES (?,?,?,?,?,0,?)`,
    pid,
    gid,
    uid,
    body,
    cap(chap, 200) || null,
    now(),
  );
  return c.json({ ok: true, id: pid });
});

social.post("/groups/:id/join", async (c) => {
  const uid = requireUser(c);
  const gid = c.req.param("id");
  const ex = await first(
    c.env.DB,
    `SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?`,
    gid,
    uid,
  );
  if (ex) {
    await run(c.env.DB, `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, gid, uid);
    return c.json({ joined: false });
  }
  await run(
    c.env.DB,
    `INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?,?,?)`,
    gid,
    uid,
    now(),
  );
  return c.json({ joined: true });
});

social.get("/threads/:key", async (c) => {
  const replies = await all(
    c.env.DB,
    `SELECT tr.text, tr.up, tr.user_id, tr.created_at, u.name, u.color FROM thread_replies tr JOIN users u ON u.id = tr.user_id
     WHERE tr.thread_key = ? ORDER BY tr.created_at ASC`,
    c.req.param("key"),
  );
  const mine = c.get("userId");
  // Replies only — the discussion root is the real feed item the client opened,
  // not a seed thread.
  return c.json({
    replies: replies.map((r) => ({
      userId: r.user_id,
      u: r.name,
      color: r.color,
      when: relTime(r.created_at),
      t: r.text,
      up: r.up || 0,
      mine: r.user_id === mine,
    })),
  });
});

social.post("/threads/:key", async (c) => {
  const uid = requireUser(c);
  const { text } = await c.req.json();
  const body = cap(text, 4000);
  if (!body) return c.json({ error: "内容为空" }, 400);
  await run(
    c.env.DB,
    `INSERT INTO thread_replies (id, thread_key, user_id, text, up, created_at) VALUES (?,?,?,?,0,?)`,
    id("tr_"),
    c.req.param("key"),
    uid,
    body,
    now(),
  );
  return c.json({ ok: true });
});

social.get("/works", async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT w.id, w.title, w.body, w.addr, w.license, w.cited, w.created_at, u.name FROM works w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 50`,
  );
  return c.json({ works: rows });
});

social.post("/works", async (c) => {
  const uid = requireUser(c);
  const { title, body } = await c.req.json();
  const text = cap(body, 50000); // essays can be long, but not unbounded (~50KB)
  if (!text) return c.json({ error: "内容为空" }, 400);
  const heading = cap(title, 200) || "未命名导读";
  const wid = id("w_");
  // store the essay as a content-addressed blob (Walrus when configured, R2 always)
  const ref = await putBlob(c.env, `work/${wid}`, text, "text/markdown");
  await run(
    c.env.DB,
    `INSERT INTO works (id, user_id, title, body, addr, license, cited, created_at) VALUES (?,?,?,?,?,?,0,?)`,
    wid,
    uid,
    heading,
    text,
    `liber://work/${wid}`,
    "CC0-1.0",
    now(),
  );
  // register the CC0 work on Sui when configured (no-op otherwise)
  const chainRef = await chain(c.env).registerObject(c.env, {
    contentId: ref.walrus,
    kind: "work",
    license: "CC0-1.0",
  });
  if (chainRef)
    await run(
      c.env.DB,
      `UPDATE blobs SET sui_index = ? WHERE key = ?`,
      chainRef.objectId || chainRef.digest,
      `work/${wid}`,
    );
  return c.json({
    ok: true,
    id: wid,
    addr: `liber://work/${wid}`,
    walrus: ref.walrus,
    arweave: ref.arweave,
    sui: chainRef,
  });
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
    type,
    tid,
  );
  const mine = c.get("userId");
  // Merge live vote counts: comment upvotes are cast via /vote/comment/:id into
  // the votes table; the comments.up column is never incremented, so without
  // this every comment renders 0 regardless of real votes.
  const voteCounts = await voteCountsFor(
    c.env,
    "comment",
    rows.map((r) => r.id),
  );
  return c.json({
    comments: rows.map((r) => ({
      id: r.id,
      u: r.name || "读者",
      color: r.color || "#3a4fb0",
      seal: r.seal || "读",
      userId: r.user_id,
      t: r.text,
      up: (r.up || 0) + (voteCounts[r.id] || 0),
      when: relTime(r.created_at),
      mine: r.user_id === mine,
      walrus: r.walrus || null,
    })),
  });
});

// Allowed comment/vote target types — reject fabricated types so junk rows
// can't accumulate against arbitrary ids.
const SOCIAL_TARGET_TYPES = new Set(["share", "comment", "work", "book", "note", "group", "reply"]);

social.post("/comments/:type/:id", async (c) => {
  const uid = requireUser(c);
  const { type, id: tid } = c.req.param();
  if (!SOCIAL_TARGET_TYPES.has(type)) return c.json({ error: "无效的评论目标类型" }, 400);
  const { text } = await c.req.json();
  const body = (text || "").trim().slice(0, 4000);
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
    cid,
    type,
    tid,
    uid,
    body,
    ref.walrus,
    now(),
  );
  // register the comment on Sui when configured (no-op otherwise); record the digest/objectId
  const chainRef = await chain(c.env).registerObject(c.env, {
    contentId: ref.walrus,
    kind: "comment",
    license: "CC0-1.0",
  });
  if (chainRef)
    await run(
      c.env.DB,
      `UPDATE blobs SET sui_index = ? WHERE key = ?`,
      chainRef.objectId || chainRef.digest,
      `comment/${cid}`,
    );
  // notify the thing's owner that someone replied
  const ownerId = await targetOwnerId(c.env, type, tid);
  if (ownerId)
    await notifyFrom(c.env, uid, {
      userId: ownerId,
      kind: "reply",
      text: `回复了你：${body.slice(0, 40)}`,
      target: tid,
    });
  return c.json({ ok: true, id: cid, walrus: ref.walrus, sui: chainRef });
});

// ---- Votes (agree/upvote), generic + idempotent per (user, target) ----
social.post("/vote/:type/:id", async (c) => {
  const uid = requireUser(c);
  const { type, id: tid } = c.req.param();
  if (!SOCIAL_TARGET_TYPES.has(type)) return c.json({ error: "无效的投票目标类型" }, 400);
  const ex = await first(
    c.env.DB,
    `SELECT 1 AS x FROM votes WHERE user_id=? AND target_type=? AND target_id=?`,
    uid,
    type,
    tid,
  );
  if (ex) {
    await run(
      c.env.DB,
      `DELETE FROM votes WHERE user_id=? AND target_type=? AND target_id=?`,
      uid,
      type,
      tid,
    );
  } else {
    await run(
      c.env.DB,
      `INSERT INTO votes (user_id, target_type, target_id, created_at) VALUES (?,?,?,?)`,
      uid,
      type,
      tid,
      now(),
    );
    const ownerId = await targetOwnerId(c.env, type, tid);
    if (ownerId)
      await notifyFrom(c.env, uid, {
        userId: ownerId,
        kind: "agree",
        text: "赞同了你",
        target: tid,
      });
  }
  const row = await first(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM votes WHERE target_type=? AND target_id=?`,
    type,
    tid,
  );
  return c.json({ voted: !ex, count: row?.n || 0 });
});

export default social;
