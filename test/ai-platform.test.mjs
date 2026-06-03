import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const aiProvider = await readFile(
  new URL("../functions/lib/aiProvider.ts", import.meta.url),
  "utf8",
);
const aiRoute = await readFile(new URL("../functions/routes/ai.ts", import.meta.url), "utf8");
const aiCache = await readFile(new URL("../functions/lib/aiCache.ts", import.meta.url), "utf8");
const aiPrompts = await readFile(new URL("../functions/lib/ai.ts", import.meta.url), "utf8");
const types = await readFile(new URL("../functions/lib/types.ts", import.meta.url), "utf8");
const productData = await readFile(new URL("../src/data/product-data.js", import.meta.url), "utf8");
const readerSource = await readFile(
  new URL("../src/components/product-reader.jsx", import.meta.url),
  "utf8",
);
const backendDoc = await readFile(new URL("../BACKEND.md", import.meta.url), "utf8");

test("Workers AI defaults avoid deprecated Qwen1.5 and expose AI Gateway knobs", () => {
  assert.match(aiProvider, /"workers-ai": "@cf\/qwen\/qwen3-30b-a3b-fp8"/);
  assert.doesNotMatch(aiProvider, /qwen1\.5-14b-chat-awq/);
  assert.match(types, /AI_TRANSLATION_MODEL\?: string/);
  assert.match(types, /AI_GATEWAY_ID\?: string/);
  assert.match(aiProvider, /gatewayOptions\(env, opts\)/);
});

test("classical Chinese translation is a first-class reader lens", () => {
  assert.match(aiPrompts, /translate:\s*"你是「今译 Agent」/);
  assert.match(aiPrompts, /temperature: translate \? 0\.2 : 0\.7/);
  assert.match(productData, /id:"translate", name:"古文今译"/);
  assert.match(readerSource, /translateSelection/);
  assert.match(readerSource, />\s*\{I\.spark\} 今译\s*<\/button>/);
  assert.match(readerSource, /翻译成现代白话/);
});

test("translation requests use Gateway-friendly D1 cache with correction path", () => {
  assert.match(aiRoute, /getCachedTranslation/);
  assert.match(aiRoute, /putCachedTranslation/);
  assert.match(aiRoute, /PUT.*translations|ai\.put\("\/translations\/:cacheKey"/s);
  assert.match(aiCache, /ai_translation_cache/);
  assert.match(aiCache, /corrected_by/);
});

test("backend docs describe paid Cloudflare AI upgrade path", () => {
  assert.match(backendDoc, /AI_GATEWAY_ID/);
  assert.match(backendDoc, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
  assert.match(backendDoc, /古文今译/);
});
