// AI provider gateway — swappable LLM backend behind one call, mirroring the
// chains/storage adapter pattern. Pick with AI_PROVIDER:
//   "workers-ai" (default) — Cloudflare Workers AI (on-platform, no key)
//   "deepseek"             — DeepSeek API (needs DEEPSEEK_API_KEY)
//   "openai-compat"        — any OpenAI-compatible endpoint (AI_BASE_URL + AI_API_KEY)
// Model is AI_MODEL (provider-specific id) or each provider's sensible default.
//
// This is the seam the subscription / 包月 model plugs into: route premium tiers
// to a stronger provider (DeepSeek/Claude) server-side, keep free tier on
// Workers AI, and meter per user. Callers just await aiChat().
import type { Env } from "./types";

export interface ChatMsg { role: "system" | "user" | "assistant"; content: string }
export interface ChatOpts { maxTokens?: number; temperature?: number }

const DEFAULTS: Record<string, string> = {
  "workers-ai": "@cf/qwen/qwen1.5-14b-chat-awq",
  deepseek: "deepseek-chat",
  "openai-compat": "gpt-4o-mini",
};

function provider(env: Env): string {
  return (env.AI_PROVIDER || "workers-ai").toLowerCase();
}

// Returns the assistant's text. Throws on failure — callers keep their own
// try/catch + offline fallback (so an outage never blocks reading).
export async function aiChat(env: Env, messages: ChatMsg[], opts: ChatOpts = {}): Promise<string> {
  const p = provider(env);
  const model = env.AI_MODEL || DEFAULTS[p] || DEFAULTS["workers-ai"];
  const maxTokens = opts.maxTokens ?? 512;
  const temperature = opts.temperature ?? 0.7;

  if (p === "deepseek" || p === "openai-compat") {
    const base = p === "deepseek"
      ? (env.AI_BASE_URL || "https://api.deepseek.com")
      : (env.AI_BASE_URL || "https://api.openai.com");
    const apiKey = env.AI_API_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error(`${p}: missing API key`);
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
    });
    if (!res.ok) throw new Error(`${p} ${res.status}`);
    const j: any = await res.json();
    return String(j?.choices?.[0]?.message?.content ?? "").trim();
  }

  // default: Cloudflare Workers AI
  const res: any = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
  return String(res?.response ?? "").trim();
}

// Which provider/model is active — handy for the Agent View / debugging.
export function activeProvider(env: Env): { provider: string; model: string } {
  const p = provider(env);
  return { provider: p, model: env.AI_MODEL || DEFAULTS[p] || DEFAULTS["workers-ai"] };
}
