// Lightweight per-key fixed-window rate limiter backed by KV.
//
// KV is not transactional, so under a burst two concurrent requests can both
// read the same counter before either writes — i.e. the cap is approximate, not
// exact. That is fine for cost/abuse protection (the goal is to stop a runaway
// loop hammering Workers AI, not to enforce an exact quota). For an exact limit
// a Durable Object would be required.
import type { Env } from "./types";

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
  // Prefer an atomic Cloudflare Rate Limiting binding if one is present (per-key,
  // stops a concurrent burst). Pages config does not currently support this
  // binding, so in practice this path is dormant and the KV fallback runs — but
  // it auto-upgrades the day Pages exposes one.
  if (env.AI_RATE_LIMITER && typeof env.AI_RATE_LIMITER.limit === "function") {
    try {
      const { success } = await env.AI_RATE_LIMITER.limit({ key });
      return { ok: success, remaining: success ? 1 : 0 };
    } catch {
      // fall through to the KV best-effort limiter
    }
  }
  // KV fallback — approximate under bursts (read-then-write race), but throttles
  // sustained loops. Used in local dev / if the binding is unavailable.
  if (!env.KV) return { ok: true, remaining: limit };
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const bucket = `rl:${key}:${window}`;
  const current = Number((await env.KV.get(bucket)) || 0);
  if (current >= limit) return { ok: false, remaining: 0 };
  await env.KV.put(bucket, String(current + 1), { expirationTtl: windowSec + 5 });
  return { ok: true, remaining: limit - current - 1 };
}
