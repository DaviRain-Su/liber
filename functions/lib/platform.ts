import type { Env, PlatformQueueMessage } from "./types";
import { activeProvider } from "./aiProvider";
import { all, first, id, now, run } from "./db";
import { getBook, getChapters, getChapterText, searchDynamic } from "./catalog";

export type PlatformJobType =
  | "index-book"
  | "index-chapter"
  | "prewarm-translation"
  | "render-share-card"
  | "render-book-cover"
  | "health-canary";

export interface PlatformJobInput {
  type: PlatformJobType;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  runAfter?: number | null;
}

interface SemanticDoc {
  id: string;
  bookId: string;
  chapterN: number | null;
  sid: string | null;
  title: string;
  text: string;
  lang: string;
  source: string;
  vectorId: string;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function gatewayOptions(env: Env, cache = true): Record<string, unknown> | undefined {
  const gatewayId = (env.AI_GATEWAY_ID || "").trim();
  if (!gatewayId) return undefined;
  const gateway: Record<string, unknown> = { id: gatewayId, skipCache: !cache };
  const ttl = parseInt(env.AI_GATEWAY_CACHE_TTL || "", 10);
  if (cache && Number.isFinite(ttl) && ttl > 0) gateway.cacheTtl = ttl;
  return { gateway };
}

function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chunkText(text: string, maxChars = 1800): string[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let acc = "";
  const push = () => {
    if (acc.trim()) chunks.push(acc.trim());
    acc = "";
  };
  for (const block of blocks.length ? blocks : [text]) {
    const piece = block.length > maxChars
      ? block.match(new RegExp(`.{1,${maxChars}}`, "gs")) || [block]
      : [block];
    for (const part of piece) {
      if ((acc + "\n\n" + part).length > maxChars) push();
      acc = acc ? `${acc}\n\n${part}` : part;
    }
  }
  push();
  return chunks;
}

async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (!env.AI) throw new Error("Workers AI 未绑定");
  const model = env.SEMANTIC_EMBEDDING_MODEL || "@cf/baai/bge-m3";
  const res: any = await env.AI.run(
    model,
    { text: texts.length === 1 ? texts[0] : texts },
    gatewayOptions(env, true),
  );
  const data = Array.isArray(res?.data) ? res.data : Array.isArray(res?.result?.data) ? res.result.data : null;
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("Workers AI embedding 返回为空");
  return data as number[][];
}

async function upsertSemanticDocument(env: Env, doc: SemanticDoc, indexedAt: number | null) {
  await run(
    env.DB,
    `INSERT INTO semantic_documents
      (id, book_id, chapter_n, sid, title, text, lang, vector_id, source, indexed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      text = excluded.text,
      lang = excluded.lang,
      vector_id = excluded.vector_id,
      source = excluded.source,
      indexed_at = excluded.indexed_at,
      updated_at = excluded.updated_at`,
    doc.id,
    doc.bookId,
    doc.chapterN,
    doc.sid,
    doc.title,
    doc.text,
    doc.lang,
    doc.vectorId,
    doc.source,
    indexedAt,
    now(),
    now(),
  );
}

export async function enqueuePlatformJob(env: Env, input: PlatformJobInput, userId?: string | null) {
  const jobId = id("job_");
  const createdAt = now();
  await run(
    env.DB,
    `INSERT INTO platform_jobs
      (id, type, status, priority, target_type, target_id, payload, created_by, created_at, updated_at, run_after)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    jobId,
    input.type,
    "queued",
    Number(input.priority || 0),
    input.targetType || null,
    input.targetId || null,
    json(input.payload || {}),
    userId || null,
    createdAt,
    createdAt,
    input.runAfter || null,
  );

  const message: PlatformQueueMessage = {
    id: jobId,
    type: input.type,
    targetType: input.targetType || null,
    targetId: input.targetId || null,
    payload: input.payload || {},
  };
  if (env.PLATFORM_QUEUE && env.PLATFORM_QUEUE_ENABLED !== "false") {
    const sent = await env.PLATFORM_QUEUE.send(message);
    await run(env.DB, `UPDATE platform_jobs SET result = ?, updated_at = ? WHERE id = ?`, json({ queue: sent.metadata?.metrics || true }), now(), jobId);
  } else {
    await run(env.DB, `UPDATE platform_jobs SET result = ?, updated_at = ? WHERE id = ?`, json({ queue: false, reason: "PLATFORM_QUEUE 未绑定" }), now(), jobId);
  }
  return { ...message, status: "queued" };
}

export async function platformStatus(env: Env) {
  const count = async (sql: string) => {
    try {
      const row = await first<{ n: number }>(env.DB, sql);
      return Number(row?.n || 0);
    } catch {
      return null;
    }
  };
  const safe = async <T>(fn: () => Promise<T>) => {
    try { return { ok: true, data: await fn() }; }
    catch (err) { return { ok: false, error: String(err instanceof Error ? err.message : err) }; }
  };
  const [jobs, pendingJobs, semanticDocs, shareAssets, vectorize, queue] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM platform_jobs`),
    count(`SELECT COUNT(*) AS n FROM platform_jobs WHERE status IN ('queued','running')`),
    count(`SELECT COUNT(*) AS n FROM semantic_documents WHERE indexed_at IS NOT NULL`),
    count(`SELECT COUNT(*) AS n FROM share_assets`),
    env.VECTORIZE ? safe(() => env.VECTORIZE!.describe()) : Promise.resolve({ ok: false, error: "未绑定" }),
    env.PLATFORM_QUEUE ? safe(() => env.PLATFORM_QUEUE!.metrics()) : Promise.resolve({ ok: false, error: "未绑定" }),
  ]);
  return {
    ok: true,
    provider: activeProvider(env),
    capabilities: {
      d1: !!env.DB,
      r2: !!env.R2,
      workersAi: !!env.AI,
      aiGateway: !!env.AI_GATEWAY_ID,
      vectorize: !!env.VECTORIZE,
      queues: !!env.PLATFORM_QUEUE,
      browserRendering: !!env.BROWSER,
      logsAndTrace: true,
    },
    counts: { jobs, pendingJobs, semanticDocs, shareAssets },
    vectorize,
    queue,
    time: now(),
  };
}

export async function recordPlatformMetric(env: Env, kind: string, scope: string | null, value: number | null, meta?: unknown) {
  await run(
    env.DB,
    `INSERT INTO platform_metrics (id, kind, scope, value, meta, created_at) VALUES (?,?,?,?,?,?)`,
    id("met_"),
    kind,
    scope,
    value,
    meta ? json(meta) : null,
    now(),
  );
}

export async function indexBookSemantics(env: Env, bookId: string) {
  const book = await getBook(env, bookId);
  if (!book) throw new Error("未找到该书");
  const rows = await all<{ n: number; title: string }>(
    env.DB,
    `SELECT n, title FROM library_chapters WHERE book_id = ? ORDER BY n ASC LIMIT 400`,
    bookId,
  );
  const chapters = rows.length
    ? (await Promise.all(rows.map((r) => getChapterText(env, bookId, Number(r.n))))).filter(Boolean) as Array<{ n: number; title: string; text: string }>
    : (await getChapters(env, bookId)).map((ch: any) => ({
        n: Number(ch.n),
        title: ch.title || `第 ${ch.n} 章`,
        text: (ch.paras || []).flat().map((s: any) => s.t).join("\n"),
      })).filter((ch: any) => ch.text);

  const docs: SemanticDoc[] = [];
  for (const ch of chapters) {
    chunkText(ch.text).forEach((text, i) => {
      const vectorId = `sem_${bookId}_c${ch.n}_${i + 1}`;
      docs.push({
        id: vectorId,
        bookId,
        chapterN: Number(ch.n),
        sid: null,
        title: ch.title || `第 ${ch.n} 章`,
        text,
        lang: book.lang || "zh",
        source: "chapter",
        vectorId,
      });
    });
  }
  if (!docs.length) throw new Error("没有可索引的章节正文");

  for (const doc of docs) await upsertSemanticDocument(env, doc, null);
  if (!env.VECTORIZE) return { bookId, documents: docs.length, vectorized: false, reason: "VECTORIZE 未绑定" };

  let vectorized = 0;
  for (let i = 0; i < docs.length; i += 16) {
    const batch = docs.slice(i, i + 16);
    const embeddings = await embedTexts(env, batch.map((doc) => doc.text));
    await env.VECTORIZE.upsert(batch.map((doc, idx) => ({
      id: doc.vectorId,
      values: embeddings[idx],
      namespace: "books",
      metadata: {
        bookId: doc.bookId,
        chapterN: doc.chapterN || 0,
        title: doc.title.slice(0, 120),
        lang: doc.lang,
        excerpt: doc.text.slice(0, 500),
      },
    })));
    const indexedAt = now();
    for (const doc of batch) await upsertSemanticDocument(env, doc, indexedAt);
    vectorized += batch.length;
  }
  await recordPlatformMetric(env, "semantic_indexed", bookId, vectorized, { documents: docs.length });
  return { bookId, documents: docs.length, vectorized };
}

export async function semanticSearch(env: Env, query: string, limit = 8) {
  const q = query.trim();
  if (!q) return { semantic: !!env.VECTORIZE, matches: [] };
  const fallback = async (reason: string) => {
    const dynamic = await searchDynamic(env, q);
    return {
      semantic: false,
      reason,
      matches: dynamic.sentences.slice(0, limit).map((s: any) => ({
        id: s.sid,
        score: null,
        text: s.t,
        bookId: s.bookId,
        book: s.book,
        chapter: s.chap,
        title: s.chap,
      })),
    };
  };
  if (!env.VECTORIZE) return fallback("VECTORIZE 未绑定");
  try {
    const [embedding] = await embedTexts(env, [q]);
    const res = await env.VECTORIZE.query(embedding, {
      namespace: "books",
      topK: Math.max(1, Math.min(limit, 20)),
      returnMetadata: "all",
    });
    const vectorIds = res.matches.map((m) => m.id).filter(Boolean);
    if (!vectorIds.length) return { semantic: true, matches: [] };
    const rows = await all<any>(
      env.DB,
      `SELECT sd.vector_id, sd.book_id, sd.chapter_n, sd.title, sd.text, lb.title AS book_title
       FROM semantic_documents sd LEFT JOIN library_books lb ON lb.id = sd.book_id
       WHERE sd.vector_id IN (${vectorIds.map(() => "?").join(",")})`,
      ...vectorIds,
    );
    const byVector = new Map(rows.map((r) => [r.vector_id, r]));
    return {
      semantic: true,
      matches: res.matches.map((m) => {
        const row = byVector.get(m.id);
        const meta: any = m.metadata || {};
        return {
          id: m.id,
          score: m.score,
          text: row?.text || meta.excerpt || "",
          bookId: row?.book_id || meta.bookId,
          book: row?.book_title || row?.book_id || meta.bookId,
          chapter: row?.chapter_n ? `第${row.chapter_n}章` : "",
          title: row?.title || meta.title || "",
        };
      }),
    };
  } catch (err) {
    return fallback(String(err instanceof Error ? err.message : err));
  }
}

function shareCardHtml(payload: Record<string, unknown>) {
  const quote = escapeHtml(payload.quote || payload.text || "读到一句值得留下的话。");
  const title = escapeHtml(payload.title || payload.bookTitle || "Liber");
  const author = escapeHtml(payload.author || "开放图书馆");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#f7f1e8;color:#241c14;font-family:"Songti SC","Noto Serif SC",serif}
  .card{width:1200px;height:630px;padding:70px 84px;display:flex;flex-direction:column;justify-content:space-between;border:18px solid #2d261f}
  .brand{font:18px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:#8a5a35;text-transform:uppercase}
  .quote{font-size:58px;line-height:1.28;font-weight:600;max-width:980px}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;font-size:28px;color:#6a5947}
  .meta b{display:block;color:#241c14;font-size:34px;margin-bottom:8px}.seal{width:74px;height:74px;border-radius:12px;background:#9d4828;color:white;display:grid;place-items:center;font-size:38px}
  </style></head><body><div class="card"><div class="brand">Liber Share Card</div><div class="quote">「${quote}」</div><div class="meta"><div><b>${title}</b>${author}</div><div class="seal">书</div></div></div></body></html>`;
}

export async function renderShareCard(env: Env, payload: Record<string, unknown>) {
  if (!env.BROWSER) throw new Error("BROWSER Rendering 未绑定");
  const assetId = id("asset_");
  const key = `generated/share-cards/${assetId}.png`;
  const res = await env.BROWSER.quickAction("screenshot", {
    html: shareCardHtml(payload),
    viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
    screenshotOptions: { type: "png", encoding: "binary", fullPage: false },
  });
  if (!res.ok) throw new Error(`Browser Rendering 失败：${res.status}`);
  const bytes = await res.arrayBuffer();
  await env.R2.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await run(
    env.DB,
    `INSERT INTO share_assets (id, share_id, kind, r2_key, content_type, width, height, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    assetId,
    String(payload.shareId || ""),
    "share-card",
    key,
    "image/png",
    1200,
    630,
    "ready",
    now(),
    now(),
  );
  await recordPlatformMetric(env, "share_card_rendered", String(payload.shareId || "manual"), 1, { key });
  return { id: assetId, key, contentType: "image/png", width: 1200, height: 630 };
}

export async function runPlatformJob(env: Env, input: string | PlatformQueueMessage) {
  const jobId = typeof input === "string" ? input : input.id;
  const row = await first<any>(env.DB, `SELECT * FROM platform_jobs WHERE id = ?`, jobId);
  if (!row) throw new Error("未找到任务");
  const payload = parsePayload(row.payload);
  await run(env.DB, `UPDATE platform_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?`, now(), now(), jobId);
  try {
    const result = row.type === "index-book"
      ? await indexBookSemantics(env, String(row.target_id || payload.bookId || ""))
      : row.type === "render-share-card"
        ? await renderShareCard(env, payload)
        : { skipped: true, reason: `${row.type} 尚未实现执行器` };
    await run(
      env.DB,
      `UPDATE platform_jobs SET status = 'done', result = ?, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?`,
      json(result),
      now(),
      now(),
      jobId,
    );
    return { id: jobId, status: "done", result };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    await run(
      env.DB,
      `UPDATE platform_jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      message,
      now(),
      now(),
      jobId,
    );
    throw err;
  }
}

export async function runDuePlatformJobs(env: Env, limit = 5) {
  const rows = await all<any>(
    env.DB,
    `SELECT id FROM platform_jobs
     WHERE status = 'queued' AND (run_after IS NULL OR run_after <= ?)
     ORDER BY priority DESC, created_at ASC LIMIT ?`,
    now(),
    Math.max(1, Math.min(limit, 20)),
  );
  const results: any[] = [];
  for (const row of rows) {
    try { results.push(await runPlatformJob(env, row.id)); }
    catch (err) { results.push({ id: row.id, status: "failed", error: String(err instanceof Error ? err.message : err) }); }
  }
  return results;
}
