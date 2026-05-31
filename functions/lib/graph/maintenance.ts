// Graph maintenance + backfill (KNOWLEDGE_GRAPH_SPEC §6.2 / §6.6).
// Used by the admin routes and the Cron consumer. Everything is a no-op unless
// the graph is enabled, so importing this is always safe.
import type { Env } from "../types";
import { all, first, run, now } from "../db";
import * as S from "../seed";
import { getChapters, hasLibraryBooks, listBooks } from "../catalog";
import { aiChat } from "../aiProvider";
import { enqueueSids, graphEnabled } from "./embed";

// Enqueue every sentence in the catalogue for embedding. Idempotent: the
// consumer skips sids already embedded with the current model. Returns how many
// sentences were enqueued so the caller can report progress.
export async function backfillAll(env: Env): Promise<{ books: number; sentences: number }> {
  if (!graphEnabled(env)) return { books: 0, sentences: 0 };

  // live library if present, else the seed sample books
  let bookIds: string[];
  if (await hasLibraryBooks(env)) {
    const rows = await listBooks(env, { limit: 2000 });
    bookIds = rows.map((b: any) => b.id);
  } else {
    bookIds = Object.keys(S.BOOK_CONTENT);
  }

  let sentences = 0;
  for (const bookId of bookIds) {
    const chapters = await getChapters(env, bookId).catch(() => []);
    for (const ch of chapters) {
      const sids: string[] = [];
      const texts: Record<string, string> = {};
      for (const para of ch.paras || []) {
        for (const s of para) {
          if (!s?.id || !s?.t) continue;
          sids.push(s.id);
          texts[s.id] = s.t;
        }
      }
      if (sids.length) {
        await enqueueSids(env, sids, texts);
        sentences += sids.length;
      }
    }
  }
  return { books: bookIds.length, sentences };
}

// Snapshot of graph state for the admin/status route.
export async function graphStats(env: Env): Promise<Record<string, any>> {
  const enabled = graphEnabled(env);
  const [emb, edges, autoEdges, curated, withWhy, themed] = await Promise.all([
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM embeddings`).catch(() => null),
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM echo_edges`).catch(() => null),
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM echo_edges WHERE status = 'auto'`).catch(() => null),
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM echo_edges WHERE status = 'curated'`).catch(() => null),
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM echo_edges WHERE why IS NOT NULL AND why != ''`).catch(() => null),
    first<any>(env.DB, `SELECT COUNT(*) AS n FROM echo_edges WHERE theme IS NOT NULL AND theme != ''`).catch(() => null),
  ]);
  return {
    enabled,
    model: env.GRAPH_EMBED_MODEL || "@cf/baai/bge-m3",
    minScore: Number(env.GRAPH_MIN_SCORE || 0.78),
    topK: Number(env.GRAPH_TOPK || 8),
    embeddings: emb?.n || 0,
    edges: edges?.n || 0,
    autoEdges: autoEdges?.n || 0,
    curatedEdges: curated?.n || 0,
    edgesWithWhy: withWhy?.n || 0,
    themedEdges: themed?.n || 0,
  };
}

// Nightly maintenance (Cron): label clusters with a theme, decay cold links.
// Conservative + idempotent so it's safe to run repeatedly.
export async function runMaintenance(env: Env): Promise<{ themed: number; hidden: number }> {
  if (!graphEnabled(env)) return { themed: 0, hidden: 0 };

  // 1) theme a handful of strong, still-unthemed auto edges (cheap, capped).
  const unthened = await all<any>(
    env.DB,
    `SELECT id, src_sid, dst_sid, src_book, dst_book FROM echo_edges
      WHERE (theme IS NULL OR theme = '') AND status != 'hidden'
      ORDER BY score DESC LIMIT 20`,
  ).catch(() => []);
  let themed = 0;
  for (const e of unthened) {
    try {
      const sys = "用 2–6 个字给这对跨书呼应起一个主题标签（如「不争 · 处下」「语言 · 不可说」），只回标签本身。";
      const user = `《${S.bookById(e.src_book)?.t || e.src_book}》与《${S.bookById(e.dst_book)?.t || e.dst_book}》的一处思想呼应。`;
      const theme = (await aiChat(env, [{ role: "system", content: sys }, { role: "user", content: user }], { maxTokens: 24, temperature: 0.4 })).trim().slice(0, 24);
      if (theme) { await run(env.DB, `UPDATE echo_edges SET theme = ?, updated_at = ? WHERE id = ?`, theme, now(), e.id); themed++; }
    } catch { /* skip this one */ }
  }

  // 2) decay: auto edges never surfaced (hits=0) and weak go hidden, keeping the
  //    graph from filling up with mediocre links. Curated edges are untouched.
  const weak = parseFloat(env.GRAPH_MIN_SCORE || "") || 0.78;
  const res = await run(
    env.DB,
    `UPDATE echo_edges SET status = 'hidden', updated_at = ?
      WHERE status = 'auto' AND hits = 0 AND score < ?
        AND created_at < ?`,
    now(), weak + 0.03, now() - 14 * 24 * 60 * 60 * 1000,
  ).catch(() => null as any);
  const hidden = res?.meta?.changes ?? 0;

  return { themed, hidden };
}
