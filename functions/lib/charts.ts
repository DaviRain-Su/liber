import type { Env } from "./types";
import { all } from "./db";
import * as S from "./seed";

function windowSpan(win: string) {
  if (win === "today") return 864e5;
  if (win === "week") return 7 * 864e5;
  return 30 * 864e5;
}

function countMap(rows: Array<{ book_id: string; n: number }>) {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.book_id] = Number(row.n || 0);
  return out;
}

function seedCharts(win: string) {
  const base = S.CHARTS[win] || S.CHARTS.today || [];
  return {
    window: win,
    rows: base,
    surge: S.SURGE[win] || {},
    hotToday: S.CHARTS.hotToday,
    sentences: S.HOT_SENTENCES,
    source: "seed",
  };
}

export async function getCharts(env: Env, win = "today") {
  const books = await all<{ id: string; title: string; created_at: number }>(
    env.DB,
    `SELECT id, title, created_at FROM library_books ORDER BY created_at DESC LIMIT 200`,
  );
  if (!books.length) return seedCharts(win);

  const since = Date.now() - windowSpan(win);
  const [reads, lines, convos] = await Promise.all([
    all<{ book_id: string; n: number }>(
      env.DB,
      `SELECT book_id, COUNT(*) AS n FROM progress WHERE updated_at >= ? GROUP BY book_id`,
      since,
    ),
    all<{ book_id: string; n: number }>(
      env.DB,
      `SELECT book_id, COUNT(*) AS n FROM highlights WHERE created_at >= ? GROUP BY book_id`,
      since,
    ),
    all<{ book_id: string; n: number }>(
      env.DB,
      `SELECT book_id, COUNT(*) AS n FROM events WHERE created_at >= ? AND type = 'convo' GROUP BY book_id`,
      since,
    ),
  ]);
  const readMap = countMap(reads);
  const lineMap = countMap(lines);
  const convoMap = countMap(convos);
  const rows = books.map((b) => ({
    id: b.id,
    title: b.title,
    reads: readMap[b.id] || 0,
    lines: lineMap[b.id] || 0,
    convos: convoMap[b.id] || 0,
    delta: 0,
  }));
  rows.sort((a, b) => b.reads - a.reads || b.lines - a.lines || b.convos - a.convos);
  return { window: win, rows, surge: {}, hotToday: null, sentences: [], source: "library" };
}

