import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { all, first } from "../lib/db";
import { bearerToken, isPlatformAdmin } from "../lib/auth";
import { rateLimit, clientIp } from "../lib/ratelimit";
import {
  enqueuePlatformJob,
  platformStatus,
  renderShareCard,
  runDuePlatformJobs,
  runPlatformJob,
  semanticSearch,
} from "../lib/platform";

const platform = new Hono<{ Bindings: Env; Variables: Variables }>();

// Infra/cost admin: ADMIN_TOKEN or a CLI token from an ADMIN_WALLETS-listed
// wallet. A random user's self-minted CLI token is NOT accepted here.
async function platformAuth(c: any): Promise<boolean> {
  return isPlatformAdmin(c.env, bearerToken(c));
}

platform.get("/status", async (c) => c.json(await platformStatus(c.env)));

platform.get("/search", async (c) => {
  // Public + runs Workers AI embeddings per query → per-IP rate limit.
  const perMin = Number(c.env.AI_RATE_PER_MIN || 20) || 20;
  if (!(await rateLimit(c.env, `sem-search:${clientIp(c)}`, perMin, 60)).ok) {
    return c.json({ error: "请求过于频繁，请稍后再试。" }, 429);
  }
  const q = (c.req.query("q") || "").trim();
  const limit = Number(c.req.query("limit") || 8);
  return c.json(await semanticSearch(c.env, q, limit));
});

platform.get("/jobs", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const status = c.req.query("status");
  const rows = await all<any>(
    c.env.DB,
    `SELECT id, type, status, priority, target_type, target_id, payload, result, error,
            attempts, created_by, created_at, updated_at, started_at, finished_at
     FROM platform_jobs
     ${status ? "WHERE status = ?" : ""}
     ORDER BY created_at DESC LIMIT 80`,
    ...(status ? [status] : []),
  );
  return c.json({ jobs: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload || "{}"), result: row.result ? JSON.parse(row.result) : null })) });
});

platform.post("/jobs", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const body = await c.req.json();
  const job = await enqueuePlatformJob(c.env, {
    type: body.type,
    targetType: body.targetType || body.target_type || null,
    targetId: body.targetId || body.target_id || null,
    payload: body.payload || {},
    priority: Number(body.priority || 0),
    runAfter: body.runAfter || body.run_after || null,
  }, c.get("userId"));
  return c.json({ ok: true, job });
});

platform.post("/jobs/drain", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const jobs = await runDuePlatformJobs(c.env, Number(body.limit || 5));
  return c.json({ ok: true, jobs });
});

platform.post("/jobs/:id/run", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  try {
    return c.json({ ok: true, job: await runPlatformJob(c.env, c.req.param("id")) });
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

platform.post("/index/book/:id", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const job = await enqueuePlatformJob(c.env, {
    type: "index-book",
    targetType: "book",
    targetId: c.req.param("id"),
    payload: { bookId: c.req.param("id") },
  }, c.get("userId"));
  return c.json({ ok: true, job });
});

platform.post("/render/share-card", async (c) => {
  if (!(await platformAuth(c))) return c.json({ error: "需要管理员令牌或 CLI 发布授权" }, 401);
  const body = await c.req.json();
  const mode = String(body.mode || "queue");
  if (mode === "now") {
    try {
      return c.json({ ok: true, asset: await renderShareCard(c.env, body) });
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
    }
  }
  const job = await enqueuePlatformJob(c.env, {
    type: "render-share-card",
    targetType: "share",
    targetId: body.shareId || null,
    payload: body,
  }, c.get("userId"));
  return c.json({ ok: true, job });
});

platform.get("/assets/:id", async (c) => {
  const row = await first<any>(c.env.DB, `SELECT r2_key, content_type FROM share_assets WHERE id = ? AND status = 'ready'`, c.req.param("id"));
  if (!row?.r2_key) return c.json({ error: "未找到生成资产" }, 404);
  const obj = await c.env.R2.get(row.r2_key);
  if (!obj) return c.json({ error: "R2 资产不存在" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.content_type || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export default platform;
