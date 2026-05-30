import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import * as S from "../lib/seed";

// The agent-facing open layer — "内容即接口". No auth, CC0, no rate limit.
// GET /api/mcp returns the tool manifest; POST /api/mcp/call dispatches a tool.
const mcp = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOOLS = [
  { name: "liber.search", sig: "(query) -> Book[]", desc: "全文检索书名 / 作者 / 句子" },
  { name: "liber.read_passage", sig: "(book, ch) -> Text", desc: "按章节定位正文" },
  { name: "liber.get_highlights", sig: "(book) -> Highlight[]", desc: "热门划线" },
  { name: "liber.get_conversations", sig: "(book?) -> Convo[]", desc: "公开的读者×AI 对话" },
  { name: "liber.get_echoes", sig: "(sid) -> Echo[]", desc: "跨书呼应（连接层）" },
  { name: "liber.get_charts", sig: "(window, metric) -> Rank[]", desc: "开放榜单信号" },
];

mcp.get("/", (c) => c.json({ name: "liber", description: "Liber 永存的开放图书馆 · 内容即接口", license: "CC0-1.0", auth: "none", tools: TOOLS }));

mcp.post("/call", async (c) => {
  const { tool, args = {} } = await c.req.json();
  switch (tool) {
    case "liber.search": {
      const t = (args.query || "").trim();
      const hits = S.BOOKS.filter((b) => b.t.includes(t) || b.a.includes(t));
      return c.json({ tool, result: hits.map((b) => ({ id: b.id, title: b.t, author: b.a, addr: `liber://${b.id}`, blob: b.blob })) });
    }
    case "liber.read_passage": {
      const b = S.bookById(args.book);
      if (!b) return c.json({ error: "book not found" }, 404);
      const ch = S.CHAPTERS.find((x) => x.n === Number(args.ch)) || S.CHAPTERS[0];
      const text = ch ? ch.paras.flat().map((s: any) => s.t).join("") : "";
      return c.json({ tool, result: { book: b.t, chapter: ch?.n, title: ch?.title, text } });
    }
    case "liber.get_highlights":
      return c.json({ tool, result: S.HIGHLIGHTS });
    case "liber.get_conversations":
      return c.json({ tool, result: S.SHARED_CONVOS.map((x) => ({ id: x.id, title: x.title || x.insight, book: x.bookT, forks: x.forks })) });
    case "liber.get_echoes":
      return c.json({ tool, result: S.ECHOES[args.sid] || null });
    case "liber.get_charts": {
      const win = args.window || "today";
      const metric = args.metric || "reads";
      const rows = (S.CHARTS[win] || []).map((r: any) => ({ id: r.id, title: S.bookById(r.id)?.t, value: metric === "surge" ? (S.SURGE[win]?.[r.id] ?? 0) : r[metric] }));
      rows.sort((a: any, b: any) => b.value - a.value);
      return c.json({ tool, addr: `liber://charts/${win}/${metric}`, result: rows.slice(0, 8) });
    }
    default:
      return c.json({ error: `unknown tool: ${tool}` }, 400);
  }
});

export default mcp;
