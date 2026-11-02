import { z } from 'zod';
import type { Locator, Page } from 'playwright';
import { QuotaExceededError, SelectorNotFoundError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { resolveSelector } from '../../base/selector.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';
import {
  connectButton,
  dialogDismissButton,
  inviteEmailField,
  sendInviteButton,
  sendWithoutNoteButton,
} from '../selectors/connection.js';
import { DEFAULT_SEARCHES, judge, normaliseProfileUrl, type Candidate } from '../targeting.js';

const inputSchema = z.object({
  max: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(5)
    .describe('Most requests in one run; the daily and weekly limits apply on top'),
  search: z
    .string()
    .max(100)
    .optional()
    .describe('Words to search for; empty = one of the open-to-connect searches, picked at random'),
  maxPages: z.number().int().min(1).max(5).default(3).describe('Search result pages to look through'),
  requireOpenSignal: z
    .boolean()
    .default(true)
    .describe('Only people whose headline says they want connections (e.g. #OpenToConnect)'),
  profileVisitChance: z
    .number()
    .min(0)
    .max(1)
    .default(0.3)
    .describe('How often to open a profile and read it before inviting, like a person would'),
  dryRun: z.boolean().default(false).describe('Click nothing; only list who would be invited and who was skipped'),
  only: z
    .array(z.string().url())
    .min(1)
    .max(25)
    .optional()
    .describe(
      'Owner-approved people (profile addresses from a practice run). Only these are invited, found again through the same search; the rules still apply.',
    ),
});

const CONNECT_NAME = /^invite (.+) to connect$/i;
const FOLLOW_NAME = /^follow (.+)$/i;
/** Lines on a search card that are buttons or counts, not name / headline / location. */
const NOISE_LINE =
  /^(connect|follow|following|message|pending|•?\s*(1st|2nd|3rd\+?))$|followers?$|mutual connection|^status is|^view .* profile$/i;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pause = (page: Page, min: number, max: number) => page.waitForTimeout(rand(min, max));

/** Scroll down the page in uneven steps with short reading pauses, like someone skimming. */
async function skim(page: Page, steps: number) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, rand(250, 650));
    await pause(page, 700, 2_200);
  }
}

/** The search result card for one person, found fresh each time (pages reload). */
function cardFor(page: Page, profileUrl: string): Locator {
  const slug = /\/in\/([^/]+)\//.exec(profileUrl)?.[1] ?? profileUrl;
  return page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.locator(`a[href*="/in/${slug}"]`) })
    .first();
}

interface Found extends Candidate {
  canConnect: boolean;
}

/** Reads the people on a search results page: name, headline, location, and whether Connect is offered. */
async function readResults(page: Page): Promise<Found[]> {
  const items = page.getByRole('main').getByRole('listitem').filter({ has: page.locator('a[href*="/in/"]') });
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const item of await items.all()) {
    const href = await item.locator('a[href*="/in/"]').first().getAttribute('href').catch(() => null);
    const profileUrl = href ? normaliseProfileUrl(href) : null;
    if (!profileUrl || seen.has(profileUrl)) continue;
    seen.add(profileUrl);

    const connect = item
      .getByRole('link', { name: CONNECT_NAME })
      .or(item.getByRole('button', { name: CONNECT_NAME }))
      .first();
    const canConnect = (await connect.count()) > 0;
    const follow = item.getByRole('button', { name: FOLLOW_NAME }).first();
    const label =
      (canConnect
        ? await connect.getAttribute('aria-label').catch(() => null)
        : await follow.getAttribute('aria-label', { timeout: 500 }).catch(() => null)) ?? '';

    const lines = (await item.innerText().catch(() => ''))
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l && !NOISE_LINE.test(l));
    const name =
      CONNECT_NAME.exec(label)?.[1] ?? FOLLOW_NAME.exec(label)?.[1] ?? (lines[0] ?? '').replace(/\s*•.*$/, '');
    const after = lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith(name))) + 1);
    found.push({ name, headline: after[0] ?? '', location: after[1] ?? '', profileUrl, canConnect });
  }
  return found;
}

/**
 * Notes who accepted this account's requests, so the acceptance-rate guard in
 * the quota package can judge the account before anything is sent. Seen
 * (2026-11-01): the connections list is sorted "Recently added", so new
 * acceptances are at the top; only people this account invited are recorded.
 */
async function noteAcceptances(ctx: AgentContext): Promise<number> {
  const { page } = ctx;
  await page.goto(`${LINKEDIN_ORIGIN}/mynetwork/invite-connect/connections/`, { waitUntil: 'domcontentloaded' });
  await assertSafeToContinue(page);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await skim(page, 2);
  const hrefs = await page
    .locator('main a[href*="/in/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  let noted = 0;
  for (const url of new Set(hrefs.map((h) => normaliseProfileUrl(h)).filter((u): u is string => !!u))) {
    if (!(await ctx.alreadyActedOn(url, ['connection_request']))) continue;
    if (await ctx.alreadyActedOn(url, ['invite_accepted'])) continue;
    await ctx.recordActivity({ kind: 'invite_accepted', ok: true, targetUrl: url });
    noted += 1;
  }
  ctx.log(
    'info',
    noted ? `${noted} more ${noted === 1 ? 'person' : 'people'} accepted earlier requests` : 'No new acceptances since last time',
  );
  return noted;
}

async function dismiss(page: Page, dialog: Locator) {
  const close = await resolveSelector(dialog, dialogDismissButton, { timeoutMs: 1_500 }).catch(() => null);
  if (close) await close.click().catch(() => undefined);
  else await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

/** Opens the profile, reads it for a few seconds, and comes back to the results. */
async function readProfileFirst(ctx: AgentContext, c: Candidate): Promise<boolean> {
  const { page } = ctx;
  await ctx.consumeQuota('profile_view');
  await page.goto(c.profileUrl, { waitUntil: 'domcontentloaded' });
  await assertSafeToContinue(page);
  await pause(page, 1_500, 3_500);
  await skim(page, 1 + Math.floor(Math.random() * 3));
  await pause(page, 1_000, 3_000);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await assertSafeToContinue(page);
  return cardFor(page, c.profileUrl)
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

type InviteOutcome = { sent: true } | { sent: false; skipReason: string };

/**
 * Clicks Connect on one search card and sends the invitation without a note.
 * Anything LinkedIn shows that is not the expected dialog stops the run:
 * screenshots are saved and nothing is guessed.
 */
async function invite(ctx: AgentContext, c: Candidate, captureDialog: boolean): Promise<InviteOutcome> {
  const { page } = ctx;
  const card = cardFor(page, c.profileUrl);
  await card.scrollIntoViewIfNeeded().catch(() => undefined);
  await pause(page, 900, 2_600); // reading the card

  const connect = await resolveSelector(card, connectButton, { timeoutMs: 4_000 }).catch(() => null);
  if (!connect) return { sent: false, skipReason: 'Connect is no longer offered' };

  await ctx.consumeQuota('connection_request');
  await connect.hover();
  await pause(page, 250, 700);
  await connect.click();

  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog')).last();
  const opened = await dialog
    .waitFor({ state: 'visible', timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
  await assertSafeToContinue(page);

  if (opened) {
    if (captureDialog) {
      await ctx.captureArtifact('screenshot', 'connect dialog');
      await ctx.captureArtifact('aria_snapshot', 'connect dialog');
    }
    if (await resolveSelector(dialog, inviteEmailField, { timeoutMs: 800 }).then(() => true).catch(() => false)) {
      await dismiss(page, dialog);
      return { sent: false, skipReason: "LinkedIn asks for this person's email address" };
    }
    const send =
      (await resolveSelector(dialog, sendWithoutNoteButton, { timeoutMs: 1_500 }).catch(() => null)) ??
      (await resolveSelector(dialog, sendInviteButton, { timeoutMs: 1_500 }).catch(() => null));
    if (!send) {
      await ctx.captureArtifact('screenshot', `unknown dialog after Connect: ${c.name}`);
      await ctx.captureArtifact('aria_snapshot', `unknown dialog after Connect: ${c.name}`);
      await dismiss(page, dialog);
      throw new SelectorNotFoundError(sendWithoutNoteButton.name, sendWithoutNoteButton.strategies.length);
    }
    if (!(await send.isEnabled())) {
      // Send stays disabled when LinkedIn insists on a note; leave this person for now.
      await dismiss(page, dialog);
      return { sent: false, skipReason: 'LinkedIn wants a note for this person' };
    }
    await pause(page, 300, 900);
    await send.click();
    await dialog.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);
    // The warning check after sending happens once the request is recorded,
    // so a request that went out is never missing from the history.
  } else if (!page.url().includes('/search/results/')) {
    // Connect led somewhere unexpected instead of a dialog.
    await ctx.captureArtifact('screenshot', `unexpected page after Connect: ${c.name}`);
    await ctx.captureArtifact('aria_snapshot', `unexpected page after Connect: ${c.name}`);
    throw new SelectorNotFoundError(connectButton.name, connectButton.strategies.length);
  }

  // Sent = this person's Connect is gone (LinkedIn shows Pending instead).
  return card
    .getByRole('link', { name: CONNECT_NAME })
    .or(card.getByRole('button', { name: CONNECT_NAME }))
    .first()
    .waitFor({ state: 'detached', timeout: 8_000 })
    .then((): InviteOutcome => ({ sent: true }))
    .catch((): InviteOutcome => ({ sent: false, skipReason: 'did-not-land' }));
}

/**
 * Sends connection requests to people who are looking for connections too,
 * found through LinkedIn people search (built against the real pages - see
 * docs/research/2026-11-01-linkedin-page-study.md).
 *
 * Per run: pick a search, skim the results like a person, skip anyone the
 * targeting rules leave out or who was invited/withdrawn before, sometimes
 * read a profile first, then Connect -> send without a note. Quota is taken
 * right before each Connect click; pacing between people; any LinkedIn
 * warning, unknown dialog or click that doesn't land stops the run.
 */
export const sendConnectionAgent = defineAgent({
  key: 'linkedin.send-connection',
  platform: 'linkedin',
  name: 'Send Connection Requests',
  description:
    'Finds people who are open to connecting (people search), skips executives, tech professionals and anyone contacted before, and sends requests without a note.',
  version: 2,
  inputSchema,
  quotaCost: { connection_request: 1, profile_view: 1 },
  readOnly: false,

  async execute(ctx, input) {
    const { page } = ctx;
    const search = input.search?.trim() || DEFAULT_SEARCHES[Math.floor(Math.random() * DEFAULT_SEARCHES.length)]!;
    // An approved list is only sent with the search it came from.
    const approved = input.only ? new Set(input.only.map((u) => normaliseProfileUrl(u) ?? u)) : null;
    const max = approved ? Math.min(input.max, approved.size) : input.max;
    ctx.log(
      'info',
      `${input.dryRun ? 'Practice run (no clicks)' : approved ? `Sending to ${approved.size} approved people` : 'Sending'} - search: "${search}"`,
    );

    let sent = 0;
    let failed = 0;
    let dialogCaptured = false;
    /** Why the run stopped early, for approved people it never got to. */
    let stoppedBecause: string | null = null;
    const skipped: Array<{ name: string; reason: string }> = [];
    const results: Array<{ name: string; headline: string; location?: string; profileUrl: string; status: string; search?: string }> = [];
    // Everyone looked at, so the owner can check the choices: invited first, then skipped with the reason.
    const outcome = () => ({
      processed: sent,
      skipped: skipped.length,
      failed,
      results: [
        ...results,
        ...skipped.map((s) => ({ name: s.name, headline: '', profileUrl: '', status: `skipped: ${s.reason}` })),
        // Approved people this run never reached (search results change).
        ...[...(approved ?? [])].map((profileUrl) => ({ name: '', headline: '', profileUrl, status: stoppedBecause ? `not sent: ${stoppedBecause}` : 'not found in the search this time' })),
      ],
    });

    try {
      // Before sending, record who accepted earlier requests: the guard judges the account on it.
      await noteAcceptances(ctx);
      await ctx.pace();

      for (let pageNo = 1; pageNo <= input.maxPages && sent < max && approved?.size !== 0; pageNo += 1) {
        if (ctx.signal.aborted) break;
        const url = `${LINKEDIN_ORIGIN}/search/results/people/?keywords=${encodeURIComponent(search)}&origin=GLOBAL_SEARCH_HEADER${pageNo > 1 ? `&page=${pageNo}` : ''}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await assertSafeToContinue(page);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await skim(page, 2 + Math.floor(Math.random() * 3));
        await page.mouse.wheel(0, -3000);

        if (pageNo === 1) {
          // Study the page before acting on it.
          await ctx.captureArtifact('screenshot', `search results: ${search}`);
          await ctx.captureArtifact('aria_snapshot', `search results: ${search}`);
        }

        const people = await readResults(page);
        ctx.log('info', `Page ${pageNo}: ${people.length} people`);
        if (people.length === 0) break;

        for (const person of people) {
          if (sent >= max || ctx.signal.aborted || approved?.size === 0) break;
          // With an approved list, everyone else on the page is passed over.
          if (approved && !approved.has(person.profileUrl)) continue;
          approved?.delete(person.profileUrl);

          let reason: string | null = null;
          if (!person.canConnect) reason = 'Connect not offered (Follow only, or already pending)';
          else {
            const verdict = judge(person, { requireOpenSignal: input.requireOpenSignal });
            if (!verdict.ok) reason = verdict.reason;
            else if (await ctx.alreadyActedOn(person.profileUrl, ['connection_request', 'connection_withdraw'])) {
              reason = 'invited or withdrawn before';
            }
          }
          if (reason) {
            skipped.push({ name: person.name, reason });
            continue;
          }

          if (input.dryRun) {
            results.push({ ...person, status: 'would invite', search });
            ctx.log('info', `Would invite ${person.name} - ${person.headline}`);
            sent += 1;
            continue;
          }

          if (Math.random() < input.profileVisitChance && !(await readProfileFirst(ctx, person))) {
            skipped.push({ name: person.name, reason: 'card gone after reading the profile' });
            continue;
          }

          const result = await invite(ctx, person, !dialogCaptured);
          dialogCaptured = true;

          if (result.sent) {
            sent += 1;
            results.push({ ...person, status: 'sent', search });
            await ctx.recordActivity({
              kind: 'connection_request',
              ok: true,
              targetName: person.name,
              targetUrl: person.profileUrl,
              detail: { headline: person.headline, location: person.location, search },
            });
            ctx.log('info', `Sent a request to ${person.name} - ${person.headline}`);
            await ctx.saveCheckpoint({ cursor: person.profileUrl, processed: sent, total: input.max });
            await assertSafeToContinue(page);
          } else if (result.skipReason === 'did-not-land') {
            failed += 1;
            results.push({ ...person, status: 'failed' });
            await ctx.recordActivity({
              kind: 'connection_request',
              ok: false,
              targetName: person.name,
              targetUrl: person.profileUrl,
            });
            ctx.log('warn', `The request to ${person.name} did not go through; stopping this run`);
            await ctx.captureArtifact('screenshot', `request did not land: ${person.name}`);
            return outcome();
          } else {
            skipped.push({ name: person.name, reason: result.skipReason });
            ctx.log('info', `Skipped ${person.name}: ${result.skipReason}`);
          }

          if (sent < max) await ctx.pace();
        }
        if (sent < max && pageNo < input.maxPages && approved?.size !== 0) await ctx.pace();
      }
    } catch (error) {
      // Today's or this week's limit is reached: a normal end, not a failure.
      if (!(error instanceof QuotaExceededError)) throw error;
      ctx.log('info', `Limit reached: ${error.message}`);
      stoppedBecause = error.message;
    }

    ctx.log(
      'info',
      `${input.dryRun ? 'Would invite' : 'Sent'} ${sent}; skipped ${skipped.length}${failed ? `; failed ${failed}` : ''}`,
    );
    return outcome();
  },
});
