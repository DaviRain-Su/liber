import type { Env, PlatformQueueMessage } from "../functions/lib/types";
import { platformStatus, runPlatformJob } from "../functions/lib/platform";

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    return Response.json(await platformStatus(env));
  },

  async queue(batch: MessageBatch<PlatformQueueMessage>, env: Env, _ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        await runPlatformJob(env, message.body);
        message.ack();
      } catch (err) {
        console.error("platform queue job failed", {
          id: message.body?.id,
          type: message.body?.type,
          error: String(err instanceof Error ? err.message : err),
        });
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PlatformQueueMessage>;
