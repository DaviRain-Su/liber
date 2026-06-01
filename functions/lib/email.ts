import type { Env } from "./types";

// Send the login one-time-code email via the Cloudflare Email Sending REST API
// (developers.cloudflare.com/email-service). Pages Functions can't use the
// SEND_EMAIL binding (Workers-only), so we call the REST endpoint with an API
// token. No third-party service. Returns whether it was actually sent; when not
// configured, the caller surfaces the code in the response (dev mode).
//
// Setup: CF_EMAIL_TOKEN (a Cloudflare API token with email-send permission, set
// as a secret), CF_ACCOUNT_ID, and EMAIL_FROM = "Liber <login@your-verified-domain>".
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<{ sent: boolean; error?: string }> {
  const token = env.CF_EMAIL_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) return { sent: false };
  const fromStr = (env.EMAIL_FROM || "Liber <login@davirain.xyz>").trim();
  const m = fromStr.match(/^(.*?)\s*<([^>]+)>$/);
  const from = m ? { address: m[2].trim(), name: m[1].trim() || "Liber" } : { address: fromStr, name: "Liber" };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        to,
        from,
        subject: `Liber 登录验证码 ${code}`,
        text: `你的 Liber 登录验证码是：${code}\n\n10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
      }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.success) return { sent: true };
    return { sent: false, error: JSON.stringify(j?.errors?.length ? j.errors : (j || `HTTP ${res.status}`)).slice(0, 300) };
  } catch (e: any) {
    return { sent: false, error: String(e?.message || e) };
  }
}
