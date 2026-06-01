import type { Env } from "./types";

// Send a transactional email. Uses Resend when RESEND_API_KEY is set (RESEND_FROM
// is the verified sender, defaults to Resend's test sender). Returns whether it
// was actually sent — callers fall back to surfacing the code in dev when not.
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<{ sent: boolean }> {
  const key = env.RESEND_API_KEY;
  if (!key) return { sent: false };
  const from = env.RESEND_FROM || "Liber <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `Liber 登录验证码 ${code}`,
        text: `你的 Liber 登录验证码是：${code}\n\n10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
      }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
