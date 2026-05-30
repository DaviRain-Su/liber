// Shared seed data — the SAME catalogue/content the frontend renders, so the
// API serves identical reference data. User-generated content (D1) is merged on
// top of these baselines on read. One source of truth for both tiers.
// @ts-ignore — plain-JS data module with named exports (no type declarations)
import * as seed from "../../src/data/product-data.js";

const s = seed as Record<string, any>;

export const BOOKS = s.BOOKS as any[];
export const CHAPTERS = s.CHAPTERS as any[];
export const TOC = s.TOC as any[];
export const ANNOTATIONS = s.ANNOTATIONS as Record<string, any[]>;
export const HIGHLIGHTS = s.HIGHLIGHTS as any[];
export const REVIEWS = s.REVIEWS as any[];
export const ME = s.ME as any;
export const SEED_HL = s.SEED_HL as any[];
export const AI_SUMMARIES = s.AI_SUMMARIES as any[];
export const FEED = s.FEED as any[];
export const THREAD = s.THREAD as any;
export const CONVOS = s.CONVOS as any[];
export const GROUPS = s.GROUPS as any[];
export const SHARED_CONVOS = s.SHARED_CONVOS as any[];
export const ECHOES = s.ECHOES as Record<string, any>;
export const AGENTS = s.AGENTS as Record<string, any>;
export const LENSES = s.LENSES as any[];
export const CHARTS = s.CHARTS as Record<string, any>;
export const SURGE = s.SURGE as Record<string, any>;
export const HOT_SENTENCES = s.HOT_SENTENCES as any[];

export function bookById(bid: string) {
  return BOOKS.find((b) => b.id === bid) || null;
}

// flat map of sentence id -> { text, chapter } for 道德经 sample content
export function sentenceIndex(): Record<string, { t: string; chap: string }> {
  const out: Record<string, { t: string; chap: string }> = {};
  for (const c of CHAPTERS) {
    for (const para of c.paras) {
      for (const sObj of para) out[sObj.id] = { t: sObj.t, chap: "第" + c.n + "章" };
    }
  }
  return out;
}
