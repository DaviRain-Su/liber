// Liber mailer Worker. Reachable only from the Pages app via the MAILER service
// binding (workers_dev=false → no public URL). Sends through the Cloudflare Email
// Service binding (env.EMAIL), which the runtime authenticates at the account
// level — no API token or secret to manage. See ./wrangler.toml for the why.

interface EmailService {
  send(msg: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
}

interface Env {
  EMAIL: EmailService;
  EMAIL_FROM?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }

    const to = String(body?.to || "").trim();
    if (!EMAIL_RE.test(to)) return json({ ok: false, error: "bad_recipient" }, 400);

    const from = String(body?.from || env.EMAIL_FROM || "login@davirain.xyz").trim();
    const subject = String(body?.subject || "Liber").slice(0, 200);
    const text = body?.text ? String(body.text).slice(0, 10000) : undefined;
    const html = body?.html ? String(body.html).slice(0, 50000) : undefined;
    if (!text && !html) return json({ ok: false, error: "empty_body" }, 400);

    try {
      const r = await env.EMAIL.send({ to, from, subject, text, html });
      return json({ ok: true, messageId: r?.messageId ?? null });
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 502);
    }
  },
};
