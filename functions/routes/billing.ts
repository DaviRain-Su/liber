import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireUser } from "../lib/auth";
import { first, run, now } from "../lib/db";
import { getUsage } from "../lib/usage";

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

function configured(env: Env): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_PRICE_ID);
}

function appUrl(env: Env, reqUrl: string): string {
  return (env.APP_URL || new URL(reqUrl).origin).replace(/\/$/, "");
}

async function activatePro(env: Env, userId: string, link?: { customer?: string; subscription?: string }) {
  const t = now();
  await run(
    env.DB,
    `INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
     VALUES (?, 'pro', 'active', NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', status = 'active', expires_at = NULL, updated_at = excluded.updated_at`,
    userId, t, t,
  );
  if (link?.customer || link?.subscription) {
    await run(
      env.DB,
      `INSERT INTO subscription_links (user_id, provider, customer_id, subscription_id, created_at, updated_at)
       VALUES (?, 'stripe', ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         provider = 'stripe', customer_id = excluded.customer_id,
         subscription_id = excluded.subscription_id, updated_at = excluded.updated_at`,
      userId, link.customer || null, link.subscription || null, t, t,
    );
  }
}

async function cancelPro(env: Env, userId: string) {
  await run(
    env.DB,
    `INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
     VALUES (?, 'free', 'expired', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = 'free', status = 'expired', expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    userId, now(), now(), now(),
  );
}

function form(data: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) p.set(k, v);
  return p;
}

billing.get("/plan", async (c) => {
  const uid = c.get("userId");
  if (!uid) return c.json({ usage: null, billing: { configured: configured(c.env) } });
  const link = await first(c.env.DB, `SELECT provider, customer_id, subscription_id FROM subscription_links WHERE user_id = ?`, uid);
  return c.json({ usage: await getUsage(c.env, uid), billing: { configured: configured(c.env), link } });
});

billing.post("/checkout", async (c) => {
  const uid = requireUser(c);
  if (!configured(c.env)) return c.json({ error: "付费升级尚未配置 Stripe 密钥或价格 ID" }, 501);
  const base = appUrl(c.env, c.req.url);
  const success = c.env.BILLING_SUCCESS_URL || `${base}/?billing=success`;
  const cancel = c.env.BILLING_CANCEL_URL || `${base}/?billing=cancel`;
  const body = form({
    mode: "subscription",
    "line_items[0][price]": c.env.STRIPE_PRO_PRICE_ID!,
    "line_items[0][quantity]": "1",
    success_url: success,
    cancel_url: cancel,
    client_reference_id: uid,
    "metadata[user_id]": uid,
    "subscription_data[metadata][user_id]": uid,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j: any = await res.json();
  if (!res.ok) return c.json({ error: j?.error?.message || `Stripe ${res.status}` }, 502);
  return c.json({ id: j.id, url: j.url });
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validStripeSignature(secret: string, header: string | null | undefined, body: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !sigs.length) return false;
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return sigs.some((sig) => timingSafeEqual(sig, expected));
}

billing.post("/webhook", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "Stripe webhook secret 未配置" }, 501);
  const body = await c.req.text();
  const ok = await validStripeSignature(secret, c.req.header("stripe-signature"), body);
  if (!ok) return c.json({ error: "Stripe 签名无效" }, 401);
  const evt = JSON.parse(body);
  const obj = evt.data?.object || {};
  const uid = obj.client_reference_id || obj.metadata?.user_id;
  await run(c.env.DB, `INSERT OR IGNORE INTO billing_events (id, provider, type, user_id, payload, created_at) VALUES (?, 'stripe', ?, ?, ?, ?)`, evt.id, evt.type, uid || null, body, now());
  if (uid && evt.type === "checkout.session.completed") {
    await activatePro(c.env, uid, { customer: obj.customer, subscription: obj.subscription });
  }
  if (uid && (evt.type === "customer.subscription.deleted" || evt.type === "customer.subscription.paused")) {
    await cancelPro(c.env, uid);
  }
  return c.json({ received: true });
});

// Admin backstop for wallet/manual payments while the Stripe flow is being wired.
billing.post("/admin/activate", async (c) => {
  const admin = c.env.ADMIN_TOKEN;
  if (!admin || c.req.header("Authorization") !== `Bearer ${admin}`) return c.json({ error: "需要管理员令牌" }, 401);
  const b = await c.req.json();
  if (!b.userId) return c.json({ error: "userId 不能为空" }, 400);
  await activatePro(c.env, b.userId);
  return c.json({ ok: true });
});

export default billing;
