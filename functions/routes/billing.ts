import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { bearerToken, hasAdminToken, requireUser } from "../lib/auth";
import { first, run, now } from "../lib/db";
import { getUsage } from "../lib/usage";
import { paymentReceived, sameSuiAddress, validStripeSignature } from "../lib/verify.mjs";

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

function stripeConfigured(env: Env): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_PRICE_ID);
}

function positiveAtomicAmount(value: string): boolean {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function cryptoConfig(env: Env) {
  const chain = env.PAYMENT_CHAIN || "sui:testnet";
  const treasury = (env.PAYMENT_TREASURY || "").trim();
  const coinType = (env.PAYMENT_COIN_TYPE || "").trim();
  const amount = (env.PAYMENT_MONTHLY_AMOUNT || "").trim();
  const amountValid = positiveAtomicAmount(amount);
  const planDays = Math.max(1, Math.min(366, parseInt(env.PAYMENT_PLAN_DAYS || "31", 10) || 31));
  return {
    provider: "sui-stablecoin",
    chain,
    rpc: env.SUI_RPC || null,
    treasury,
    coinType,
    amount,
    amountLabel: env.PAYMENT_AMOUNT_LABEL || (amount ? `${amount} atomic units` : ""),
    planDays,
    configured: !!(env.SUI_RPC && treasury && coinType && amountValid),
  };
}

function appUrl(env: Env, reqUrl: string): string {
  return (env.APP_URL || new URL(reqUrl).origin).replace(/\/$/, "");
}

async function activatePro(env: Env, userId: string, link?: { provider?: string; customer?: string; subscription?: string; expiresAt?: number | null }) {
  const t = now();
  const expiresAt = link?.expiresAt ?? null;
  await run(
    env.DB,
    `INSERT INTO subscriptions (user_id, plan, status, expires_at, created_at, updated_at)
     VALUES (?, 'pro', 'active', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', status = 'active', expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    userId, expiresAt, t, t,
  );
  if (link?.customer || link?.subscription) {
    await run(
      env.DB,
      `INSERT INTO subscription_links (user_id, provider, customer_id, subscription_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         provider = excluded.provider, customer_id = excluded.customer_id,
         subscription_id = excluded.subscription_id, updated_at = excluded.updated_at`,
      userId, link.provider || "stripe", link.customer || null, link.subscription || null, t, t,
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
  const crypto = cryptoConfig(c.env);
  const stripe = { configured: stripeConfigured(c.env) };
  if (!uid) return c.json({ usage: null, billing: { configured: crypto.configured || stripe.configured, crypto, stripe } });
  const link = await first(c.env.DB, `SELECT provider, customer_id, subscription_id FROM subscription_links WHERE user_id = ?`, uid);
  return c.json({ usage: await getUsage(c.env, uid), billing: { configured: crypto.configured || stripe.configured, crypto, stripe, link } });
});

billing.get("/crypto/config", (c) => {
  const cfg = cryptoConfig(c.env);
  return c.json({ payment: cfg });
});

async function suiRpc(env: Env, method: string, params: unknown[]): Promise<any> {
  if (!env.SUI_RPC) throw new Error("SUI_RPC not configured");
  const res = await fetch(env.SUI_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`sui rpc ${res.status}`);
  const j: any = await res.json();
  if (j.error) throw new Error(j.error.message || "sui rpc error");
  return j.result;
}

billing.post("/crypto/confirm", async (c) => {
  const uid = requireUser(c);
  const cfg = cryptoConfig(c.env);
  if (!cfg.configured) return c.json({ error: "稳定币付费尚未配置收款地址、币种或金额" }, 501);
  const user = await first<any>(c.env.DB, `SELECT sui_address FROM users WHERE id = ?`, uid);
  const expectedSender = user?.sui_address;
  if (!expectedSender || !expectedSender.startsWith("0x")) return c.json({ error: "请先用 Sui 钱包登录" }, 401);
  const { digest } = await c.req.json();
  if (!digest) return c.json({ error: "交易 digest 不能为空" }, 400);
  const existing = await first(c.env.DB, `SELECT 1 AS x FROM billing_events WHERE id = ?`, `sui:${digest}`);
  if (existing) return c.json({ ok: true, usage: await getUsage(c.env, uid), duplicate: true });

  const tx = await suiRpc(c.env, "sui_getTransactionBlock", [
    digest,
    { showInput: true, showEffects: true, showBalanceChanges: true },
  ]);
  const status = tx?.effects?.status?.status;
  const sender = tx?.transaction?.data?.sender;
  if (status !== "success") return c.json({ error: "交易未成功" }, 400);
  if (!sameSuiAddress(sender, expectedSender)) return c.json({ error: "交易发送者与当前钱包不一致" }, 400);

  const received = paymentReceived(tx.balanceChanges, { coinType: cfg.coinType, treasury: cfg.treasury, amount: cfg.amount });
  if (!received) return c.json({ error: "未检测到足额稳定币转入收款地址" }, 400);

  const expiresAt = now() + cfg.planDays * 24 * 60 * 60 * 1000;
  await run(c.env.DB, `INSERT INTO billing_events (id, provider, type, user_id, payload, created_at) VALUES (?, 'sui', 'stablecoin_payment', ?, ?, ?)`, `sui:${digest}`, uid, JSON.stringify({ digest, sender, payment: cfg, tx }), now());
  await activatePro(c.env, uid, { provider: "sui", customer: sender, subscription: digest, expiresAt });
  return c.json({ ok: true, digest, usage: await getUsage(c.env, uid) });
});

billing.post("/checkout", async (c) => {
  const uid = requireUser(c);
  if (!stripeConfigured(c.env)) return c.json({ error: "Stripe 未配置；请使用链上稳定币付费" }, 501);
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

// Admin backstop for off-chain/manual promotions.
billing.post("/admin/activate", async (c) => {
  if (!hasAdminToken(c.env, bearerToken(c))) return c.json({ error: "需要管理员令牌" }, 401);
  const b = await c.req.json().catch(() => ({}));
  if (!b.userId) return c.json({ error: "userId 不能为空" }, 400);
  await activatePro(c.env, b.userId);
  return c.json({ ok: true });
});

export default billing;
