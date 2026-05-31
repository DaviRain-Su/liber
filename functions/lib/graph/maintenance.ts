// Graph maintenance + backfill (KNOWLEDGE_GRAPH_SPEC §6.2 / §6.6).
// Used by the admin routes and the Cron consumer. Everything is a no-op unless
// the graph is enabled, so importing this is always safe.
import type { Env } from "../types";
import { all, first, run, now } from "../db";
import * as S from "../seed";
import { getChapters, hasLibraryBooks, listBooks } from "../catalog";
import { aiChat } from "../aiProvider";
import { enqueueSids, graphEnabled } from "./embed";
import { parseSid, toFullSid } from "./sid";

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

// Library-wide echo graph for visualization (frontend product-graph.jsx).
// Live echo_edges when present; otherwise derived from the hand-written seed
// ECHOES so the viz is meaningful even before any live data exists. Nodes are
// books (sized by how many echoes touch them); edges are book↔book links
// (weighted by how many sentence-level echoes connect that pair).
export async function graphMap(env: Env, opts: { limit?: number } = {}): Promise<{ source: string; nodes: any[]; edges: any[] }> {
  const limit = Math.min(Math.max(opts.limit || 400, 1), 2000);
  const bookMeta = (id: string) => {
    const b = S.bookById(id);
    return { t: b?.t || id, seal: b?.seal || "·", cls: b?.cls || "ink" };
  };

  // pair key + accumulators
  const pairWeight = new Map<string, { a: string; b: string; weight: number; score: number }>();
  const nodeHits = new Map<string, number>();
  const bump = (aBook: string, bBook: string, score: number) => {
    if (!aBook || !bBook || aBook === bBook) return;
    const [a, b] = aBook < bBook ? [aBook, bBook] : [bBook, aBook];
    const key = `${a}|${b}`;
    const cur = pairWeight.get(key) || { a, b, weight: 0, score: 0 };
    cur.weight += 1;
    cur.score = Math.max(cur.score, score);
    pairWeight.set(key, cur);
    nodeHits.set(a, (nodeHits.get(a) || 0) + 1);
    nodeHits.set(b, (nodeHits.get(b) || 0) + 1);
  };

  let source = "seed";
  if (graphEnabled(env)) {
    const rows = await all<any>(
      env.DB,
      `SELECT src_book, dst_book, score FROM echo_edges WHERE status != 'hidden' ORDER BY score DESC LIMIT ?`,
      limit,
    ).catch(() => []);
    if (rows.length) {
      source = "live";
      for (const r of rows) bump(r.src_book, r.dst_book, Number(r.score || 0));
    }
  }
  if (source === "seed") {
    // derive book↔book pairs from seed ECHOES (anchor = seed book 道德经)
    for (const [, data] of Object.entries(S.ECHOES)) {
      const items = (data as any)?.items || [];
      for (const it of items) {
        if (!it.bookId) continue; // seed marks out-of-library items without an id
        bump("daodejing", it.bookId, 0.9);
      }
    }
  }

  const nodes = [...nodeHits.entries()].map(([id, hits]) => ({ id, ...bookMeta(id), weight: hits }));
  const edges = [...pairWeight.values()].map((p) => ({ source: p.a, target: p.b, weight: p.weight, score: Number(p.score.toFixed(3)) }));
  return { source, nodes, edges };
}

// Echo graph centered on ONE sentence: the anchor + its direct neighbours, with
// the real quotes/why. Powers the reader's per-sentence echo constellation when
// live (falls back to seed in echoesForSid on the read path).
export async function sentenceGraph(env: Env, sid: string): Promise<{ anchor: string; neighbours: any[] } | null> {
  if (!graphEnabled(env)) return null;
  const full = toFullSid(sid);
  const rows = await all<any>(
    env.DB,
    `SELECT CASE WHEN src_sid = ? THEN dst_sid ELSE src_sid END AS other_sid,
            CASE WHEN src_sid = ? THEN dst_book ELSE src_book END AS other_book,
            score
       FROM echo_edges
      WHERE (src_sid = ? OR dst_sid = ?) AND status != 'hidden'
      ORDER BY score DESC LIMIT 12`,
    full, full, full, full,
  ).catch(() => []);
  if (!rows.length) return null;
  return {
    anchor: full,
    neighbours: rows.map((r: any) => ({ sid: r.other_sid, book: r.other_book, n: parseSid(r.other_sid)?.n, score: Number(r.score || 0) })),
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
