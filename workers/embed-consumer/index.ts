// Knowledge-graph embed queue consumer (KNOWLEDGE_GRAPH_SPEC §6.0 / §6.2).
//
// Pages Functions are producer-friendly but can't host a queue consumer, so the
// consumer lives here as a standalone Worker that shares the same D1 / Vectorize
// / Workers AI bindings and reuses functions/lib/graph/embed.ts. The Pages app
// enqueues; this Worker embeds → upserts Vectorize → writes echo_edges.
import type { Env } from "../../functions/lib/types";
import { processEmbedBatch, type EmbedMsg } from "../../functions/lib/graph/embed";
import { runMaintenance } from "../../functions/lib/graph/maintenance";

export default {
  // No HTTP surface; a plain 200 so health checks don't 500.
  async fetch(): Promise<Response> {
    return new Response("liber embed-consumer: queue only", { status: 200 });
  },

  async queue(batch: MessageBatch<EmbedMsg>, env: Env): Promise<void> {
    const msgs = batch.messages.map((m) => m.body);
    try {
      await processEmbedBatch(env, msgs);
      for (const m of batch.messages) m.ack();
    } catch (err) {
      // let the platform retry the whole batch (max_retries → DLQ)
      console.error("embed-consumer batch failed:", err);
      for (const m of batch.messages) m.retry();
    }
  },

  // Nightly maintenance (KNOWLEDGE_GRAPH_SPEC §6.6): theme labelling + cold-link
  // decay. Scheduled via [triggers] crons in wrangler.toml.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runMaintenance(env).then((r) => console.log("graph maintenance:", JSON.stringify(r))),
    );
  },
};
