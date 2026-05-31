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

const app = new Hono<{ Bindings: Env; Variables: Variables }>().basePath("/api");

app.use("*", cors({ origin: (o) => o || "*", credentials: true }));
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

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("API error:", err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.notFound((c) => c.json({ error: "未找到该接口" }, 404));

export const onRequest = handle(app);
