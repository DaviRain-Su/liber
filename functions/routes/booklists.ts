import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "../lib/types";
import { all, first, run, id, now } from "../lib/db";
import { requireUser } from "../lib/auth";

// 书单 (Booklists): user-curated, named collections of books, stored in D1 so
// they sync across devices. Public lists are shareable and forkable. The list
// endpoints return book *ids*; the frontend resolves full book metadata from
// its catalogue (seed + /api/books), exactly like the shelf already does.
const booklists = new Hono<{ Bindings: Env; Variables: Variables }>();

interface ListRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  visibility: string | null;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  owner_name?: string | null;
  owner_seal?: string | null;
  owner_color?: string | null;
}

interface ItemRow {
  booklist_id: string;
  book_id: string;
  note: string | null;
  title?: string | null;
}

function serializeList(r: ListRow, items: ItemRow[]) {
  return {
    id: r.id,
    name: r.name,
    desc: r.description || "",
    color: r.color || "ink",
    visibility: r.visibility || "public",
    owner: {
      id: r.user_id,
      userId: r.user_id,
      name: r.owner_name || "读者",
      seal: r.owner_seal || (r.owner_name ? r.owner_name.slice(0, 1) : "读"),
      color: r.owner_color || "#3a4fb0",
    },
    forkedFrom: r.parent_id || null,
    count: items.length,
    books: items.map((it) => it.book_id),
    items: items.map((it) => ({
      bookId: it.book_id,
      note: it.note || "",
      title: it.title || null,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Attach each list's books in one query (avoids N+1).
async function withItems(env: Env, rows: ListRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = await all<ItemRow>(
    env.DB,
    `SELECT bi.booklist_id, bi.book_id, bi.note, lb.title
     FROM booklist_items bi LEFT JOIN library_books lb ON lb.id = bi.book_id
     WHERE bi.booklist_id IN (${placeholders})
     ORDER BY bi.sort ASC, bi.created_at ASC`,
    ...ids,
  );
  const byList: Record<string, ItemRow[]> = {};
  for (const it of items) (byList[it.booklist_id] ||= []).push(it);
  return rows.map((r) => serializeList(r, byList[r.id] || []));
}

async function ownedList(c: any, blid: string): Promise<ListRow> {
  const uid = requireUser(c);
  const row = await first<ListRow>(c.env.DB, `SELECT * FROM booklists WHERE id = ?`, blid);
  if (!row) throw new HTTPException(404, { message: "未找到该书单" });
  if (row.user_id !== uid) throw new HTTPException(403, { message: "只能修改自己的书单" });
  return row;
}

// GET /booklists — the current user's lists. ?bookId= flags which already
// contain that book (for the "加入书单" picker).
booklists.get("/", async (c) => {
  const uid = requireUser(c);
  const rows = await all<ListRow>(
    c.env.DB,
    `SELECT b.*, u.name AS owner_name, u.seal AS owner_seal, u.color AS owner_color
     FROM booklists b JOIN users u ON u.id = b.user_id
     WHERE b.user_id = ? ORDER BY b.updated_at DESC`,
    uid,
  );
  const lists = await withItems(c.env, rows);
  const bookId = c.req.query("bookId");
  if (bookId) for (const l of lists) (l as any).has = l.books.includes(bookId);
  return c.json({ booklists: lists });
});

// POST /booklists — create a new list (optionally with an initial book).
booklists.post("/", async (c) => {
  const uid = requireUser(c);
  const b = await c.req.json().catch(() => ({}) as any);
  const name = String(b.name || "").trim();
  if (!name) return c.json({ error: "请填写书单名称" }, 400);
  const blid = id("bl_");
  const desc = String(b.desc ?? b.description ?? "").trim();
  await run(
    c.env.DB,
    `INSERT INTO booklists (id, user_id, name, description, color, visibility, parent_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    blid,
    uid,
    name.slice(0, 60),
    desc ? desc.slice(0, 200) : null,
    String(b.color || "ink"),
    b.visibility === "private" ? "private" : "public",
    null,
    now(),
    now(),
  );
  if (b.bookId) {
    await run(
      c.env.DB,
      `INSERT OR IGNORE INTO booklist_items (booklist_id, book_id, note, sort, created_at) VALUES (?,?,?,?,?)`,
      blid,
      String(b.bookId),
      b.note ? String(b.note) : null,
      0,
      now(),
    );
  }
  const row = await first<ListRow>(
    c.env.DB,
    `SELECT b.*, u.name AS owner_name, u.seal AS owner_seal, u.color AS owner_color
     FROM booklists b JOIN users u ON u.id = b.user_id WHERE b.id = ?`,
    blid,
  );
  const [list] = await withItems(c.env, row ? [row] : []);
  return c.json({ ok: true, booklist: list || null });
});

// GET /booklists/:id — view one list (owner always; others only if public).
booklists.get("/:id", async (c) => {
  const uid = c.get("userId");
  const row = await first<ListRow>(
    c.env.DB,
    `SELECT b.*, u.name AS owner_name, u.seal AS owner_seal, u.color AS owner_color
     FROM booklists b JOIN users u ON u.id = b.user_id WHERE b.id = ?`,
    c.req.param("id"),
  );
  if (!row) return c.json({ error: "未找到该书单" }, 404);
  const isOwner = !!uid && uid === row.user_id;
  if ((row.visibility || "public") === "private" && !isOwner) {
    return c.json({ error: "该书单未公开" }, 403);
  }
  const [list] = await withItems(c.env, [row]);
  let saved = false;
  if (uid) {
    saved = !!(await first(
      c.env.DB,
      `SELECT 1 AS x FROM booklist_saves WHERE user_id = ? AND booklist_id = ?`,
      uid,
      row.id,
    ));
  }
  return c.json({ booklist: { ...list, mine: isOwner, saved } });
});

// PUT /booklists/:id — rename / edit (owner only).
booklists.put("/:id", async (c) => {
  const row = await ownedList(c, c.req.param("id"));
  const b = await c.req.json().catch(() => ({}) as any);
  const name = b.name != null ? String(b.name).trim().slice(0, 60) : row.name;
  if (!name) return c.json({ error: "请填写书单名称" }, 400);
  const desc =
    b.desc != null || b.description != null
      ? String(b.desc ?? b.description)
          .trim()
          .slice(0, 200)
      : row.description || "";
  const color = b.color != null ? String(b.color) : row.color || "ink";
  const visibility =
    b.visibility != null
      ? b.visibility === "private"
        ? "private"
        : "public"
      : row.visibility || "public";
  await run(
    c.env.DB,
    `UPDATE booklists SET name = ?, description = ?, color = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    name,
    desc || null,
    color,
    visibility,
    now(),
    row.id,
  );
  return c.json({ ok: true });
});

// DELETE /booklists/:id — delete a list and its items/saves (owner only).
booklists.delete("/:id", async (c) => {
  const row = await ownedList(c, c.req.param("id"));
  await run(c.env.DB, `DELETE FROM booklist_items WHERE booklist_id = ?`, row.id);
  await run(c.env.DB, `DELETE FROM booklist_saves WHERE booklist_id = ?`, row.id);
  await run(c.env.DB, `DELETE FROM booklists WHERE id = ?`, row.id);
  return c.json({ ok: true });
});

// POST /booklists/:id/items — add a book to a list (owner only). Idempotent.
booklists.post("/:id/items", async (c) => {
  const row = await ownedList(c, c.req.param("id"));
  const b = await c.req.json().catch(() => ({}) as any);
  const bookId = String(b.bookId || "").trim();
  if (!bookId) return c.json({ error: "缺少 bookId" }, 400);
  const max = await first<{ m: number }>(
    c.env.DB,
    `SELECT MAX(sort) AS m FROM booklist_items WHERE booklist_id = ?`,
    row.id,
  );
  await run(
    c.env.DB,
    `INSERT INTO booklist_items (booklist_id, book_id, note, sort, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(booklist_id, book_id) DO UPDATE SET note = COALESCE(excluded.note, booklist_items.note)`,
    row.id,
    bookId,
    b.note ? String(b.note) : null,
    Number(max?.m || 0) + 1,
    now(),
  );
  await run(c.env.DB, `UPDATE booklists SET updated_at = ? WHERE id = ?`, now(), row.id);
  return c.json({ ok: true });
});

// DELETE /booklists/:id/items/:bookId — remove a book from a list (owner only).
booklists.delete("/:id/items/:bookId", async (c) => {
  const row = await ownedList(c, c.req.param("id"));
  await run(
    c.env.DB,
    `DELETE FROM booklist_items WHERE booklist_id = ? AND book_id = ?`,
    row.id,
    c.req.param("bookId"),
  );
  await run(c.env.DB, `UPDATE booklists SET updated_at = ? WHERE id = ?`, now(), row.id);
  return c.json({ ok: true });
});

// POST /booklists/:id/fork — copy a public list into your own.
booklists.post("/:id/fork", async (c) => {
  const uid = requireUser(c);
  const srcId = c.req.param("id");
  const src = await first<ListRow>(c.env.DB, `SELECT * FROM booklists WHERE id = ?`, srcId);
  if (!src) return c.json({ error: "未找到该书单" }, 404);
  if ((src.visibility || "public") === "private" && src.user_id !== uid) {
    return c.json({ error: "该书单未公开" }, 403);
  }
  const newId = id("bl_");
  await run(
    c.env.DB,
    `INSERT INTO booklists (id, user_id, name, description, color, visibility, parent_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    newId,
    uid,
    src.name,
    src.description,
    src.color || "ink",
    "public",
    srcId,
    now(),
    now(),
  );
  const items = await all<ItemRow & { sort: number }>(
    c.env.DB,
    `SELECT book_id, note, sort FROM booklist_items WHERE booklist_id = ? ORDER BY sort ASC, created_at ASC`,
    srcId,
  );
  for (const it of items) {
    await run(
      c.env.DB,
      `INSERT OR IGNORE INTO booklist_items (booklist_id, book_id, note, sort, created_at) VALUES (?,?,?,?,?)`,
      newId,
      it.book_id,
      it.note,
      it.sort,
      now(),
    );
  }
  return c.json({ ok: true, id: newId });
});

// POST /booklists/:id/save — collect / un-collect someone else's list (toggle).
booklists.post("/:id/save", async (c) => {
  const uid = requireUser(c);
  const blid = c.req.param("id");
  const exists = await first(
    c.env.DB,
    `SELECT 1 AS x FROM booklist_saves WHERE user_id = ? AND booklist_id = ?`,
    uid,
    blid,
  );
  if (exists) {
    await run(
      c.env.DB,
      `DELETE FROM booklist_saves WHERE user_id = ? AND booklist_id = ?`,
      uid,
      blid,
    );
    return c.json({ saved: false });
  }
  await run(
    c.env.DB,
    `INSERT INTO booklist_saves (user_id, booklist_id, created_at) VALUES (?,?,?)`,
    uid,
    blid,
    now(),
  );
  return c.json({ saved: true });
});

export default booklists;
