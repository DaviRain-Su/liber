import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { manifest, runTool } from "../lib/tools/liber-tools";

// The agent-facing open layer — "内容即接口". No auth, CC0, no rate limit.
// GET /api/mcp returns the tool manifest; POST /api/mcp/call dispatches a tool.
// Tool logic is shared with the in-app agent loop (functions/lib/tools), so the
// two never drift.
const mcp = new Hono<{ Bindings: Env; Variables: Variables }>();

mcp.get("/", (c) => c.json({
  name: "liber",
  description: "Liber 永存的开放图书馆 · 内容即接口",
  license: "CC0-1.0",
  auth: "none",
  tools: manifest(),
}));

mcp.post("/call", async (c) => {
  const { tool, args = {} } = await c.req.json();
  try {
    const result = await runTool(c.env, tool, args);
    return c.json({ tool, result });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

export default mcp;
