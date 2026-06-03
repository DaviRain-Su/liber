// Companion agent — a self-contained tool-calling loop (spec 方案 S + 方案 N):
// runs server-side in the Worker, reuses the shared Liber tools, and drives the
// active AI provider's function-calling. No external agent framework (pi), so
// nothing risks the Workers runtime; gated on AGENT_ENABLED + a tool-capable
// provider, and callers always keep the single-shot fallback.
import type { Env } from "./types";
import { aiChatRaw, supportsTools } from "./aiProvider";
import { openaiTools, runTool } from "./tools/liber-tools";

export interface AgentStep {
  tool: string;
  args: any;
  ok: boolean;
}
export interface AgentResult {
  text: string;
  steps: AgentStep[];
}

export function agentEnabled(env: Env): boolean {
  return env.AGENT_ENABLED === "true" && supportsTools(env);
}

function maxTurns(env: Env): number {
  const n = parseInt(env.AGENT_MAX_TURNS || "", 10);
  return Number.isFinite(n) && n > 0 && n <= 12 ? n : 6;
}

// Run the agent: the model decides when to call tools (read_passage / get_echoes
// / search / …); we execute them, feed results back, and loop until it answers
// or hits the turn cap. Returns the final text + the tool steps taken (for the
// "Agent 视角" UI). Throws on provider failure — caller falls back to single-shot.
export async function runCompanionAgent(
  env: Env,
  opts: { system: string; history: Array<{ role: string; content: string }>; question: string },
): Promise<AgentResult> {
  const tools = openaiTools();
  const messages: any[] = [
    { role: "system", content: opts.system },
    ...opts.history,
    { role: "user", content: opts.question },
  ];
  const steps: AgentStep[] = [];
  const turns = maxTurns(env);

  for (let i = 0; i < turns; i++) {
    const reply = await aiChatRaw(env, messages, { tools, maxTokens: 800 });
    if (!reply.toolCalls.length) {
      return { text: reply.content, steps };
    }
    // echo the assistant's tool_calls back (required by the OpenAI tool protocol)
    messages.push({
      role: "assistant",
      content: reply.content || null,
      tool_calls: reply.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });
    for (const tc of reply.toolCalls) {
      let result: any,
        ok = true;
      try {
        result = await runTool(env, tc.name, tc.args);
      } catch (e) {
        ok = false;
        result = { error: String(e) };
      }
      steps.push({ tool: tc.name, args: tc.args, ok });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 4000),
      });
    }
  }

  // out of turns — force a final answer with no further tools
  const final = await aiChatRaw(env, messages, { maxTokens: 800 });
  return { text: final.content || "（这个问题我查了几步，但还需要你说得更具体些。）", steps };
}
