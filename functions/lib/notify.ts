import type { Env } from "./types";
import { run, first, id, now } from "./db";

// Drop a notification to a user. Best-effort: never notifies yourself, never
// throws (a failed notification must never break the action that triggered it).
export async function pushNotification(
  env: Env,
  n: {
    userId: string;
    kind: string; // follow | reply | agree | dm | agent
    actorId?: string | null;
    actorName?: string | null;
    actorColor?: string | null;
    text: string;
    bookId?: string | null;
    target?: string | null;
  },
): Promise<void> {
  try {
    if (!n.userId || n.userId === n.actorId) return;
    await run(
      env.DB,
      `INSERT INTO notifications (id, user_id, kind, actor_id, actor_name, actor_color, text, book_id, target, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id("nt_"),
      n.userId,
      n.kind,
      n.actorId || null,
      n.actorName || null,
      n.actorColor || null,
      String(n.text || "").slice(0, 200),
      n.bookId || null,
      n.target || null,
      now(),
    );
  } catch {
    /* notifications are best-effort */
  }
}

// Convenience: look up an actor's display fields, then push.
export async function notifyFrom(
  env: Env,
  actorId: string,
  n: {
    userId: string;
    kind: string;
    text: string;
    bookId?: string | null;
    target?: string | null;
  },
): Promise<void> {
  if (!n.userId || n.userId === actorId) return;
  const a = await first<any>(env.DB, `SELECT name, color FROM users WHERE id = ?`, actorId);
  await pushNotification(env, {
    ...n,
    actorId,
    actorName: a?.name || "读者",
    actorColor: a?.color || "#3a4fb0",
  });
}

// Owner of a comment/vote target, used to notify them on a reply/agree.
export async function targetOwnerId(
  env: Env,
  type: string,
  targetId: string,
): Promise<string | null> {
  const table: Record<string, string> = {
    share: "shares",
    work: "works",
    comment: "comments",
    note: "notes",
    reply: "thread_replies",
  };
  const t = table[type];
  if (!t) return null;
  try {
    const row = await first<any>(env.DB, `SELECT user_id FROM ${t} WHERE id = ?`, targetId);
    return row?.user_id || null;
  } catch {
    return null;
  }
}
