import type { Env } from "./types";
import { all } from "./db";
import { getChapterText, textToChapter } from "./catalog";

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function startOfUtcWeek(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function startOfUtcYear(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

function streakDays(times: number[], nowMs = Date.now()): number {
  const days = new Set(times.filter(Boolean).map(dayKey));
  let cursor = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}

function chapterNumberFromSid(sid: string): number | null {
  const m = sid.match(/-c(\d+)-s\d+$/);
  return m ? Number(m[1]) : null;
}

export function emptyReadingStats() {
  return {
    read: 0,
    finished: 0,
    lines: 0,
    notes: 0,
    agreed: 0,
    streak: 0,
    weekRead: 0,
    yearFinished: 0,
  };
}

export async function readingStats(env: Env, userId?: string | null) {
  if (!userId) return emptyReadingStats();
  const nowMs = Date.now();
  const weekStart = startOfUtcWeek(nowMs);
  const yearStart = startOfUtcYear(nowMs);
  const [progress, highlights, notes, votes] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT p.book_id, p.chapter_n, p.percent, p.updated_at, lb.pages
       FROM progress p LEFT JOIN library_books lb ON lb.id = p.book_id
       WHERE p.user_id = ?`,
      userId,
    ),
    all<any>(env.DB, `SELECT created_at FROM highlights WHERE user_id = ?`, userId),
    all<any>(env.DB, `SELECT created_at FROM notes WHERE user_id = ?`, userId),
    all<any>(env.DB, `SELECT created_at FROM votes WHERE user_id = ?`, userId),
  ]);
  const activityTimes = [
    ...progress.map((r) => Number(r.updated_at || 0)),
    ...highlights.map((r) => Number(r.created_at || 0)),
    ...notes.map((r) => Number(r.created_at || 0)),
  ].filter(Boolean);
  const weekDays = new Set(activityTimes.filter((t) => t >= weekStart).map(dayKey));
  const finished = progress.filter((p) => {
    const pages = Number(p.pages || 0);
    const chapter = Number(p.chapter_n || 0);
    const percent = Number(p.percent || 0);
    return Number(p.updated_at || 0) >= yearStart && (percent >= 100 || (pages > 0 && chapter >= pages));
  }).length;
  return {
    read: progress.length,
    finished,
    lines: highlights.length,
    notes: notes.length,
    agreed: votes.length,
    streak: streakDays(activityTimes, nowMs),
    weekRead: weekDays.size,
    yearFinished: finished,
  };
}

export async function readingSummary(env: Env, userId?: string | null) {
  const stats = await readingStats(env, userId);
  if (!userId) {
    return { stats, reading: [], highlights: [], joinedGroupIds: [] };
  }

  const [progressRows, highlightRows, noteRows, groupRows] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT p.book_id, p.chapter_n, p.percent, p.updated_at, lb.title, lb.author, lb.cover_class, lb.seal, lb.pages
       FROM progress p LEFT JOIN library_books lb ON lb.id = p.book_id
       WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 100`,
      userId,
    ),
    all<any>(
      env.DB,
      `SELECT h.book_id, h.sid, h.color, h.created_at, lb.title
       FROM highlights h LEFT JOIN library_books lb ON lb.id = h.book_id
       WHERE h.user_id = ? ORDER BY h.created_at DESC LIMIT 100`,
      userId,
    ),
    all<any>(
      env.DB,
      `SELECT n.book_id, n.sid, n.text, n.color, n.up, n.created_at, lb.title
       FROM notes n LEFT JOIN library_books lb ON lb.id = n.book_id
       WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`,
      userId,
    ),
    all<any>(env.DB, `SELECT group_id FROM group_members WHERE user_id = ?`, userId),
  ]);

  const chapterCache = new Map<string, Promise<any | null>>();
  const sentenceFor = async (bookId: string, sid: string) => {
    const n = chapterNumberFromSid(sid);
    if (!n) return { text: sid, chap: "" };
    const key = `${bookId}:${n}`;
    if (!chapterCache.has(key)) {
      chapterCache.set(key, (async () => {
        const content = await getChapterText(env, bookId, n);
        return content ? textToChapter(bookId, content.n, content.title, content.text) : null;
      })());
    }
    const ch = await chapterCache.get(key);
    const sentence = ch?.paras?.flat?.().find((s: any) => s.id === sid);
    return { text: sentence?.t || sid, chap: ch ? `第 ${ch.n} 章 · ${ch.title}` : `第 ${n} 章` };
  };

  const latestNote = new Map<string, any>();
  for (const n of noteRows) {
    const key = `${n.book_id}:${n.sid}`;
    if (!latestNote.has(key)) latestNote.set(key, n);
  }

  const highlightKeys = new Set<string>();
  const highlights: any[] = [];
  for (const h of highlightRows) {
    const key = `${h.book_id}:${h.sid}`;
    highlightKeys.add(key);
    const sentence = await sentenceFor(h.book_id, h.sid);
    const note = latestNote.get(key);
    highlights.push({
      bookId: h.book_id,
      book: h.title || h.book_id,
      sid: h.sid,
      chap: sentence.chap,
      color: h.color || "hl-user",
      t: sentence.text,
      note: note?.text || "",
      when: "刚刚",
      live: true,
      createdAt: h.created_at,
    });
  }
  for (const n of noteRows) {
    const key = `${n.book_id}:${n.sid}`;
    if (highlightKeys.has(key)) continue;
    const sentence = await sentenceFor(n.book_id, n.sid);
    highlights.push({
      bookId: n.book_id,
      book: n.title || n.book_id,
      sid: n.sid,
      chap: sentence.chap,
      color: n.color || "hl-user",
      t: sentence.text,
      note: n.text,
      when: "刚刚",
      live: true,
      createdAt: n.created_at,
    });
  }

  const reading = progressRows.map((p) => ({
    id: p.book_id,
    at: p.chapter_n ? `第 ${p.chapter_n} 章 · ${Math.round(Number(p.percent || 0))}%` : `${Math.round(Number(p.percent || 0))}%`,
    chapter: p.chapter_n,
    percent: Number(p.percent || 0),
    updatedAt: p.updated_at,
  }));

  return {
    stats,
    reading,
    highlights: highlights.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
    joinedGroupIds: groupRows.map((g) => g.group_id),
  };
}
