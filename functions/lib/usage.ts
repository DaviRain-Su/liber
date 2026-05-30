// AI usage metering + plan/quota check — the foundation for a 包月 (monthly)
// subscription. Free tier gets a monthly request quota (AI_FREE_MONTHLY, default
// 60); a 'pro' subscription is unlimited. Stablecoin payments and optional
// Stripe-compatible checkout live in routes/billing.ts.
import type { Env } from "./types";
import { first, run, now } from "./db";

export function period(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function freeMonthly(env: Env): number {
  const n = parseInt(env.AI_FREE_MONTHLY || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export interface Plan { plan: string; active: boolean; unlimited: boolean }

// A user's effective plan (defaults to free when no row / expired).
export async function getPlan(env: Env, userId: string): Promise<Plan> {
  const row = await first<any>(env.DB, `SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ?`, userId);
  const active = !!row && row.status === "active" && (!row.expires_at || row.expires_at > now());
  const plan = active ? (row.plan || "free") : "free";
  return { plan, active, unlimited: active && plan === "pro" };
}

export interface UsageInfo {
  period: string;
  requests: number;
  tokens: number;
  plan: string;
  limit: number | null;   // null = unlimited
  remaining: number | null;
}

export async function getUsage(env: Env, userId: string): Promise<UsageInfo> {
  const p = period();
  const row = await first<any>(env.DB, `SELECT requests, tokens FROM ai_usage WHERE user_id = ? AND period = ?`, userId, p);
  const plan = await getPlan(env, userId);
  const requests = row?.requests || 0;
  const limit = plan.unlimited ? null : freeMonthly(env);
  return {
    period: p, requests, tokens: row?.tokens || 0, plan: plan.plan,
    limit, remaining: limit === null ? null : Math.max(0, limit - requests),
  };
}

// True if the user may make another AI request this period.
export async function withinQuota(env: Env, userId: string): Promise<boolean> {
  const u = await getUsage(env, userId);
  return u.limit === null || u.requests < u.limit;
}

// Record one AI request (+ estimated tokens). Best-effort; never throws.
export async function recordUsage(env: Env, userId: string, tokens: number): Promise<void> {
  try {
    const p = period();
    await run(
      env.DB,
      `INSERT INTO ai_usage (user_id, period, requests, tokens, updated_at)
       VALUES (?,?,1,?,?)
       ON CONFLICT(user_id, period) DO UPDATE SET
         requests = requests + 1, tokens = tokens + excluded.tokens, updated_at = excluded.updated_at`,
      userId, p, Math.max(0, Math.round(tokens) || 0), now(),
    );
  } catch { /* metering must never block chatting */ }
}

// Rough token estimate when the provider doesn't report usage (~4 chars/token,
// CJK closer to ~1.5; use 2 as a middle-ground heuristic).
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.join(" ").length / 2);
}
