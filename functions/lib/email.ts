import type { Env } from "./types";

// Send the login one-time-code email via Cloudflare Email Sending — the SEND_EMAIL
// binding (blog.cloudflare.com/email-service). No third-party service. Returns
// whether it was actually sent; when the binding isn't configured yet, the caller
// surfaces the code in the response so the flow stays testable (dev mode).
//
// Setup (once Email Sending beta access is granted): bind SEND_EMAIL + verify a
// sender domain, then set EMAIL_FROM, e.g. "Liber <login@yourdomain.com>".
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<{ sent: boolean }> {
  if (!env.SEND_EMAIL?.send) return { sent: false };
  const raw = (env.EMAIL_FROM || "Liber <login@liber-99x.pages.dev>").trim();
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  const from = m ? { name: m[1].trim() || "Liber", email: m[2].trim() } : { email: raw, name: "Liber" };
  try {
    await env.SEND_EMAIL.send({
      to: [{ email: to }],
      from,
      subject: `Liber 登录验证码 ${code}`,
      text: `你的 Liber 登录验证码是：${code}\n\n10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
