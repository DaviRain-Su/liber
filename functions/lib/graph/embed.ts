// Embedding pipeline for the living knowledge graph (KNOWLEDGE_GRAPH_SPEC §6.2).
// Producer side (enqueueSids) is called next to existing D1 writes; the heavy
// work (embed → Vectorize upsert → nearest-neighbour → echo_edges) runs in the
// queue consumer. Everything is gated on GRAPH_ENABLED + a VECTORIZE binding,
// so with the defaults this module is inert and behaviour matches today.
import type { Env } from "../types";
import { all, first, run, id, now } from "../db";
import { getChapters } from "../catalog";
import { toFullSid, parseSid } from "./sid";

export const DEFAULT_EMBED_MODEL = "@cf/baai/bge-m3";
export const EMBED_DIM = 1024;

export interface EmbedMsg {
  // Canonical (book-prefixed) sentence ids to embed + link.
  sids: string[];
  // Optional inline text (ingest path already has it) so the consumer can skip
  // a chapter load. Keyed by full sid.
  texts?: Record<string, string>;
}

export function graphEnabled(env: Env): boolean {
  return env.GRAPH_ENABLED === "true" && !!env.VECTORIZE;
}

function embedModel(env: Env): string {
  return env.GRAPH_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

function minScore(env: Env): number {
  const n = parseFloat(env.GRAPH_MIN_SCORE || "");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.78;
}

function topK(env: Env): number {
  const n = parseInt(env.GRAPH_TOPK || "", 10);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 8;
}

// Producer: fire-and-forget a batch of sids onto the embed queue. No-op unless
// the graph is enabled and a queue is bound. Never throws (best-effort, must not
// block the originating write). Wrap the call in c.executionCtx.waitUntil(...).
export async function enqueueSids(env: Env, sids: string[], texts?: Record<string, string>): Promise<void> {
  if (!graphEnabled(env) || !env.EMBED_QUEUE) return;
  const full = Array.from(new Set(sids.map(toFullSid).filter(Boolean)));
  if (!full.length) return;
  try {
    const msg: EmbedMsg = texts ? { sids: full, texts } : { sids: full };
    await env.EMBED_QUEUE.send(msg);
  } catch { /* metering/graph must never block the user write */ }
}

// Resolve sentence text for sids we weren't handed inline — grouped by book so
// each chapter is loaded at most once.
async function resolveTexts(env: Env, sids: string[], inline?: Record<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const sid of sids) {
    const t = inline?.[sid];
    if (t) out.set(sid, t);
    else missing.push(sid);
  }
  if (!missing.length) return out;
  // group missing by book
  const byBook = new Map<string, string[]>();
  for (const sid of missing) {
    const p = parseSid(sid);
    if (!p) continue;
    const group = byBook.get(p.bookId) ?? [];
    group.push(sid);
    byBook.set(p.bookId, group);
  }
  for (const [bookId, group] of byBook) {
    const chapters = await getChapters(env, bookId).catch(() => []);
    const index = new Map<string, string>();
    for (const ch of chapters) {
      for (const para of ch.paras || []) {
        for (const s of para) if (s?.id && s?.t) index.set(s.id, s.t);
      }
    }
    for (const sid of group) {
      const t = index.get(sid);
      if (t) out.set(sid, t);
    }
  }
  return out;
}

// Embed a batch of texts via Workers AI. Returns vectors aligned to input order.
async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  const res: any = await env.AI.run(embedModel(env), { text: texts });
  const data = res?.data ?? res?.embeddings ?? res?.result?.data;
  if (!Array.isArray(data)) throw new Error("embedding: unexpected AI response shape");
  return data as number[][];
}

// Consumer core: embed the batch, upsert to Vectorize, discover cross-book
// neighbours, and persist echo_edges. Idempotent via the `embeddings` ledger.
export async function processEmbedBatch(env: Env, msgs: EmbedMsg[]): Promise<void> {
  if (!graphEnabled(env)) return;
  const vec = env.VECTORIZE!;
  const model = embedModel(env);

  // de-dup sids across the batch + collect any inline text
  const inline: Record<string, string> = {};
  const sidSet = new Set<string>();
  for (const m of msgs) {
    for (const sid of m.sids || []) sidSet.add(toFullSid(sid));
    if (m.texts) for (const [k, v] of Object.entries(m.texts)) inline[toFullSid(k)] = v;
  }
  const sids = Array.from(sidSet);
  if (!sids.length) return;

  // skip sids already embedded with the current model (idempotency / cost)
  const todo: string[] = [];
  for (const sid of sids) {
    const seen = await first<any>(env.DB, `SELECT model FROM embeddings WHERE sid = ?`, sid);
    if (!seen || seen.model !== model) todo.push(sid);
  }
  if (!todo.length) return;

  const textMap = await resolveTexts(env, todo, inline);
  const pending = todo.filter((sid) => textMap.get(sid));
  if (!pending.length) return;

  const vectors = await embedTexts(env, pending.map((sid) => textMap.get(sid)!));

  // upsert vectors + record the ledger
  const toUpsert = pending.map((sid, i) => {
    const p = parseSid(sid);
    return { id: sid, values: vectors[i], metadata: { bookId: p?.bookId || "", n: p?.n ?? 0 } };
  });
  await vec.upsert(toUpsert as any);
  for (const sid of pending) {
    const p = parseSid(sid);
    await run(
      env.DB,
      `INSERT INTO embeddings (sid, book_id, model, dim, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(sid) DO UPDATE SET model = excluded.model, dim = excluded.dim, created_at = excluded.created_at`,
      sid, p?.bookId || "", model, vectors[0]?.length || EMBED_DIM, now(),
    );
  }

  // discover cross-book neighbours for each freshly embedded sentence
  const k = topK(env);
  const threshold = minScore(env);
  for (let i = 0; i < pending.length; i++) {
    const srcSid = pending[i];
    const srcBook = parseSid(srcSid)?.bookId || "";
    let matches: any;
    try {
      matches = await vec.query(vectors[i] as any, { topK: k + 4, returnMetadata: true } as any);
    } catch { continue; }
    for (const match of matches?.matches || []) {
      const dstSid: string = match.id;
      if (dstSid === srcSid) continue;
      const dstBook = (match.metadata?.bookId as string) || parseSid(dstSid)?.bookId || "";
      if (!dstBook || dstBook === srcBook) continue; // cross-book only
      const score = Number(match.score || 0);
      if (score < threshold) continue;
      await upsertEdge(env, srcSid, dstSid, srcBook, dstBook, score);
    }
  }
}

// Insert/refresh one echo edge, normalized so src < dst for stable de-dup.
async function upsertEdge(env: Env, a: string, b: string, aBook: string, bBook: string, score: number): Promise<void> {
  const [srcSid, dstSid, srcBook, dstBook] = a < b ? [a, b, aBook, bBook] : [b, a, bBook, aBook];
  await run(
    env.DB,
    `INSERT INTO echo_edges (id, src_sid, dst_sid, src_book, dst_book, score, status, hits, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'auto',0,?,?)
     ON CONFLICT(src_sid, dst_sid) DO UPDATE SET
       score = MAX(echo_edges.score, excluded.score), updated_at = excluded.updated_at`,
    id("ee_"), srcSid, dstSid, srcBook, dstBook, score, now(), now(),
  );
}
