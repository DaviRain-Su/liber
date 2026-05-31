# Liber 思维链接（活的跨书呼应）→ Emergent Knowledge Graph Spec

> 目标读者：实现这次能力的工程师 / 云端 agent。
> 状态：草案 v1（2026-05-31）。**本文只描述「做什么、怎么做、怎么验收」，不含已落地代码。**
> 全部基于 Cloudflare 原生能力（Workers AI / Vectorize / Queues / D1 / Cron），**不依赖 pi、不依赖任何外部 agent 框架**。

---

## 0. 一句话

把 Liber 的「跨书呼应（echoes）」从**编辑部手写的静态字典**，升级成**随阅读、划线、提问、对话持续生长的知识图谱**：
读者越多地与馆藏互动，系统就越能自动发现「这一句和另一本书的那一句其实在说同一件事」，并自动写出「为什么相通」。
这就是你说的「安德鲁的 Wiki / 数字花园」效应——节点不靠人手连，而是**越用越密**。

---

## 1. 它和 `AI_AGENT_SPEC.md` 的关系（先读这段）

| | `AI_AGENT_SPEC.md`（已有草案） | 本文（KNOWLEDGE_GRAPH_SPEC） |
| --- | --- | --- |
| 解决什么 | 让书友**会调用工具**（多步推理、真去读正文/查呼应） | 让 `get_echoes` 背后的呼应**本身会生长** |
| 改动核心 | agent 循环、`companionReply` 分支 | embedding 管线 + 向量检索 + `echo_edges` 表 |
| 对 `get_echoes` | **消费方**：agent 调用它 | **生产方**：让它返回活数据 |
| 依赖 | （草案设想用 pi；实际已自研等价实现） | 纯 Cloudflare，无 pi |

**关键协同点**：两者交汇于同一个函数 `functions/lib/tools/liber-tools.ts` 里的 `get_echoes`。
本文把它从「读 seed」改成「先读 D1 动态边、回退 seed」，于是 **agent 书友、伴读抽屉、对外 `/api/mcp`** 三条链路**自动**都用上活的呼应，前端几乎零改动。
两份 spec 可独立推进，互不阻塞。

---

## 2. 现状（改造前）

- **静态呼应**：`src/data/product-data.js:404` 的 `ECHOES` 字典，按句子 id 手工编好：
  ```js
  ECHOES["c8-s1"] = {
    theme: "不争 · 处下",
    items: [ { bookT:"论语", bookId:"analects", chap:"卫灵公篇",
               quote:"君子矜而不争…", why:"孔子也把「不争」当作君子的修养…" }, … ]
  }
  ```
- **后端透传**：`functions/lib/seed.ts:24` 原样 `export const ECHOES`；
  工具 `functions/lib/tools/liber-tools.ts:65` 直接 `execute: async (_env, args) => S.ECHOES[args?.sid] || null`。
- **共用**：这份工具同时喂给 agent 循环（`functions/lib/agent.ts`）和开放 MCP（`functions/routes/mcp.ts`）。

**问题**：
1. 呼应是**死的**——编辑部不写，就永远不增长；用户聊得再多也不会涌现新链接。
2. **覆盖率极低**——只有少数被手写过的句子有呼应，新导入的书（`POST /api/books/ingest`）完全没有。
3. **sid 命名不一致**（务必注意）：seed 的 `ECHOES` 键是**不带书名**的 `c8-s1`；
   而真实正文句子 id（`functions/lib/catalog.ts:193`）是**带书名**的 `${bookId}-c${n}-s${i}`，如 `daodejing-c8-s1`。
   新系统统一用**带书名的全局 sid**，并对 seed 的旧键做一次兼容映射（见 §6.2）。

---

## 3. 目标 / 非目标

**目标**
- G1：任意句子（含新导入的书）都能**自动**得到跨书呼应，无需人手编。
- G2：呼应**随互动增长**——划线、提问、AI 对话都会喂养图谱。
- G3：保留 Liber 的「品味」——不止给「语义相似」，还自动写出有洞察的 `why`。
- G4：完全在 `$5/月 Workers Paid` 计划内，成本可控、可观测。
- G5：对既有前端/契约**零破坏**；可灰度（开关关掉 = 行为完全回到今天）。

**非目标（明确排除）**
- ✗ 不做 pi / 外部 agent 框架集成（与本能力无关）。
- ✗ 不引入 Hyperdrive（连外部 SQL 用的）、Browser Rendering、Containers。
- ✗ 不在首版做「每用户私有知识图谱」（DO 方案列为后续 P3，见 §8）。
- ✗ 不做实时（写入即出呼应）；用队列异步，秒级~分钟级最终一致即可。

---

## 4. 架构总览

```
读者划线 / 提问 / AI 对话 / 导入新书
        │  （在既有 D1 写入点旁，多发一条队列消息）
        ▼
   EMBED_QUEUE ──► Queue Consumer (Worker)
                       │ 1. 取句子文本（catalog.ts 已有 getChapterText / 句子切分）
                       │ 2. Workers AI 嵌入：@cf/baai/bge-m3  → 1024-d 向量
                       │ 3. upsert 进 Vectorize（id = 全局 sid，metadata: bookId, chap, lang）
                       │ 4. 查 Vectorize topK 最近邻（跨书、余弦）
                       │ 5. 过阈值的候选 → 写 D1 echo_edges（去重、对称）
                       │ 6. （可选/惰性）Workers AI 为新边生成一句 why
                       ▼
   get_echoes(sid):  查 D1 echo_edges ──(空)──► 回退 seed ECHOES（旧键兼容）
        │
        ▼ 同一函数：agent 书友 / 伴读抽屉 / /api/mcp 全部拿到「活」呼应
        
   Cron（夜间，可选 P2）：聚类近期新边 → 提炼 theme、衰减冷链接、补算缺失向量
```

**Cloudflare 件 → 职责映射**

| 能力 | 件 | 说明 | 现状 |
| --- | --- | --- | --- |
| 句子/笔记 → 向量 | **Workers AI** `@cf/baai/bge-m3` | 多语种，对中文/文言友好，1024 维 | `[ai]` 已绑，`env.AI.run()` 现成 |
| 语义最近邻 | **Vectorize** | 余弦 + metadata 过滤；找跨书呼应 | **新增 binding** |
| 异步、不卡阅读 | **Queues** | 写入即入队，后台慢慢算 | **新增 binding** |
| 图的边（who↔who、强度、why、theme） | **D1** | 新表 `echo_edges` | 已有 D1 |
| 写 why / 提炼 theme | **Workers AI / aiProvider** | 复用 `functions/lib/aiProvider.ts:aiChat()` | 现成 |
| 定时重算/聚类 | **Cron Triggers** | `wrangler.toml [triggers]` | 新增（P2） |
| 每用户图谱状态（后续） | **Durable Objects** | P3 再上 | 暂不用 |

---

## 5. 数据模型（新增 D1 migration `0009_knowledge_graph.sql`）

沿用现有迁移风格（`CREATE TABLE IF NOT EXISTS` + 注释 + 索引；参考 `migrations/0006_*`）。

```sql
-- 思维链接：自动发现 + 增长的跨书呼应边。get_echoes 先读这里，回退 seed。
CREATE TABLE IF NOT EXISTS echo_edges (
  id          TEXT PRIMARY KEY,
  src_sid     TEXT NOT NULL,          -- 全局 sid：${bookId}-c${n}-s${i}
  dst_sid     TEXT NOT NULL,
  src_book    TEXT NOT NULL,
  dst_book    TEXT NOT NULL,
  score       REAL NOT NULL,          -- 余弦相似度（0–1），调试/排序/阈值用
  why         TEXT,                   -- LLM 生成的「为什么相通」；惰性填充，可为空
  theme       TEXT,                   -- 归类主题（Cron 聚类产出，可空）
  status      TEXT NOT NULL DEFAULT 'auto',  -- auto | curated | hidden（人工可置顶/隐藏）
  hits        INTEGER NOT NULL DEFAULT 0,    -- 被读到次数（热度/衰减信号）
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- 同书两句不连；(src,dst) 无序去重靠应用层保证 src_sid < dst_sid 后再写。
CREATE UNIQUE INDEX IF NOT EXISTS idx_echo_pair ON echo_edges (src_sid, dst_sid);
CREATE INDEX IF NOT EXISTS idx_echo_src ON echo_edges (src_sid, score DESC);

-- embedding 幂等台账：记录哪些 sid 已嵌入、模型版本，避免重复花 Workers AI 调用。
CREATE TABLE IF NOT EXISTS embeddings (
  sid         TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL,
  model       TEXT NOT NULL,          -- 如 @cf/baai/bge-m3（换模型即重算）
  dim         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings (book_id);
```

> 向量本体存 **Vectorize**（D1 不存数组）；`embeddings` 表只做「这条嵌过了吗」的幂等账本。

---

## 6. 实现步骤（最小侵入、可灰度）

### 6.0 绑定与开关（`wrangler.toml` + `functions/lib/types.ts`）

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "liber-echoes"        # wrangler vectorize create liber-echoes --dimensions=1024 --metric=cosine

[[queues.producers]]
binding = "EMBED_QUEUE"
queue = "liber-embed"

[[queues.consumers]]
queue = "liber-embed"
max_batch_size = 20
max_retries = 3
dead_letter_queue = "liber-embed-dlq"
```

`Env` 新增（`functions/lib/types.ts`，沿用现有可选字段风格）：
```ts
VECTORIZE?: VectorizeIndex;
EMBED_QUEUE?: Queue;
GRAPH_ENABLED?: string;        // "true" 才入队 + 读动态边；默认关 = 行为同今天
GRAPH_EMBED_MODEL?: string;    // 默认 @cf/baai/bge-m3
GRAPH_MIN_SCORE?: string;      // 入边阈值，默认 0.78（需 spike 调）
GRAPH_TOPK?: string;           // 每句取邻居数，默认 8
```

> ⚠️ Pages Functions 对 Queue **consumer** 的支持有坑：Pages Functions 主要是 producer 友好。
> consumer 大概率要**单独一个 Worker**（同 repo，独立 `wrangler.toml`，共享 D1/Vectorize binding）。
> 这一点必须在 §6.1 spike 里验证；若 Pages 不能跑 consumer，就把 consumer 拆成独立 Worker 部署。

### 6.1 Spike（先验证可行性，半天）
1. `wrangler vectorize create liber-echoes --dimensions=1024 --metric=cosine`。
2. 一个最小脚本：把道德经/论语/沉思录全部句子 `env.AI.run("@cf/baai/bge-m3", {text:[...]})` 嵌入 → upsert Vectorize。
3. 对 `daodejing-c8-s1`（上善若水）查 topK，肉眼看跨书邻居**惊不惊艳**、阈值定在多少合理。
4. 验证 Pages Functions 能否消费 Queue；不能 → 规划独立 consumer Worker。
   **这一步的产出直接决定 `GRAPH_MIN_SCORE` 默认值，以及质量到底够不够格上产品。**

### 6.2 嵌入管线（新文件 `functions/lib/graph/embed.ts`）
- `enqueueSid(env, sid)`：若 `GRAPH_ENABLED` 且 `EMBED_QUEUE` 存在，发一条消息；否则 no-op。
- consumer `handleBatch(env, batch)`：
  - 跳过 `embeddings` 里已存在且同 model 的 sid（幂等）；
  - 批量嵌入 → upsert Vectorize（`id=sid`, `metadata={bookId, n, lang}`）→ 记 `embeddings`；
  - 查 topK 邻居（`filter` 掉同 `bookId`）→ 过 `GRAPH_MIN_SCORE` → 规范化 `src<dst` → upsert `echo_edges`（`why` 暂空）。
- **seed 旧键兼容**：backfill 时把 seed `ECHOES` 的裸键 `c8-s1` 映射到 `daodejing-c8-s1`（道德经为默认书），作为 `status='curated'` 的高优边写入，确保「老的手写惊艳呼应」不丢、且永远排在自动边前面。

### 6.3 写入点挂钩（对既有文件最小注入）
在这些**已存在的 D1 写入点**旁，多调一行 `enqueueSid(...)`（`c.executionCtx.waitUntil` 包起来，绝不阻塞响应）：

| 文件:行 | 事件 | 入队什么 |
| --- | --- | --- |
| `functions/routes/reading.ts:44` | 划线 | 该 `sid` |
| `functions/routes/reading.ts:61` | 笔记 | 该 `sid`（笔记文本也可作为独立节点，P2） |
| `functions/routes/ai.ts:44` | AI 对话（已写 `convo` 事件） | 关联 `sid` |
| `functions/lib/catalog.ts:278` | 导入章节 | 该章节全部句子（批量） |

> 划线/对话本质是**强信号**：被人划过、被人追问过的句子，更值得优先嵌入、优先找呼应——这正是「越用越密」。
> 可给这些 sid 在队列消息里带 `priority`，或简单地：用户触发的即时入队，导入的走低优批量。

### 6.4 让 `get_echoes` 返回活数据（核心改动，`functions/lib/tools/liber-tools.ts:65`）
```
get_echoes(sid):
  1. 规范 sid（裸键 → 带书名）
  2. 查 echo_edges where src_sid=sid AND status!='hidden' order by status='curated' desc, score desc limit N
  3. 命中 → 组装成与 seed 相同的 { theme, items:[{bookT, bookId, chap, quote, why}] } 形状
       - quote/chap：用 catalog.ts 的句子查询补全（已有 sentenceFor 思路，见 reading-summary.ts:154）
       - why 为空 → 即时用 aiChat() 生成并回填（惰性，省钱）
  4. 未命中 → 回退 S.ECHOES[原始键]（今天的行为）
```
**因为形状不变，前端 / agent / MCP 全都不用改**。

### 6.5 why 生成（复用 `functions/lib/aiProvider.ts`）
- prompt：给两句原文 + 各自书名章节，要求**一句话**点出「它们在哪个层面相通」，克制、有洞察、不空泛（对齐 seed 里 `why` 的调性）。
- 惰性：只在某条边**第一次被读到**时生成并回填 `echo_edges.why`，避免给永远没人看的边花钱。

### 6.6 Cron 聚类 / 维护（P2，`wrangler.toml [triggers] crons=["0 18 * * *"]`）
- 把近期新边按向量聚类 → 提炼 `theme`（如「不争 · 处下」）。
- 冷链接（`hits` 长期 0）`score` 衰减或转 `hidden`。
- 补算漏嵌的 sid（兜底幂等）。

### 6.7 灰度上线
1. 部署时 `GRAPH_ENABLED=false`：入队 no-op、`get_echoes` 完全走 seed → **零行为变化**。
2. 跑 backfill 脚本嵌入存量馆藏 + 写好 curated 边。
3. 打开 `GRAPH_ENABLED=true`：先内部账号灰度，肉眼验收呼应质量，再放量。

---

## 7. 验收标准

- [ ] **能力**：对一句**从没手写过呼应**的句子（含新导入书）问「这句和别的书有什么呼应？」→ `get_echoes` 返回**自动发现**的跨书呼应，且 `why` 有洞察、不空泛。
- [ ] **生长**：对某句产生新的划线/对话后，（队列处理完）该句邻域出现**新的或更强**的呼应边。
- [ ] **不丢老品味**：seed 里原有的手写惊艳呼应仍在，且排在自动边之前（`status='curated'`）。
- [ ] **零破坏**：`GRAPH_ENABLED=false` 时行为与今天逐字节一致；前端不改也正常。
- [ ] **不卡阅读**：划线/对话接口 P50 时延无明显上升（入队走 `waitUntil`，嵌入全异步）。
- [ ] **幂等/省钱**：同一 sid 不重复嵌入（`embeddings` 台账命中）；`why` 惰性生成。
- [ ] **可观测/可控**：Workers AI 嵌入调用量、队列积压、DLQ 在 Cloudflare 面板可见；阈值/topK 可配。
- [ ] typecheck + build 通过；线上实测一条「新书句子 → 自动呼应」端到端跑通。

---

## 8. 路线图（分阶段，别一次吃成胖子）

- **P0（先做）**：§6.1 spike——**只验证质量**，用三本书肉眼判断自动呼应惊不惊艳。**质量不过关就不要上产品**，先调模型/阈值/混排策略。
- **P1**：migration + Vectorize/Queue binding + 嵌入管线 + `get_echoes` 读动态边 + seed 兼容 + 灰度开关。MVP 完整闭环。
- **P2**：why 惰性生成、Cron 聚类提炼 theme、冷链接衰减、笔记/对话作为独立节点。
- **P3**：Durable Objects 做「每用户/每书的个人知识图谱」与实时增量；前端「思维链接图谱」可视化（力导向图）；呼应也接入 `/api/charts` 当信号。

---

## 9. 风险与注意

- **质量 > 一切**：纯语义相似很容易给出「看着像、其实平庸」的连接，配不上现有手写呼应的品味。
  **务必先 spike 验证**；上线后保留 `curated`（人工置顶）与 `hidden`（人工压制）作为品味兜底。
- **Pages Functions 跑 Queue consumer 不确定**：大概率需要**独立 consumer Worker**（同 repo、共享 binding）。§6.1 必须先验证，别假设 Pages 能直接消费。
- **成本盯 Workers AI 嵌入次数**：存量 backfill 是一次性；之后只增量。用 `embeddings` 台账严防重复嵌入；`why` 惰性化。Vectorize/Queue/D1 在 $5 计划内「包括 + 按量」，规模下月增量基本个位数美元。
- **sid 命名差异**（§2.3）：seed 裸键 vs 真实带书名 sid，必须在规范化层统一，否则老呼应取不到、新边对不上。
- **中文/文言 embedding**：选 `@cf/baai/bge-m3`（多语种）；若 spike 发现文言效果差，再评估别的模型或加「先白话化再嵌入」的预处理。
- **与既有改造并行**：`ai.ts` / `routes/ai.ts` / `liber-tools.ts` 云端 agent 化也在动；本方案**尽量加新文件**（`functions/lib/graph/*`），对既有文件只做 `get_echoes` 与写入点的最小注入，降低 rebase 冲突。
- **隐私**：用户私有笔记若作为节点，注意 `public` 标志——只有公开内容才进共享图谱，私有笔记的呼应只对本人可见（P2/P3 处理）。

---

## 附：为什么不用 pi / pi-worker 做这件事

「思维链接」的本质是 **embedding → 向量检索 → 落库成图 → LLM 写 why**，是一条**数据管线**，不是 agent 框架能力。
- pi（`pi-ai`/`pi-agent-core`）解决的是「让一个 agent 会调工具、多步推理」——那是 `AI_AGENT_SPEC.md` 的事，且项目已自研等价实现。
- pi-worker（`qaml-ai/pi-worker`）是「让 coding agent 跑在 Workers 上」的基建（代码沙箱 / 发布 Worker / 终端），与读书呼应无关。
- 本能力需要的 **Vectorize / Queues / Workers AI** 都是 Cloudflare 一等公民，`env.*` 直接可用，**引入 pi 只会增加无关依赖与 Workers 运行时风险**（pi 的 `./node` 子入口是 node-only）。

结论：**纯 Cloudflare 原生实现，零 pi 依赖。**
