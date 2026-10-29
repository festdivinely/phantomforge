import { z } from 'zod';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  /** How many invitations the fake inbox pretends to hold. */
  pending: z.number().int().min(0).max(500).default(10),
  /** Most invitations to accept in one run; the rest wait for the next run. */
  max: z.number().int().min(1).max(200).default(50),
  /** Fraction of accepts the mock platform pretends fail, for testing. */
  failureRate: z.number().min(0).max(1).default(0),
});

/** Deterministic fake inviters, so tests can assert exact output. */
function fakeInviter(index: number) {
  return {
    platform: 'mock' as const,
    platformId: `inviter-${index}`,
    profileUrl: `https://mock.local/in/inviter-${index}`,
    fullName: `Inviter ${index}`,
    headline: 'Wants to connect',
    location: 'Lagos, Nigeria',
    connectionDegree: '1st' as const,
    raw: {},
  };
}

/**
 * The mock twin of linkedin.accept-invitations: same loop shape (quota before
 * each accept, pace between, checkpoint after, stop at `max`), against a fake
 * inbox. New connections are emitted as leads so the growth dashboard can
 * count them later.
 */
export const acceptInvitationsAgent = defineAgent({
  key: 'mock.accept-invitations',
  platform: 'mock',
  name: 'Accept Invitations (Mock)',
  description: 'Accepts pending connection invitations in a fake inbox, up to a per-run maximum.',
  version: 1,
  inputSchema,
  quotaCost: { connection_accept: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const resumed = await ctx.loadCheckpoint();
    const total = Math.min(input.pending, input.max);
    let index = resumed?.processed ?? 0;
    let processed = 0;
    let failed = 0;
    const results: Array<{ inviter: string; ok: boolean }> = [];

    if (total === 0) {
      ctx.log('info', 'No pending invitations');
      return { processed: 0, skipped: 0, failed: 0, results };
    }

    for (; index < total; index += 1) {
      if (ctx.signal.aborted) {
        ctx.log('warn', 'Run aborted; stopping cleanly');
        break;
      }

      await ctx.consumeQuota('connection_accept');
      await ctx.pace();

      const inviter = fakeInviter(index + 1);
      const ok = Math.random() >= input.failureRate;
      if (ok) {
        processed += 1;
        ctx.log('info', `Accepted invitation from ${inviter.fullName}`);
        await ctx.emitLead(inviter);
      } else {
        failed += 1;
        ctx.log('warn', `Mock platform failed to accept ${inviter.fullName}`);
      }
      results.push({ inviter: inviter.fullName, ok });
      await ctx.recordActivity({
        kind: 'connection_accept',
        ok,
        targetName: inviter.fullName,
        targetUrl: inviter.profileUrl,
      });

      await ctx.saveCheckpoint({ cursor: inviter.platformId, processed: index + 1, total });
    }

    const left = input.pending - total;
    if (left > 0) ctx.log('info', `${left} invitation(s) left for the next run (max ${input.max} per run)`);
    return { processed, skipped: left, failed, results };
  },
});
