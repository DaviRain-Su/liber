import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all } from "../lib/db";
import * as S from "../lib/seed";

// Open rankings — seed baselines overlaid with live D1 event signals.
const charts = new Hono<{ Bindings: Env; Variables: Variables }>();

charts.get("/", async (c) => {
  const win = c.req.query("window") || "today";
  const base = S.CHARTS[win] || S.CHARTS.today || [];
  const span = win === "today" ? 864e5 : win === "week" ? 7 * 864e5 : 30 * 864e5;
  const since = Date.now() - span;
  const ev = await all(c.env.DB, `SELECT book_id, type, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY book_id, type`, since);
  const add: Record<string, { reads: number; lines: number; convos: number }> = {};
  for (const e of ev) {
    const a = (add[e.book_id] ||= { reads: 0, lines: 0, convos: 0 });
    if (e.type === "line") a.lines += e.n;
    else if (e.type === "convo") a.convos += e.n;
    else if (e.type === "read") a.reads += e.n;
  }
  const rows = base.map((r: any) => ({
    ...r,
    reads: r.reads + (add[r.id]?.reads || 0),
    lines: r.lines + (add[r.id]?.lines || 0),
    convos: r.convos + (add[r.id]?.convos || 0),
  }));
  return c.json({ window: win, rows, surge: S.SURGE[win] || {}, hotToday: S.CHARTS.hotToday, sentences: S.HOT_SENTENCES });
});

export default charts;
