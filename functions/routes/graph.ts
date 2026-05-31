import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { getCliPublishToken } from "../lib/auth";
import { graphStats, backfillAll, runMaintenance } from "../lib/graph/maintenance";

// Knowledge-graph admin + status (KNOWLEDGE_GRAPH_SPEC). Backfill/maintenance are
// publish-gated (ADMIN_TOKEN or CLI token), mirroring the book-ingest endpoints;
// stats are read-only and open (handy for the Agent View / debugging).
const graph = new Hono<{ Bindings: Env; Variables: Variables }>();

async function adminAuth(c: any): Promise<boolean> {
  const admin = c.env.ADMIN_TOKEN;
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (admin && token === admin) return true;
  const cli = await getCliPublishToken(c.env, token);
  return !!cli;
}

// Graph state snapshot: how much is embedded / linked / themed.
graph.get("/stats", async (c) => c.json(await graphStats(c.env)));

// Enqueue the whole catalogue for embedding. Idempotent (consumer skips
// already-embedded sids). Returns counts; actual work happens in the consumer.
graph.post("/backfill", async (c) => {
  if (!(await adminAuth(c))) return c.json({ error: "未授权" }, 401);
  if (c.env.GRAPH_ENABLED !== "true" || !c.env.EMBED_QUEUE) {
    return c.json({ error: "知识图谱未启用（需 GRAPH_ENABLED=true + 绑定 EMBED_QUEUE）" }, 400);
  }
  const out = await backfillAll(c.env);
  return c.json({ ok: true, ...out });
});

// Run nightly maintenance on demand (theme labelling + cold-link decay).
graph.post("/maintenance", async (c) => {
  if (!(await adminAuth(c))) return c.json({ error: "未授权" }, 401);
  const out = await runMaintenance(c.env);
  return c.json({ ok: true, ...out });
});

export default graph;
