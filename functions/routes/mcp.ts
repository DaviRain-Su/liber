import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { manifest, runTool } from "../lib/tools/liber-tools";
import { rateLimit, clientIp } from "../lib/ratelimit";

// The agent-facing open layer — "内容即接口". Unauthenticated (CC0) but per-IP
// rate-limited: some tools (get_echoes when the graph is on, semantic search)
// reach billable Workers AI + D1 writes, so an open unmetered route would be a
// cost-abuse channel. Tool logic is shared with the in-app agent loop
// (functions/lib/tools), so the two never drift.
const mcp = new Hono<{ Bindings: Env; Variables: Variables }>();

mcp.get("/", (c) =>
  c.json({
    name: "liber",
    description: "Liber 永存的开放图书馆 · 内容即接口",
    license: "CC0-1.0",
    auth: "none",
    tools: manifest(),
  }),
);

mcp.post("/call", async (c) => {
  const perMin = Number(c.env.AI_RATE_PER_MIN || 20) || 20;
  if (!(await rateLimit(c.env, `mcp:${clientIp(c)}`, perMin, 60)).ok) {
    return c.json({ error: "请求过于频繁，请稍后再试。" }, 429);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || !body.tool) return c.json({ error: "缺少 tool 参数" }, 400);
  try {
    const result = await runTool(c.env, body.tool, body.args || {});
    return c.json({ tool: body.tool, result });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

export default mcp;
