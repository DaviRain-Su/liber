# Liber AI 模块 → Agent 化改造 Spec（基于 pi）

> 目标读者：实现这次改造的工程师 / 云端 agent。
> 状态：草案 v2（2026-05-30）。**本文只描述「做什么、怎么做、怎么验收」，不含已落地代码。**
> pi 的 API 已对照其源码 README 核实（`@earendil-works/pi-ai` / `@earendil-works/pi-agent-core`，2026-05-30）。

---

## 0. 一句话

把 Liber 的「AI 书友」从**一次性 chat**（单次 `env.AI.run`）升级为**真正的 agent**
（自己决定调用工具、多步推理），用 [earendil-works/pi](https://github.com/earendil-works/pi)
的 `pi-agent-core` 跑 agent 循环，工具复用项目已有的 MCP 工具（读正文 / 跨书呼应 / 热门划线 / 搜索），
模型经 **Cloudflare AI Gateway** 接强模型（顺带拿到缓存 + 用量/成本可观测）。

---

## 1. 现状（改造前）

- **`functions/lib/ai.ts`** — `companionReply()`：单次 `env.AI.run("@cf/meta/llama-3.1-8b-instruct", {messages})`，
  取 `res.response`。8 个 persona（companion/extend/notes/debate/stoic/textual/skeptic/econ）各一套 system prompt。
  上下文只有「选中的一句 + 书名章节 + 最近 8 轮历史」。
- **`functions/routes/ai.ts`** — `POST /api/ai/chat`（访客可用；登录用户对话存入 D1 `conversations`+`messages`，
  记一条 `convo` 榜单事件）。`GET /api/ai/conversations[/:id]`。
- **`functions/routes/mcp.ts`** — 已有 6 工具，但 chat 路径**一个都不用**：
  `liber.search` / `liber.read_passage` / `liber.get_highlights` / `liber.get_conversations` /
  `liber.get_echoes` / `liber.get_charts`。
- 运行时：**Cloudflare Pages Functions（Workers）**，Hono，`env.AI` = Workers AI binding。

**问题**：书友只能就「喂给它的那一句」发挥，不能主动读真正的正文、查跨书呼应、看划线热度。
是「会聊天」，不是「会查会读会联想」。

---

## 2. pi 是什么（核实过的事实）

monorepo，4 个包，我们只用前两个：

| 包 | 作用 | 用否 |
| --- | --- | --- |
| `@earendil-works/pi-ai` | 统一多 provider LLM API（OpenAI/Anthropic/Google/…）。工具调用、流式、reasoning。**依赖少（typebox 等），纯 fetch** | ✅ |
| `@earendil-works/pi-agent-core` | 有状态 agent：工具执行 + 事件流，建在 pi-ai 上 | ✅ |
| `@earendil-works/pi-coding-agent` | 编码 agent CLI（read/bash/edit/write） | ❌ 与读书无关 |
| `@earendil-works/pi-tui` | 终端 UI | ❌ |

### 2.1 pi-ai 真实 API
```ts
import { getModel, streamText, registerProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox"; // 工具 schema 用 typebox，不是 zod

// 模型：内置 provider，apiKey 默认读 env（OPENAI_API_KEY 等），可覆盖 apiKey/baseURL
const model = getModel("anthropic", "claude-sonnet-4-20250514", { apiKey, baseURL });

// 自定义 provider（接 AI Gateway / 任意 OpenAI 兼容端点）—— 关键钩子
registerProvider({ id: "liber-gw", name: "Liber GW", baseURL: "<AI Gateway URL>/v1",
                   apiKey: env.LLM_API_KEY, api: "openai-completions" });
const m2 = getModel("liber-gw", "gpt-4o-mini");

// 工具（function calling）
const tool = { name:"read_passage", description:"...",
  parameters: Type.Object({ book: Type.String(), chapter: Type.Number() }),
  execute: async (toolCallId, params) => ({ content:[{type:"text", text: "..."}] }) };
```

### 2.2 pi-agent-core 真实 API
```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";

const agent = new Agent({
  initialState: { systemPrompt, model: getModel(...), tools: [/* AgentTool[] */] },
  convertToLlm: (msgs) => msgs.filter(m => ["user","assistant","toolResult"].includes(m.role)),
  toolExecution: "parallel",                          // 或 "sequential"
  beforeToolCall: async ({toolCall,args,context}) => {/* 可 block：鉴权/限流 */},
  afterToolCall:  async ({toolCall,result,isError}) => {/* 可改写/terminate */},
});
agent.subscribe((event) => { /* agent_start / turn_* / message_* / tool_execution_* / agent_end */ });
await agent.prompt("上善若水和别的书有什么呼应？");
// agent.continue() 续跑；agent.abort() 取消；agent.waitForIdle()；agent.state.messages 是完整 transcript
```
- 工具就是 `AgentTool` 对象：`{ name, label, description, parameters:(typebox), executionMode?, execute: async (toolCallId, params, signal, onUpdate) => ({content,[details]}) }`。
- **工具失败要 `throw`**（agent 捕获后作为 `isError` 工具结果回喂 LLM），不要把错误当 content 返回。
- **核心无状态/不碰文件系统**：`Agent` / `agentLoop` 在内存里持有 transcript，**持久化由调用方负责**（Liber 用 D1）。
- ⚠️ pi-agent-core 还有 `./node` 子入口 + `harness/`（jsonl 文件存储、nodejs env、shell）——**那是给编码 agent 的，Workers 上别 import**。只用主入口的 `Agent` / `agentLoop`。

### 2.3 代理模式（正好契合 Liber）
pi 提供 `streamProxy` + Agent 的 `streamFn` 选项，**专为「浏览器跑 Agent、后端代理 LLM 调用」设计**。
Liber 因此有两种架构（见 §3）。

---

## 3. 架构决策

### 3.1 Agent 跑在哪
- **方案 S（推荐）— Agent 跑在 Worker 里（服务端）**：`POST /api/ai/chat` 内部 `new Agent(...)`，
  工具直接读 D1/seed，`agent.prompt()` 后把最终文本 + steps 返回。**前端零改动**，鉴权天然在服务端。
  代价：多轮工具调用会拉长单次请求时延（用 `maxTurns` 上限 + 可选流式缓解）。
- 方案 C — Agent 跑在前端，用 `streamProxy` 把 LLM 调用代理到 Worker：更接近 pi 的 browser 范式，
  但工具要么在前端（拿不到服务端数据/鉴权麻烦）、要么再回调 Worker，复杂度高。**先不做。**

→ **采用方案 S**。

### 3.2 模型从哪来（同时回应「用 AI Gateway」）
- **方案 G（推荐）— pi + Cloudflare AI Gateway → 强模型**：
  `registerProvider({ baseURL: <AI Gateway 的 OpenAI 兼容端点>, apiKey: env.LLM_API_KEY, api:"openai-completions" })`，
  后面挂 OpenAI / Anthropic（强 tool-calling）。**一举接上你前后两个想法**：pi 给 agent 能力，AI Gateway 给缓存/限流/用量成本看板/fallback。
  - AI Gateway 配置：CF 控制台建一个 Gateway，拿到形如
    `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/compat` 的 OpenAI 兼容端点（按官方文档最新格式为准）。
- 方案 W — pi 自定义 provider 包 **Workers AI**（免费、平台内，但 llama-3.1-8b 工具调用弱、需把 `env.AI.run` 适配成 pi 的流式/tool 协议，成本高、不稳）。作为**省钱退路**。
- 方案 N — 不引入 pi，照搬其循环思路，自己在 Workers AI 上手写 tool-loop。**纯 spike 失败时的兜底。**

→ **采用方案 G**；保留现有 Workers AI 的 `companionReply` 作为**降级兜底**（agent 关闭/超预算/出错时回落）。

---

## 4. 暴露给 agent 的工具（第一批）

复用 `functions/routes/mcp.ts` 已有实现，**抽成共享函数**（如 `functions/lib/tools/liber-tools.ts`），
供 agent（`AgentTool`）和 MCP 路由两边调用，避免两份逻辑。typebox 包 schema。

| 工具 | 来源 | 为什么先接 |
| --- | --- | --- |
| `read_passage(book, chapter)` | mcp 已有 | 让书友读**真正的正文**，而非只有选中那一句 |
| `get_echoes(sid)` | mcp 已有 | **跨书呼应** = Liber 最独特卖点，从静态数据变 AI 真能用的能力 |
| `get_highlights(book)` | mcp 已有 | 让书友知道「大家都划了哪些句」 |
| `search(query)` | mcp 已有 | 让书友按需找别的书/句 |

第二批（视效果）：`get_charts`、`get_conversations`、以及「读当前用户自己的划线/笔记」
（**需带 session userId，严格鉴权，访客拿不到别人数据**）。

---

## 5. 改造范围与对外契约（保持不变）

`POST /api/ai/chat` 请求/响应**结构尽量不变**，前端无需改：
- 入参沿用 `{ bookId, sid, lens, context, question, conversationId, history }`。
- 出参沿用 `{ text, ref, conversationId }`，**新增可选 `steps`**（agent 走了几步、调了哪些工具）供「Agent 视角」展示。
- 8 个 persona（lens）→ 映射成 agent 的 `systemPrompt` 前缀，逻辑保留。
- 持久化沿用现有 D1 `conversations`/`messages`（pi agent 的 transcript 在 `agent.state.messages`，
  循环结束后落库；工具调用也可选记入 messages 以便「Agent 视角」回放）。

**建议新增文件**（尽量不动云端 agent 在改的核心文件结构）：
- `functions/lib/tools/liber-tools.ts` — 把 MCP 工具包成 `AgentTool[]`（typebox schema）。
- `functions/lib/agent/companion-agent.ts` — 配 `new Agent(...)`：model（AI Gateway）、systemPrompt（按 lens）、tools、maxTurns、beforeToolCall（鉴权/限流）。
- `functions/lib/ai.ts` 的 `companionReply` 加分支：`env.AGENT_ENABLED === "true"` 走 agent，否则走现有单次调用（**降级兜底**）。

**新增 env（`functions/lib/types.ts` `Env` + `wrangler.toml`）：**
```
AGENT_ENABLED      = "false"   # 总开关，默认关，灰度
AI_GATEWAY_BASEURL = ""        # AI Gateway 的 OpenAI 兼容端点
AI_MODEL           = "gpt-4o-mini"   # 或 anthropic 强模型
LLM_API_KEY        = (secret)  # 走 Pages secret，绝不进 git
AGENT_MAX_TURNS    = "6"
```

---

## 6. 落地步骤（建议顺序）

1. **Spike（半天，最关键）**：最小 Pages Function 里 `import { Agent } from "@earendil-works/pi-agent-core"`
   （**只从主入口，不碰 `/node`**），配一个假工具 + AI Gateway 模型，`agent.prompt()` 跑通一轮工具调用。
   **确认 pi 能在 Workers 运行时打包并运行**（无 Node API / 文件系统报错）。
   跑不通 → 退方案 N（自己在 Workers AI 上写循环）。**这一步决定后面全部，别假设。**
2. 建 Cloudflare AI Gateway，配 `registerProvider` 指向它，确认能出一次带 tool_call 的回复。
3. 把 4 个工具抽成共享函数 + 包 `AgentTool`；MCP 路由改为复用同一份实现。
4. `companion-agent.ts` 串起来；`companionReply` 加 `AGENT_ENABLED` 分支 + 降级兜底。
5. `/api/ai/chat` 出参加 `steps`；前端「Agent 视角」可视化（可选，后续）。
6. 灰度：先 `AGENT_ENABLED=false` 部署（零行为变化），线上手测通过再打开。

---

## 7. 验收标准

- [ ] **能力**：问「上善若水和别的书有什么呼应？」→ 书友**真调用 `get_echoes`**（steps 可见），不是凭空编。
      问「《道德经》第八章讲什么」→ 真 `read_passage` 读正文再答。
- [ ] **降级**：`AGENT_ENABLED=false` 或模型/工具不可用 → 回落现有单次 chat，体验不劣化。
- [ ] **契约**：现有前端不改也能正常对话（请求/响应兼容）。
- [ ] **鉴权**：涉及用户私有数据的工具必须用 `beforeToolCall` 校验 session userId，访客拿不到别人数据。
- [ ] **成本/防失控**：AI Gateway 上能看到调用量；`AGENT_MAX_TURNS` 有上限；超限优雅停止。
- [ ] typecheck + build 通过；`/api/ai/chat` 线上实测真回复 + 真工具调用。

---

## 8. 风险与注意

- **Workers 运行时兼容是最大不确定性**：pi 没官方声明支持 Workers，且 agent 包含 node-only 的 harness/`./node`。
  必须按 §6 step 1 spike 验证「只 import 主入口的 `Agent`」能否在 Workers 打包运行。跑不通就走方案 N。
- **schema 是 typebox 不是 zod**：Liber 现有代码用 zod；agent 工具这层要用 `typebox` 的 `Type`，别混。
- **成本**：方案 G 走外部模型按量计费；务必 AI Gateway 缓存 + `AGENT_MAX_TURNS` + 可选限流。
- **版本锁定**：pi 较新、API 可能变；package.json **精确锁版本**（pi 自己也强调 exact pin）。
- **与云端 agent 并行**：`functions/lib/ai.ts`、`routes/ai.ts` 云端 agent 也在动。
  本方案尽量**加新文件**，对既有文件只做最小分支注入，降低 rebase 冲突。
- **私有数据边界**：给 agent「读用户划线/笔记」工具时，严格按 session userId 限定，别让 agent 跨用户读数据。
- **时延**：多轮工具调用会拉长单次 `/api/ai/chat`；用 `maxTurns` + 考虑后续上流式（pi 原生事件流，可 SSE 给前端）。

---

## 附：pi 关键事实速查（核实自其源码 README，2026-05-30）

- 包：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`（+ coding-agent / tui 不用）。
- pi-ai：`getModel(provider, id, {apiKey, baseURL})`、`streamText({model, messages, tools})`、
  `registerProvider({id, name, baseURL, apiKey, api:"openai-completions"})`。工具 schema = **typebox** `Type`。
- pi-agent-core：`new Agent({ initialState:{systemPrompt, model, tools, messages, thinkingLevel}, convertToLlm,
  transformContext, streamFn, sessionId, getApiKey, toolExecution, beforeToolCall, afterToolCall })`；
  `agent.prompt()/continue()/subscribe()/abort()/waitForIdle()`；`agent.state.messages` = transcript。
- 工具 `AgentTool`：`{ name, label, description, parameters(typebox), executionMode?, execute(toolCallId, params, signal, onUpdate) => {content, details} }`；失败 `throw`；可 `terminate:true` 提前停。
- 事件：`agent_start / turn_start / message_start|update|end / tool_execution_start|update|end / turn_end / agent_end`。
- 低层：`agentLoop(prompts, context, config)` / `agentLoopContinue(context, config)`（async generator）。
- 代理范式：`streamProxy` + Agent 的 `streamFn`（浏览器跑 Agent、后端代理 LLM）。
- ⚠️ `./node` 子入口 + `harness/`（jsonl 文件、nodejs env、shell）是 node-only，Workers 勿用。
