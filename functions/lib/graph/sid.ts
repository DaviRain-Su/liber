// Sentence-id normalization — bridges the §2.3 naming gap:
//   • seed ECHOES keys are BARE:    "c8-s1"
//   • real/ingested sentence ids are FULL: "${bookId}-c${n}-s${i}"  e.g. "daodejing-c8-s1"
// The seed sample content (CHAPTERS / ECHOES) is 道德经, so a bare key implies that book.
const SEED_BOOK = "daodejing";

export interface ParsedSid {
  bookId: string; // resolved book id (SEED_BOOK for bare keys)
  n: number; // chapter number
  i: number; // sentence index within chapter
  bare: boolean; // true when the input had no book prefix
}

// Accept both "c8-s1" and "daodejing-c8-s1". Returns null for anything else.
export function parseSid(sid: string): ParsedSid | null {
  const s = String(sid || "").trim();
  let m = s.match(/^(.*)-c(\d+)-s(\d+)$/);
  if (m && m[1]) return { bookId: m[1], n: Number(m[2]), i: Number(m[3]), bare: false };
  m = s.match(/^c(\d+)-s(\d+)$/);
  if (m) return { bookId: SEED_BOOK, n: Number(m[1]), i: Number(m[2]), bare: true };
  return null;
}

// Canonical, book-prefixed id used everywhere in the graph (Vectorize, edges).
export function toFullSid(sid: string): string {
  const p = parseSid(sid);
  if (!p) return sid;
  return `${p.bookId}-c${p.n}-s${p.i}`;
}

// The bare key used to look a sentence up in the seed ECHOES dictionary, or null
// when the sentence isn't from the seed book (seed ECHOES only covers 道德经).
export function toSeedKey(sid: string): string | null {
  const p = parseSid(sid);
  if (!p) return null;
  if (p.bookId !== SEED_BOOK) return null;
  return `c${p.n}-s${p.i}`;
}
