import { z } from 'zod';
import { leadDedupeKey } from '@pf/core';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  query: z.string().min(1).describe('Pretend search term'),
  limit: z.number().int().min(1).max(200).default(10),
});

/** Deterministic fake people, so tests can assert exact output. */
function fakeProfile(query: string, index: number) {
  return {
    platform: 'mock' as const,
    platformId: `${query.toLowerCase().replace(/\s+/g, '-')}-${index}`,
    profileUrl: `https://mock.local/in/${query.toLowerCase().replace(/\s+/g, '-')}-${index}`,
    fullName: `Test Person ${index}`,
    headline: `${query} specialist`,
    location: 'Mock City',
    company: `Mockworks ${index % 5}`,
    jobTitle: query,
    connectionDegree: '2nd' as const,
    raw: {},
  };
}

export const collectProfilesAgent = defineAgent({
  key: 'mock.collect-profiles',
  platform: 'mock',
  name: 'Collect Profiles (Mock)',
  description: 'Generates deterministic fake leads. Used to develop the platform safely.',
  version: 1,
  inputSchema,
  quotaCost: { profile_view: 1 },
  readOnly: true,

  async execute(ctx, input) {
    const resumed = await ctx.loadCheckpoint();
    let processed = resumed?.processed ?? 0;
    const results: Array<{ dedupeKey: string }> = [];

    ctx.log('info', `Collecting ${input.limit} mock profiles for "${input.query}"`, {
      resumedFrom: processed,
    });

    while (processed < input.limit) {
      if (ctx.signal.aborted) break;

      const profile = fakeProfile(input.query, processed);
      await ctx.emitLead(profile);
      results.push({ dedupeKey: leadDedupeKey(profile) });

      processed += 1;
      await ctx.saveCheckpoint({ cursor: String(processed), processed, total: input.limit });
    }

    ctx.log('info', `Collected ${processed} profiles`);
    return { processed, skipped: 0, failed: 0, results };
  },
});
