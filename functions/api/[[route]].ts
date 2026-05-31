// Liber API — Hono app served as a Cloudflare Pages Function under /api/*.
import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "../lib/types";
import { authMiddleware } from "../lib/auth";
import auth from "../routes/auth";
import books from "../routes/books";
import reading from "../routes/reading";
import social from "../routes/social";
import booklists from "../routes/booklists";
import ai from "../routes/ai";
import charts from "../routes/charts";
import mcp from "../routes/mcp";
import billing from "../routes/billing";
import graph from "../routes/graph";
import platform from "../routes/platform";

const app = new Hono<{ Bindings: Env; Variables: Variables }>().basePath("/api");

// Only reflect an Origin we trust while credentials:true — reflecting an
// arbitrary Origin would let any third-party site read a logged-in user's
// private JSON (auth/me, ai/conversations, …). The SPA is same-origin with its
// API so it needs no entry here; this allowlist is for genuine cross-origin
// callers only (Pages preview deploys, localhost, anything in ALLOWED_ORIGINS).
function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return false;
  const extra = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (u.protocol === "https:" && (host === "liber-99x.pages.dev" || host.endsWith(".liber-99x.pages.dev"))) return true;
  if ((u.protocol === "http:" || u.protocol === "https:") && (host === "localhost" || host === "127.0.0.1")) return true;
  return false;
}

app.use("*", cors({
  origin: (o, c) => (isAllowedOrigin(o, c.env) ? o : null),
  credentials: true,
}));
app.use("*", authMiddleware);

app.get("/health", (c) => c.json({ ok: true, service: "liber-api", time: Date.now() }));

app.route("/auth", auth);
app.route("/", books); // /books, /search
app.route("/reading", reading);
app.route("/booklists", booklists);
app.route("/", social); // /feed, /shares, /groups, /threads, /works, /annotations
app.route("/ai", ai);
app.route("/charts", charts);
app.route("/mcp", mcp);
app.route("/billing", billing);
app.route("/graph", graph);
app.route("/platform", platform);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("API error:", err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.notFound((c) => c.json({ error: "未找到该接口" }, 404));

export const onRequest = handle(app);
