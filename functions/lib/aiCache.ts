import type { Env } from "./types";
import { first, run, now } from "./db";
import { activeProvider } from "./aiProvider";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function translationCacheKey(input: {
  bookId?: string | null;
  chapter?: string | null;
  sourceText?: string | null;
  question?: string | null;
  model?: string | null;
}): Promise<string> {
  const source = [
    input.bookId || "",
    input.chapter || "",
    input.model || "",
    (input.sourceText || input.question || "").replace(/\s+/g, " ").trim(),
  ].join("\n");
  return `tr_${await sha256Hex(source)}`;
}

export async function getCachedTranslation(env: Env, cacheKey: string) {
  try {
    const row = await first<any>(
      env.DB,
      `SELECT cache_key, book_id, chapter_n, source_text, translated_text, model, provider, corrected_by, hits, updated_at
       FROM ai_translation_cache WHERE cache_key = ?`,
      cacheKey,
    );
    if (!row) return null;
    await run(env.DB, `UPDATE ai_translation_cache SET hits = hits + 1, updated_at = ? WHERE cache_key = ?`, now(), cacheKey);
    return {
      text: row.translated_text,
      ref: row.corrected_by ? "古文今译 · D1 纠错缓存" : "古文今译 · D1 缓存",
      cached: true,
      cacheKey,
      hits: Number(row.hits || 0) + 1,
      model: row.model,
      provider: row.provider,
    };
  } catch {
    return null;
  }
}

export async function putCachedTranslation(env: Env, input: {
  cacheKey: string;
  bookId?: string | null;
  chapterN?: number | null;
  sourceText: string;
  translatedText: string;
  model?: string | null;
  provider?: string | null;
}) {
  const provider = activeProvider(env);
  try {
    await run(
      env.DB,
      `INSERT INTO ai_translation_cache
        (cache_key, book_id, chapter_n, source_text, translated_text, model, provider, created_at, updated_at, hits)
       VALUES (?,?,?,?,?,?,?,?,?,0)
       ON CONFLICT(cache_key) DO UPDATE SET
        translated_text = excluded.translated_text,
        model = excluded.model,
        provider = excluded.provider,
        updated_at = excluded.updated_at`,
      input.cacheKey,
      input.bookId || null,
      input.chapterN || null,
      input.sourceText,
      input.translatedText,
      input.model || provider.model,
      input.provider || provider.provider,
      now(),
      now(),
    );
  } catch {
    // Cache misses should never make reading fail.
  }
}

export async function correctCachedTranslation(env: Env, input: {
  cacheKey: string;
  translatedText: string;
  userId: string;
}) {
  await run(
    env.DB,
    `UPDATE ai_translation_cache
     SET translated_text = ?, corrected_by = ?, updated_at = ?
     WHERE cache_key = ?`,
    input.translatedText,
    input.userId,
    now(),
    input.cacheKey,
  );
}
