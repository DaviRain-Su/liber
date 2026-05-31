// Live cross-book echoes (KNOWLEDGE_GRAPH_SPEC §6.4 / §6.5).
// Reads dynamic echo_edges from D1 and shapes them to look EXACTLY like the seed
// ECHOES entries ({ theme, items:[{bookT, bookId, chap, quote, why}] }), so the
// agent loop, reader drawer, and /api/mcp consume them without any change.
// Falls back to the hand-written seed dictionary when there's no live data.
import type { Env } from "../types";
import { all, run, now } from "../db";
import * as S from "../seed";
import { aiChat } from "../aiProvider";
import { getChapters } from "../catalog";
import { parseSid, toFullSid, toSeedKey } from "./sid";
import { graphEnabled } from "./embed";

interface EdgeRow {
  id: string;
  other_sid: string;
  other_book: string;
  score: number;
  why: string | null;
  theme: string | null;
}

// Look a sentence's text + chapter title up from the catalogue (seed or live).
async function sentenceInfo(env: Env, sid: string): Promise<{ quote: string; chap: string; bookT: string } | null> {
  const p = parseSid(sid);
  if (!p) return null;
  const book = S.bookById(p.bookId);
  const chapters = await getChapters(env, p.bookId).catch(() => []);
  const ch = chapters.find((x: any) => x.n === p.n) || null;
  let quote = "";
  if (ch) {
    for (const para of ch.paras || []) {
      const hit = para.find((s: any) => s.id === sid);
      if (hit) { quote = hit.t; break; }
    }
  }
  return { quote, chap: ch ? `第${ch.n}章 · ${ch.title}` : `第${p.n}章`, bookT: book?.t || p.bookId };
}

// Generate (and persist) the "why these connect" line for an edge, lazily — only
// when an edge is first surfaced — to avoid paying for edges nobody reads.
async function ensureWhy(env: Env, edge: EdgeRow, srcQuote: string, dstQuote: string, srcBookT: string, dstBookT: string): Promise<string> {
  if (edge.why) return edge.why;
  let why = "";
  try {
    const sys = "你是 Liber 的跨书呼应编辑。给你两本书里的两句话，请用一句话点出它们在思想层面如何相通，" +
      "克制、具体、有洞察，不要空泛，不要复述原文，直接给那句话本身。";
    const user = `《${srcBookT}》：「${srcQuote}」\n《${dstBookT}》：「${dstQuote}」\n它们如何相通？`;
    why = (await aiChat(env, [{ role: "system", content: sys }, { role: "user", content: user }], { maxTokens: 120, temperature: 0.5 })).trim();
  } catch { /* leave empty; caller still renders the pairing */ }
  if (why) {
    await run(env.DB, `UPDATE echo_edges SET why = ?, updated_at = ? WHERE id = ?`, why, now(), edge.id).catch(() => {});
  }
  return why;
}

// Live echoes for a sentence, or null when none in D1. Shape matches seed ECHOES.
export async function liveEchoes(env: Env, sid: string, limit = 5): Promise<{ theme: string; items: any[] } | null> {
  if (!graphEnabled(env)) return null;
  const full = toFullSid(sid);
  const rows = await all<EdgeRow>(
    env.DB,
    `SELECT id,
            CASE WHEN src_sid = ? THEN dst_sid ELSE src_sid END AS other_sid,
            CASE WHEN src_sid = ? THEN dst_book ELSE src_book END AS other_book,
            score, why, theme
       FROM echo_edges
      WHERE (src_sid = ? OR dst_sid = ?) AND status != 'hidden'
      ORDER BY CASE status WHEN 'curated' THEN 0 ELSE 1 END, score DESC
      LIMIT ?`,
    full, full, full, full, limit,
  ).catch(() => [] as EdgeRow[]);
  if (!rows.length) return null;

  const src = await sentenceInfo(env, full);
  const items: any[] = [];
  for (const edge of rows) {
    const info = await sentenceInfo(env, edge.other_sid);
    if (!info) continue;
    const book = S.bookById(edge.other_book);
    const why = await ensureWhy(env, edge, src?.quote || "", info.quote, src?.bookT || "", info.bookT);
    items.push({
      bookT: info.bookT,
      bookId: edge.other_book,
      chap: info.chap,
      quote: info.quote,
      why,
      seal: book?.seal,
      inLib: !!book,
    });
    // count a surface hit (heat / decay signal); best-effort
    await run(env.DB, `UPDATE echo_edges SET hits = hits + 1 WHERE id = ?`, edge.id).catch(() => {});
  }
  if (!items.length) return null;
  const theme = rows.find((r) => r.theme)?.theme || "跨书呼应";
  return { theme, items };
}

// Used by the get_echoes tool. Merges the hand-written seed echoes (kept FIRST,
// as the taste baseline) with auto-discovered live edges (de-duped, appended).
// Falls back to pure seed when the graph is off or has nothing — i.e. today's
// behaviour is preserved, and a sentence never LOSES its curated echoes just
// because the machine also found some (KNOWLEDGE_GRAPH_SPEC §7).
export async function echoesForSid(env: Env, sid: string): Promise<any> {
  const seedKey = toSeedKey(sid) || sid;
  const seed = S.ECHOES[seedKey] || S.ECHOES[sid] || null;
  const live = await liveEchoes(env, sid).catch(() => null);

  if (!live) return seed;
  if (!seed) return live;

  // merge: seed items first, then live items not already present (by book+quote)
  const seen = new Set<string>(
    (seed.items || []).map((it: any) => `${it.bookId || it.bookT}|${(it.quote || "").trim()}`),
  );
  const extra = (live.items || []).filter(
    (it: any) => !seen.has(`${it.bookId || it.bookT}|${(it.quote || "").trim()}`),
  );
  return { theme: seed.theme, items: [...(seed.items || []), ...extra] };
}
