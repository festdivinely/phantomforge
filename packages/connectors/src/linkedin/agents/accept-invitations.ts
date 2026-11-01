import { z } from 'zod';
import type { Locator } from 'playwright';
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

/**
 * The received list mixes people with newsletters, company pages, events and
 * groups ("LinkedIn invited you to subscribe to In the Loop" - seen on the
 * real account). Only a person's invitation is a connection; accepting the
 * others would subscribe or follow instead. Those are left untouched.
 */
const NOT_A_PERSON_LINKS =
  'a[href*="/newsletters/"], a[href*="/company/"], a[href*="/events/"], a[href*="/groups/"], a[href*="/school/"], a[href*="/showcase/"]';
const NOT_A_PERSON_TEXT = /invited you to (subscribe|follow|join|attend)/i;

/** The invitation card around an Accept button. */
const cardOf = (button: Locator) => button.locator('xpath=ancestor::*[self::li or @role="listitem"][1]');

async function isPersonInvitation(card: Locator): Promise<boolean> {
  if (NOT_A_PERSON_TEXT.test(await card.innerText().catch(() => ''))) return false;
  if ((await card.locator(NOT_A_PERSON_LINKS).count()) > 0) return false;
  return (await card.locator('a[href*="/in/"]').count()) > 0;
}

/** "Accept invitation from Jane Doe" / "Accept Jane Doe's invitation" -> "Jane Doe". */
function inviterName(label: string): string {
  return (
    /^accept invitation (?:from|for)\s+(.+)$/i.exec(label)?.[1] ??
    /^accept\s+(.+?)['’]s invitation/i.exec(label)?.[1] ??
    label
  );
}

interface NextInvite {
  button: Locator;
  label: string;
}

/**
 * The first person's invitation on the page, 'none-at-all' when the page
 * has no Accept button of any kind. Anything that isn't a person's
 * invitation is logged once, remembered in `passedOver` and left alone.
 */
async function findNextPerson(ctx: AgentContext, passedOver: Set<string>): Promise<NextInvite | null | 'none-at-all'> {
  const first = await resolveSelector(ctx.page, acceptInviteButton, { timeoutMs: 8_000 }).catch(() => null);
  if (!first) return 'none-at-all';

  for (const button of await ctx.page.getByRole('button', { name: /^accept\b.*invitation/i }).all()) {
    const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
    if (passedOver.has(label)) continue;
    if (await isPersonInvitation(cardOf(button))) return { button, label };
    passedOver.add(label);
    ctx.log('info', `Left alone (not a person's connection invitation): ${label}`);
  }
  return null;
}

/**
 * Accepts received connection invitations from people - the lowest-risk
 * growth action: every accept is a new connection the other person already
 * asked for.
 *
 * Loop: find the first person's Accept button, take quota, click, wait for
 * that card to disappear, checkpoint, pace. Stops at `max`, when no person's
 * invitation is left, or on any sign the click did not land (same card still
 * there) - a stuck click repeated forty times is exactly the pattern that
 * gets accounts flagged.
 */
export const acceptInvitationsAgent = defineAgent({
  key: 'linkedin.accept-invitations',
  platform: 'linkedin',
  name: 'Accept Invitations',
  description:
    'Accepts pending LinkedIn connection invitations from people, up to a per-run maximum. Newsletter, page, event and group invitations are left alone.',
  version: 2,
  inputSchema,
  quotaCost: { connection_accept: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const { page } = ctx;
    const resumed = await ctx.loadCheckpoint();
    let accepted = resumed?.processed ?? 0;
    let failed = 0;
    const passedOver = new Set<string>();
    const results: Array<{ inviter: string; ok: boolean }> = [];

    await page.goto(INVITATIONS_URL, { waitUntil: 'domcontentloaded' });
    await assertSafeToContinue(page);

    const firstFound = await findNextPerson(ctx, passedOver);
    if (firstFound === 'none-at-all') {
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
    let next: NextInvite | null = firstFound;

    while (next && accepted < input.max) {
      if (ctx.signal.aborted) {
        ctx.log('warn', 'Run aborted; stopping cleanly');
        break;
      }

      const { button, label } = next;
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
      const found = await findNextPerson(ctx, passedOver);
      next = found === 'none-at-all' ? null : found;
    }

    if (results.length === 0) {
      ctx.log('info', 'No connection invitations from people right now');
    } else if (accepted >= input.max) {
      const more = await findNextPerson(ctx, passedOver);
      if (more && more !== 'none-at-all') ctx.log('info', `Reached ${input.max} for this run; the rest wait for the next run`);
    }
    return { processed: results.filter((r) => r.ok).length, skipped: passedOver.size, failed, results };
  },
});
