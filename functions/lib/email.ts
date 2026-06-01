import type { Env } from "./types";

// Send the login one-time-code email. Cloudflare Pages Functions can't hold the
// Email Service `[[send_email]]` binding (Workers-only), so the preferred path is
// a service binding (MAILER) to the standalone liber-email Worker, which sends via
// the account-level Email Service binding — no API token or secret to manage.
// A REST-API fallback (CF_EMAIL_TOKEN + CF_ACCOUNT_ID) is kept for environments
// without the binding. When neither is configured, the caller surfaces the code in
// the response (dev mode) so login still works.
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<{ sent: boolean; error?: string }> {
  const fromStr = (env.EMAIL_FROM || "Liber <login@davirain.xyz>").trim();
  const m = fromStr.match(/^(.*?)\s*<([^>]+)>$/);
  const fromEmail = m ? m[2].trim() : fromStr;
  const fromName = m ? m[1].trim() || "Liber" : "Liber";
  const subject = `Liber 登录验证码 ${code}`;
  const text = `你的 Liber 登录验证码是：${code}\n\n10 分钟内有效。如果不是你本人操作，请忽略此邮件。`;
  const html = otpHtml(code);

  // Preferred: relay through the liber-email Worker via the MAILER service binding.
  if (env.MAILER?.fetch) {
    try {
      const res = await env.MAILER.fetch("https://mailer.liber.internal/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, from: fromEmail, subject, text, html }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) return { sent: true };
      return { sent: false, error: JSON.stringify(j?.error ?? j).slice(0, 300) };
    } catch (e: any) {
      return { sent: false, error: String(e?.message || e) };
    }
  }

  // Fallback: Cloudflare Email Sending REST API (needs CF_EMAIL_TOKEN + CF_ACCOUNT_ID).
  const token = env.CF_EMAIL_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) return { sent: false };
  const from = { address: fromEmail, name: fromName };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to, from, subject, text, html }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.success) return { sent: true };
    return { sent: false, error: JSON.stringify(j?.errors?.length ? j.errors : (j || `HTTP ${res.status}`)).slice(0, 300) };
  } catch (e: any) {
    return { sent: false, error: String(e?.message || e) };
  }
}

function otpHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f4ee;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="background:#fffdf8;border:1px solid #e8e2d4;border-radius:14px;overflow:hidden">
      <tr><td style="padding:28px 32px 8px">
        <div style="font-size:15px;font-weight:600;color:#2e7d57;letter-spacing:.04em">Liber · 永存的开放图书馆</div>
      </td></tr>
      <tr><td style="padding:8px 32px 4px">
        <div style="font-size:15px;color:#3a3a32;line-height:1.6">你的登录验证码：</div>
      </td></tr>
      <tr><td style="padding:8px 32px 12px">
        <div style="font-size:34px;font-weight:700;letter-spacing:.28em;color:#1f1f1a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      </td></tr>
      <tr><td style="padding:0 32px 28px">
        <div style="font-size:13px;color:#8a8576;line-height:1.6">10 分钟内有效。如果不是你本人操作，请忽略此邮件。</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
