import { z } from 'zod';
import { PhantomForgeError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  profileUrls: z.array(z.string().url()).min(1).max(100),
  note: z.string().max(300).optional().describe('Optional connection note (LinkedIn caps at 300)'),
  skipIfPending: z.boolean().default(true),
});

/**
 * PHASE 4 - not implemented yet, and deliberately so.
 *
 * The mock equivalent (mock.send-connection) already exercises quota, pacing,
 * checkpointing and partial failure. Build and prove the pipeline there first;
 * this file is where that proven logic gets a real browser behind it.
 *
 * Implementation notes for when we get here:
 *  - resolveSelector(page, connectButton) - never a raw locator
 *  - ctx.consumeQuota('connection_request') BEFORE clicking, never after
 *  - ctx.pace() between every profile
 *  - ctx.saveCheckpoint() after every profile
 *  - capture a screenshot artifact on any unexpected DOM state
 *  - treat a checkpoint/challenge page as fatal: stop the whole run
 */
export const sendConnectionAgent = defineAgent({
  key: 'linkedin.send-connection',
  platform: 'linkedin',
  name: 'Send Connection Requests',
  description: 'Sends connection requests to a list of LinkedIn profiles, with optional note.',
  version: 1,
  inputSchema,
  quotaCost: { connection_request: 1, profile_view: 1 },
  readOnly: false,

  async execute(ctx, _input) {
    ctx.log('error', 'linkedin.send-connection is not implemented yet (Phase 4)');
    throw new PhantomForgeError('UNKNOWN', 'Agent not implemented yet - see docs/ROADMAP.md', {
      retryable: false,
      context: { agent: 'linkedin.send-connection', phase: 4 },
    });
  },
});
