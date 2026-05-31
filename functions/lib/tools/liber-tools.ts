// Shared Liber tool registry — one implementation reused by both the agent
// loop (functions/lib/agent.ts) and the open MCP route (functions/routes/mcp.ts),
// so the two never drift. Each tool has an OpenAI-style JSON-schema (works with
// DeepSeek / OpenAI-compatible function calling) plus an execute() over the
// real D1 library when present, with seed fallback for local empty databases.
import type { Env } from "../types";
import * as S from "../seed";
import { getCharts } from "../charts";
import { getBook, getChapterText, getToc, hasLibraryBooks, searchDynamic } from "../catalog";
import { echoesForSid } from "../graph/echoes";
import { graphMap } from "../graph/maintenance";

export interface LiberTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  execute: (env: Env, args: any) => Promise<any>;
}

export const TOOLS: LiberTool[] = [
  {
    name: "search",
    description: "在馆藏中检索书名 / 作者 / 句子，返回匹配的书。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "检索词" } },
      required: ["query"],
    },
    execute: async (env, args) => {
      const t = String(args?.query || "").trim().slice(0, 128); // clamp model/client-supplied term
      if (await hasLibraryBooks(env)) {
        const dynamic = await searchDynamic(env, t);
        return dynamic.books.map((b: any) => ({ id: b.id, title: b.t, author: b.a, addr: `liber://${b.id}` }));
      }
      const hits = S.BOOKS.filter((b) => b.t.includes(t) || b.a.includes(t) || (b.sub || "").toLowerCase().includes(t.toLowerCase()));
      return hits.map((b) => ({ id: b.id, title: b.t, author: b.a, addr: `liber://${b.id}` }));
    },
  },
  {
    name: "read_passage",
    description: "按书与章节号读取正文段落。用它读到真正的原文，而不是只凭记忆。",
    parameters: {
      type: "object",
      properties: {
        book: { type: "string", description: "书 id，如 daodejing" },
        chapter: { type: "number", description: "章节号" },
      },
      required: ["book"],
    },
    execute: async (env, args) => {
      const b = await getBook(env, args?.book);
      if (!b) return { error: "未找到该书" };
      // Read only the requested chapter, not every chapter blob of the book. When
      // no chapter is given, fall back to the book's first chapter (some books
      // aren't 1-indexed) rather than assuming n=1.
      let n = Number(args?.chapter) || 0;
      if (!n) { const toc = await getToc(env, b.id); n = toc[0]?.n || 1; }
      const ch = await getChapterText(env, b.id, n);
      if (!ch) return { error: "未找到该章" };
      return { book: b.t, chapter: ch.n, title: ch.title, text: ch.text };
    },
  },
  {
    name: "get_echoes",
    description: "查某一句在馆里其他书的「跨书呼应」(连接层) —— Liber 最独特的能力。",
    parameters: {
      type: "object",
      properties: { sid: { type: "string", description: "句子 id，如 c8-s1" } },
      required: ["sid"],
    },
    // live echo_edges first (KNOWLEDGE_GRAPH_SPEC), seed ECHOES fallback.
    execute: async (env, args) => echoesForSid(env, String(args?.sid || "")),
  },
  {
    name: "get_highlights",
    description: "查一本书被最多人划线的句子。",
    parameters: {
      type: "object",
      properties: { book: { type: "string", description: "书 id" } },
      required: [],
    },
    execute: async (_env, _args) => S.HIGHLIGHTS,
  },
  {
    name: "get_charts",
    description: "开放榜单信号：按时间窗与维度排序的热门书。",
    parameters: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["today", "week", "month"] },
        metric: { type: "string", enum: ["reads", "lines", "convos", "surge"] },
      },
      required: [],
    },
    execute: async (env, args) => {
      const win = args?.window || "today";
      const metric = args?.metric || "reads";
      const chart = await getCharts(env, win);
      const rows = chart.rows.map((r: any) => ({ id: r.id, title: r.title || S.bookById(r.id)?.t, value: metric === "surge" ? (chart.surge?.[r.id] ?? 0) : r[metric] }));
      rows.sort((a: any, b: any) => b.value - a.value);
      return rows.slice(0, 8);
    },
  },
  {
    name: "get_conversations",
    description: "公开的读者×AI 对话(对话卡/金句卡)。",
    parameters: { type: "object", properties: { book: { type: "string" } }, required: [] },
    execute: async (_env, _args) => S.SHARED_CONVOS.map((x: any) => ({ id: x.id, title: x.title || x.insight, book: x.bookT, forks: x.forks })),
  },
  {
    name: "get_graph",
    description: "全馆「思维链接」图谱:书与书之间的跨书呼应网络(节点=书,边=呼应强度)。Liber 最独特的连接层,内容即接口。",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "最多返回的边数,默认 200" } },
      required: [],
    },
    execute: async (env, args) => {
      const map = await graphMap(env, { limit: Number(args?.limit) || 200 });
      return {
        source: map.source,
        nodes: map.nodes.map((n: any) => ({ id: n.id, title: n.t, weight: n.weight })),
        edges: map.edges,
      };
    },
  },
];

const BY_NAME: Record<string, LiberTool> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): LiberTool | undefined {
  // accept both bare ("search") and namespaced ("liber.search") names
  return BY_NAME[name] || BY_NAME[name.replace(/^liber\./, "")];
}

export async function runTool(env: Env, name: string, args: any): Promise<any> {
  const t = getTool(name);
  if (!t) throw new Error(`unknown tool: ${name}`);
  return t.execute(env, args || {});
}

// OpenAI / DeepSeek function-calling schema for the agent loop.
export function openaiTools(): any[] {
  return TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// Manifest for the MCP route (human/agent-readable).
export function manifest(): any[] {
  return TOOLS.map((t) => ({ name: `liber.${t.name}`, desc: t.description, parameters: t.parameters }));
}
