# Liber embed-consumer (knowledge-graph queue consumer)

Standalone Worker that powers the **living cross-book echoes** described in
[`docs/KNOWLEDGE_GRAPH_SPEC.md`](../../docs/KNOWLEDGE_GRAPH_SPEC.md). The Pages
app (producer) enqueues sentence ids; this Worker (consumer) embeds them with
Workers AI, upserts vectors to Vectorize, finds cross-book nearest neighbours,
and writes `echo_edges` to D1. It also runs nightly maintenance via Cron.

It lives separately because **Cloudflare Pages Functions cannot host a queue
consumer** — but it shares the *same* D1 / Vectorize / Workers AI as the Pages
project, and reuses `functions/lib/graph/*` directly.

> Default state is **inert**: with `GRAPH_ENABLED` unset in the Pages project,
> the app never enqueues and `get_echoes` returns the hand-written seed echoes
> exactly as today. Nothing below changes behaviour until you finish all steps.

## Prerequisites

- Wrangler authenticated against the same account as the Pages project.
- The `database_id` in `wrangler.toml` here matches the root `wrangler.toml`.

## Deploy (run once, in order)

```bash
# 1. Create the vector index (1024 dims = bge-m3, cosine distance)
npx wrangler vectorize create liber-echoes --dimensions=1024 --metric=cosine

# 2. Create the queue + its dead-letter queue
npx wrangler queues create liber-embed
npx wrangler queues create liber-embed-dlq

# 3. Apply the graph migration to the shared D1 (from repo root)
npx wrangler d1 execute liber --remote --file=migrations/0009_knowledge_graph.sql
#   (or: npm run db:migrate  — 0009 is already included)

# 4. Deploy this consumer Worker (binds the queue consumer + Cron)
npx wrangler deploy -c workers/embed-consumer/wrangler.toml

# 5. Turn on the PRODUCER side in the Pages project:
#    - uncomment [[vectorize]] + [[queues.producers]] in the root wrangler.toml
#    - set GRAPH_ENABLED=true (and optionally GRAPH_MIN_SCORE from the spike)
#    then redeploy Pages:  npm run deploy
```

## Backfill existing books

After both sides are live, enqueue the whole catalogue (idempotent — the
consumer skips sentences already embedded with the current model):

```bash
curl -XPOST https://<your-app>/api/graph/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → { ok: true, books: N, sentences: M }
```

Watch progress / state:

```bash
curl https://<your-app>/api/graph/stats
# → { enabled, model, minScore, embeddings, edges, autoEdges, curatedEdges, ... }
```

## Tuning

All read from env (set on **this** Worker for consumer-side, and on the Pages
project for the producer/reader side — keep them in sync):

| Var | Default | Meaning |
| --- | --- | --- |
| `GRAPH_ENABLED` | (unset) | `"true"` to activate. Must be set on BOTH the Pages project and this Worker. |
| `GRAPH_EMBED_MODEL` | `@cf/baai/bge-m3` | Workers AI embedding model. Changing it re-embeds (model is in the ledger). |
| `GRAPH_MIN_SCORE` | `0.78` | Cosine threshold for writing an edge. **Set this from `npm run graph:spike`.** |
| `GRAPH_TOPK` | `8` | Neighbours queried per sentence. |

## Roll back

Set `GRAPH_ENABLED` to anything but `true` on the Pages project (or unset it)
and redeploy Pages. The app stops enqueuing and `get_echoes` reverts to the seed
dictionary. The consumer Worker can be left deployed (it'll just idle) or deleted
with `npx wrangler delete -c workers/embed-consumer/wrangler.toml`. No data loss;
`echo_edges` / `embeddings` simply stop being read.

## Verify it works (acceptance, SPEC §7)

```bash
# A sentence that has NO hand-written seed echo should still get auto ones:
curl -XPOST https://<your-app>/api/mcp/call \
  -H 'content-type: application/json' \
  -d '{"tool":"get_echoes","args":{"sid":"<some ingested sid>"}}'
# → { tool, result: { theme, items: [ { bookT, quote, why }, ... ] } }
```
