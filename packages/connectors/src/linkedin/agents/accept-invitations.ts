import { z } from 'zod';
import { SelectorNotFoundError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { resolveSelector } from '../../base/selector.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';
import { acceptInviteButton, noInvitationsMessage } from '../selectors/connection.js';

export const INVITATIONS_URL = `${LINKEDIN_ORIGIN}/mynetwork/invitation-manager/received/`;

const inputSchema = z.object({
  max: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Most invitations to accept in one run; the rest wait for the next run'),
});

/** "Accept Jane Doe's invitation" -> "Jane Doe"; falls back to the raw label. */
function inviterName(label: string): string {
  return /^accept\s+(.+?)['’]s invitation/i.exec(label)?.[1] ?? label;
}

async function findNextAccept(ctx: AgentContext) {
  return resolveSelector(ctx.page, acceptInviteButton, { timeoutMs: 8_000 }).catch(() => null);
}

/**
 * Accepts received connection invitations - the lowest-risk growth action:
 * every accept is a new connection the other person already asked for.
 *
 * Loop: find the first Accept button, take quota, click, wait for that card to
 * disappear, checkpoint, pace. Stops at `max`, when the inbox is empty, or on
 * any sign the click did not land (same card still there) - a stuck click
 * repeated forty times is exactly the pattern that gets accounts flagged.
 */
export const acceptInvitationsAgent = defineAgent({
  key: 'linkedin.accept-invitations',
  platform: 'linkedin',
  name: 'Accept Invitations',
  description: 'Accepts pending LinkedIn connection invitations, up to a per-run maximum.',
  version: 1,
  inputSchema,
  quotaCost: { connection_accept: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const { page } = ctx;
    const resumed = await ctx.loadCheckpoint();
    let accepted = resumed?.processed ?? 0;
    let failed = 0;
    const results: Array<{ inviter: string; ok: boolean }> = [];

    await page.goto(INVITATIONS_URL, { waitUntil: 'domcontentloaded' });
    await assertSafeToContinue(page);

    let button = await findNextAccept(ctx);
    if (!button) {
      const empty = await resolveSelector(page, noInvitationsMessage, { timeoutMs: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (empty) {
        ctx.log('info', 'No pending invitations');
        return { processed: 0, skipped: 0, failed: 0, results };
      }
      // Neither invitations nor the empty state: LinkedIn probably changed the page.
      await ctx.captureArtifact('screenshot', 'invitation manager: no Accept button and no empty state');
      throw new SelectorNotFoundError(acceptInviteButton.name, acceptInviteButton.strategies.length);
    }

    while (button && accepted < input.max) {
      if (ctx.signal.aborted) {
        ctx.log('warn', 'Run aborted; stopping cleanly');
        break;
      }

      const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
      const name = inviterName(label);

      await ctx.consumeQuota('connection_accept');
      await button.click();

      // The card should vanish once the accept lands.
      const landed = await page
        .getByRole('button', { name: label, exact: true })
        .waitFor({ state: 'detached', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      await assertSafeToContinue(page);

      await ctx.recordActivity({ kind: 'connection_accept', ok: landed, targetName: name });

      if (!landed) {
        failed += 1;
        results.push({ inviter: name, ok: false });
        ctx.log('warn', `Accept did not go through for ${name}; stopping this run`);
        await ctx.captureArtifact('screenshot', `accept did not land: ${name}`);
        break;
      }

      accepted += 1;
      results.push({ inviter: name, ok: true });
      ctx.log('info', `Accepted invitation from ${name}`);
      await ctx.saveCheckpoint({ cursor: name, processed: accepted, total: input.max });

      if (accepted >= input.max) break;
      await ctx.pace();
      button = await findNextAccept(ctx);
    }

    if (accepted >= input.max && (await findNextAccept(ctx))) {
      ctx.log('info', `Reached ${input.max} for this run; the rest wait for the next run`);
    }
    return { processed: results.filter((r) => r.ok).length, skipped: 0, failed, results };
  },
});
