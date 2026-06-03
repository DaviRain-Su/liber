// Per-key fixed-window rate limiter.
//
// Backed by D1 (SQLite), which is strongly consistent: an atomic upsert+read is
// visible to the very next request, so this actually throttles a burst. (KV was
// tried first and does NOT work — its reads are eventually consistent, so every
// request reads a stale 0 and passes.) Cloudflare's native atomic Rate Limiting
// binding is not available in Pages config, so D1 is the limiter here. Fails
// OPEN on any error so a transient D1 hiccup never blocks a legitimate request.
import type { Env } from "./types";
import { run, first } from "./db";

export function clientIp(c: any): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    (c.req.header("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number }> {
  if (limit <= 0) return { ok: true, remaining: limit };

  // Prefer an atomic Cloudflare Rate Limiting binding if one is ever present
  // (Pages does not currently expose this; the path stays dormant until it does).
  if (env.AI_RATE_LIMITER && typeof env.AI_RATE_LIMITER.limit === "function") {
    try {
      const { success } = await env.AI_RATE_LIMITER.limit({ key });
      return { ok: success, remaining: success ? 1 : 0 };
    } catch {
      // fall through to D1
    }
  }

  if (!env.DB) return { ok: true, remaining: limit };
  const w = Math.floor(Date.now() / 1000 / windowSec);
  try {
    await run(
      env.DB,
      `INSERT INTO rate_counters (k, w, n) VALUES (?, ?, 1)
       ON CONFLICT(k, w) DO UPDATE SET n = n + 1`,
      key,
      w,
    );
    const row = await first<{ n: number }>(
      env.DB,
      `SELECT n FROM rate_counters WHERE k = ? AND w = ?`,
      key,
      w,
    );
    const n = row?.n || 1;
    const decision = n > limit ? { ok: false, remaining: 0 } : { ok: true, remaining: limit - n };
    // First hit of a new window for this key → prune old windows (keeps the
    // table bounded to roughly one window's worth of rows). Best-effort.
    if (n === 1) {
      try {
        await run(env.DB, `DELETE FROM rate_counters WHERE w < ?`, w - 2);
      } catch {
        /* ignore */
      }
    }
    return decision;
  } catch {
    return { ok: true, remaining: limit }; // fail open
  }
}
