// AI provider gateway — swappable LLM backend behind one call, mirroring the
// chains/storage adapter pattern. Pick with AI_PROVIDER:
//   "workers-ai" (default) — Cloudflare Workers AI (on-platform, no key)
//   "deepseek"             — DeepSeek API (needs DEEPSEEK_API_KEY)
//   "openai-compat"        — any OpenAI-compatible endpoint (AI_BASE_URL + AI_API_KEY)
// Model is AI_MODEL (provider-specific id) or each provider's sensible default.
// For Workers AI, AI_GATEWAY_ID routes calls through Cloudflare AI Gateway for
// analytics, rate limits, logs, and optional caching.
//
// This is the seam the subscription / 包月 model plugs into: route premium tiers
// to a stronger provider (DeepSeek/Claude) server-side, keep free tier on
// Workers AI, and meter per user. Callers just await aiChat().
import type { Env } from "./types";
// workersAiText (Workers AI dual-shape response parser) lives in ai-parse.mjs so
// it can be unit-tested without a live AI binding (test/ai-parse.test.mjs).
import { workersAiText } from "./ai-parse.mjs";

export interface ChatMsg { role: "system" | "user" | "assistant"; content: string }
export interface ChatOpts { maxTokens?: number; temperature?: number; model?: string; gatewayCache?: boolean }

const DEFAULTS: Record<string, string> = {
  "workers-ai": "@cf/qwen/qwen3-30b-a3b-fp8",
  deepseek: "deepseek-chat",
  "openai-compat": "gpt-4o-mini",
};

function provider(env: Env): string {
  return (env.AI_PROVIDER || "workers-ai").toLowerCase();
}

function modelFor(env: Env, p: string, override?: string): string {
  return override || env.AI_MODEL || DEFAULTS[p] || DEFAULTS["workers-ai"];
}

function gatewayOptions(env: Env, opts: ChatOpts = {}): Record<string, unknown> | undefined {
  const id = (env.AI_GATEWAY_ID || "").trim();
  if (!id) return undefined;
  const gateway: Record<string, unknown> = { id, skipCache: opts.gatewayCache === true ? false : true };
  const ttl = parseInt(env.AI_GATEWAY_CACHE_TTL || "", 10);
  if (Number.isFinite(ttl) && ttl > 0 && opts.gatewayCache === true) gateway.cacheTtl = ttl;
  return { gateway };
}

// Returns the assistant's text. Throws on failure — callers keep their own
// try/catch + offline fallback (so an outage never blocks reading).
export async function aiChat(env: Env, messages: ChatMsg[], opts: ChatOpts = {}): Promise<string> {
  const p = provider(env);
  const model = modelFor(env, p, opts.model);
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
  const res: any = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature }, gatewayOptions(env, opts));
  return workersAiText(res);
}

// Whether the active provider supports function/tool calling (drives the agent
// loop). Workers AI tool-calling is weak/inconsistent, so we only claim it for
// the OpenAI-compatible providers.
export function supportsTools(env: Env): boolean {
  const p = provider(env);
  return p === "deepseek" || p === "openai-compat";
}

export interface RawToolCall { id: string; name: string; args: any }
export interface RawReply { content: string; toolCalls: RawToolCall[] }

// Tool-capable chat. `messages` is the raw OpenAI-shaped array (may include
// assistant tool_calls and {role:"tool"} results). Returns the assistant's text
// plus any tool calls it wants run. Only meaningful for OpenAI-compat providers;
// for Workers AI it returns text only (no tool calls).
export async function aiChatRaw(env: Env, messages: any[], opts: ChatOpts & { tools?: any[] } = {}): Promise<RawReply> {
  const p = provider(env);
  const model = modelFor(env, p, opts.model);
  const maxTokens = opts.maxTokens ?? 700;
  const temperature = opts.temperature ?? 0.7;

  if (p === "deepseek" || p === "openai-compat") {
    const base = p === "deepseek" ? (env.AI_BASE_URL || "https://api.deepseek.com") : (env.AI_BASE_URL || "https://api.openai.com");
    const apiKey = env.AI_API_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error(`${p}: missing API key`);
    const body: any = { model, messages, max_tokens: maxTokens, temperature, stream: false };
    if (opts.tools && opts.tools.length) { body.tools = opts.tools; body.tool_choice = "auto"; }
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${p} ${res.status}`);
    const j: any = await res.json();
    const msg = j?.choices?.[0]?.message || {};
    const toolCalls: RawToolCall[] = (msg.tool_calls || []).map((tc: any) => {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* leave {} */ }
      return { id: tc.id, name: tc.function?.name, args };
    });
    return { content: String(msg.content ?? "").trim(), toolCalls };
  }

  // Workers AI: text only
  const res: any = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature }, gatewayOptions(env, opts));
  return { content: workersAiText(res), toolCalls: [] };
}

// Which provider/model is active — handy for the Agent View / debugging.
export function activeProvider(env: Env): { provider: string; model: string; gateway: { id: string; cacheTtl: number | null } | null } {
  const p = provider(env);
  const ttl = parseInt(env.AI_GATEWAY_CACHE_TTL || "", 10);
  return {
    provider: p,
    model: modelFor(env, p),
    gateway: env.AI_GATEWAY_ID ? { id: env.AI_GATEWAY_ID, cacheTtl: Number.isFinite(ttl) && ttl > 0 ? ttl : null } : null,
  };
}
