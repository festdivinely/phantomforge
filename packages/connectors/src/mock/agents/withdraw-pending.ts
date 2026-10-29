import { z } from 'zod';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  /** How many sent invitations the fake account pretends to have pending. */
  pending: z.number().int().min(0).max(500).default(10),
  /** Withdraw invitations older than this many days. */
  olderThanDays: z.number().int().min(1).max(365).default(21),
  max: z.number().int().min(1).max(200).default(50),
});

/**
 * The mock twin of the future linkedin.withdraw-pending: pretends every other
 * pending invitation is old enough and withdraws those, up to `max`.
 */
export const withdrawPendingAgent = defineAgent({
  key: 'mock.withdraw-pending',
  platform: 'mock',
  name: 'Withdraw Old Invitations (Mock)',
  description: 'Withdraws sent invitations older than N days on the fake platform.',
  version: 1,
  inputSchema,
  quotaCost: { connection_withdraw: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const old = Array.from({ length: input.pending }, (_, i) => i + 1)
      .filter((i) => i % 2 === 0)
      .slice(0, input.max);
    const results: Array<{ person: string; ok: boolean }> = [];

    for (const [index, i] of old.entries()) {
      if (ctx.signal.aborted) break;
      await ctx.consumeQuota('connection_withdraw');
      await ctx.pace();

      const person = `Pending Person ${i}`;
      results.push({ person, ok: true });
      await ctx.recordActivity({
        kind: 'connection_withdraw',
        ok: true,
        targetName: person,
        detail: { ageDays: input.olderThanDays + i },
      });
      ctx.log('info', `Withdrew invitation to ${person}`);
      await ctx.saveCheckpoint({ cursor: person, processed: index + 1, total: old.length });
    }

    return { processed: results.length, skipped: input.pending - old.length, failed: 0, results };
  },
});
