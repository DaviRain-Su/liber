import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first, run } from "../lib/db";
import { requireUser } from "../lib/auth";
import { relTime } from "../lib/time";

// User notifications feed (关注 / 回复 / 赞同 / 私信 / Agent).
const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

notifications.get("/", async (c) => {
  const uid = requireUser(c);
  const rows = await all<any>(
    c.env.DB,
    `SELECT id, kind, actor_id, actor_name, actor_color, text, book_id, target, created_at, read_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`,
    uid,
  );
  return c.json({
    notifications: rows.map((n) => ({
      id: n.id, kind: n.kind, who: n.actor_name || "读者", color: n.actor_color || "#3a4fb0",
      text: n.text, book: n.book_id || null, target: n.target || null, when: relTime(n.created_at),
      read: !!n.read_at, actorId: n.actor_id || null,
    })),
  });
});

notifications.get("/unread", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ unread: 0 });
  const r = await first<any>(c.env.DB, `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, uid);
  return c.json({ unread: Number(r?.n || 0) });
});

// Mark all read.
notifications.post("/read", async (c) => {
  const uid = requireUser(c);
  await run(c.env.DB, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, Date.now(), uid);
  return c.json({ ok: true });
});

// Mark one read.
notifications.post("/:id/read", async (c) => {
  const uid = requireUser(c);
  await run(c.env.DB, `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`, Date.now(), c.req.param("id"), uid);
  return c.json({ ok: true });
});

export default notifications;
