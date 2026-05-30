// Shared Liber tool registry — one implementation reused by both the agent
// loop (functions/lib/agent.ts) and the open MCP route (functions/routes/mcp.ts),
// so the two never drift. Each tool has an OpenAI-style JSON-schema (works with
// DeepSeek / OpenAI-compatible function calling) plus an execute() over seed data.
import type { Env } from "../types";
import * as S from "../seed";

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
    execute: async (_env, args) => {
      const t = String(args?.query || "").trim();
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
    execute: async (_env, args) => {
      const b = S.bookById(args?.book);
      if (!b) return { error: "未找到该书" };
      const ch = S.CHAPTERS.find((x: any) => x.n === Number(args?.chapter)) || S.CHAPTERS[0];
      const text = ch ? ch.paras.flat().map((s: any) => s.t).join("") : "";
      return { book: b.t, chapter: ch?.n, title: ch?.title, text };
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
    execute: async (_env, args) => S.ECHOES[args?.sid] || null,
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
    execute: async (_env, args) => {
      const win = args?.window || "today";
      const metric = args?.metric || "reads";
      const rows = (S.CHARTS[win] || []).map((r: any) => ({ id: r.id, title: S.bookById(r.id)?.t, value: metric === "surge" ? (S.SURGE[win]?.[r.id] ?? 0) : r[metric] }));
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
