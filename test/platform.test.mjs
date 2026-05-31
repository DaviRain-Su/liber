import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
const platformWrangler = await readFile(new URL("../wrangler.platform.toml", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0008_platform_ops.sql", import.meta.url), "utf8");
const types = await readFile(new URL("../functions/lib/types.ts", import.meta.url), "utf8");
const apiRoute = await readFile(new URL("../functions/api/[[route]].ts", import.meta.url), "utf8");
const platformLib = await readFile(new URL("../functions/lib/platform.ts", import.meta.url), "utf8");
const platformRoute = await readFile(new URL("../functions/routes/platform.ts", import.meta.url), "utf8");
const platformWorker = await readFile(new URL("../workers/platform-worker.ts", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../src/lib/api.js", import.meta.url), "utf8");
const searchSource = await readFile(new URL("../src/components/product-search.jsx", import.meta.url), "utf8");
const agentView = await readFile(new URL("../src/components/product-agentview.jsx", import.meta.url), "utf8");
const backendDoc = await readFile(new URL("../BACKEND.md", import.meta.url), "utf8");

test("Cloudflare paid bindings are declared for Pages and the platform worker", () => {
  assert.match(wrangler, /\[\[vectorize\]\]\s+binding = "VECTORIZE"/);
  assert.match(wrangler, /\[\[queues\.producers\]\]\s+binding = "PLATFORM_QUEUE"/);
  assert.match(wrangler, /\[browser\]\s+binding = "BROWSER"/);
  assert.match(platformWrangler, /\[\[queues\.consumers\]\]\s+queue = "liber-platform"/);
  assert.match(platformWrangler, /main = "workers\/platform-worker\.ts"/);
});

test("D1 platform migration tracks jobs, vectors, AI cache, metrics, and assets", () => {
  for (const table of [
    "platform_jobs",
    "semantic_documents",
    "ai_translation_cache",
    "share_assets",
    "platform_metrics",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("backend exposes platform status, semantic search, queue jobs, and worker consumer", () => {
  assert.match(types, /VECTORIZE\?: Vectorize/);
  assert.match(types, /PLATFORM_QUEUE\?: Queue<PlatformQueueMessage>/);
  assert.match(types, /BROWSER\?: BrowserRun/);
  assert.match(apiRoute, /app\.route\("\/platform", platform\)/);
  assert.match(platformRoute, /platform\.get\("\/status"/);
  assert.match(platformRoute, /platform\.get\("\/search"/);
  assert.match(platformRoute, /platform\.post\("\/index\/book\/:id"/);
  assert.match(platformRoute, /platform\.post\("\/render\/share-card"/);
  assert.match(platformLib, /indexBookSemantics/);
  assert.match(platformLib, /env\.VECTORIZE\.upsert/);
  assert.match(platformLib, /env\.BROWSER\.quickAction\("screenshot"/);
  assert.match(platformWorker, /async queue\(batch: MessageBatch<PlatformQueueMessage>/);
  assert.match(platformWorker, /runPlatformJob\(env, message\.body\)/);
});

test("frontend surfaces semantic search and platform capability state", () => {
  assert.match(apiClient, /semanticSearch: \(q, limit = 8\)/);
  assert.match(searchSource, /platform\.semanticSearch\(t, 6\)/);
  assert.match(searchSource, /语义回声/);
  assert.match(agentView, /Cloudflare 平台能力/);
  assert.match(agentView, /Vectorize/);
  assert.match(agentView, /Browser/);
});

test("docs describe deploying the platform worker and queue fallback", () => {
  assert.match(backendDoc, /npm run platform:deploy/);
  assert.match(backendDoc, /liber-platform-worker/);
  assert.match(backendDoc, /POST \/api\/platform\/jobs\/drain/);
});
