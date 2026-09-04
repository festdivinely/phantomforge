import { z } from 'zod';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  profileIds: z.array(z.string().min(1)).min(1).max(100),
  note: z.string().max(300).optional(),
  /** Fraction of targets the mock platform pretends to reject, for testing. */
  failureRate: z.number().min(0).max(1).default(0),
});

/**
 * Exercises the full write path - quota, pacing, checkpointing, partial failure -
 * without touching a real platform. Every real action agent should behave like this.
 */
export const sendConnectionAgent = defineAgent({
  key: 'mock.send-connection',
  platform: 'mock',
  name: 'Send Connection Requests (Mock)',
  description: 'Simulates sending connection requests, including failures and quota exhaustion.',
  version: 1,
  inputSchema,
  quotaCost: { connection_request: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const resumed = await ctx.loadCheckpoint();
    let index = resumed?.processed ?? 0;
    let processed = 0;
    let failed = 0;
    const results: Array<{ profileId: string; ok: boolean }> = [];

    for (; index < input.profileIds.length; index += 1) {
      if (ctx.signal.aborted) {
        ctx.log('warn', 'Run aborted; stopping cleanly');
        break;
      }

      const profileId = input.profileIds[index];
      if (!profileId) continue;

      await ctx.consumeQuota('connection_request');
      await ctx.pace();

      const ok = Math.random() >= input.failureRate;
      if (ok) {
        processed += 1;
        ctx.log('info', `Connection request sent to ${profileId}`);
      } else {
        failed += 1;
        ctx.log('warn', `Mock platform rejected request to ${profileId}`);
      }
      results.push({ profileId, ok });

      await ctx.saveCheckpoint({
        cursor: profileId,
        processed: index + 1,
        total: input.profileIds.length,
      });
    }

    return { processed, skipped: 0, failed, results };
  },
});
