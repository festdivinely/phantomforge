import { z } from 'zod';
import type { Locator, Page } from 'playwright';
import { PhantomForgeError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { resolveSelector, type ResilientSelector } from '../../base/selector.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';
import { aboutBox, editAboutLink, editIntroLink, headlineBox, saveButton } from '../selectors/profile.js';

const inputSchema = z
  .object({
    headline: z.string().trim().min(1).max(220).optional().describe('New headline, exactly as approved'),
    about: z.string().trim().min(1).max(2600).optional().describe('New About text; a blank line starts a new paragraph'),
  })
  .refine((i) => i.headline !== undefined || i.about !== undefined, {
    message: 'Give a headline, an About text, or both',
  });

/** Compare what a box shows with what was asked for, ignoring spacing. */
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** Types like a person: one key at a time, uneven speed, a pause between paragraphs. */
async function typeLikeAPerson(page: Page, text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());
  for (const [i, para] of paragraphs.entries()) {
    if (i > 0) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400 + Math.random() * 600);
    }
    for (const ch of para) {
      await page.keyboard.type(ch);
      await page.waitForTimeout(40 + Math.random() * 110);
    }
  }
}

async function goToOwnProfile(page: Page) {
  // /in/me/ redirects to the owner's real profile address.
  await page.goto(`${LINKEDIN_ORIGIN}/in/me/`, { waitUntil: 'domcontentloaded' });
  await assertSafeToContinue(page);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/**
 * Opens one of the profile forms, replaces the text in one box, and saves.
 * Nothing is saved unless the box shows exactly the approved text first; if
 * anything looks wrong the run stops with the form unsaved.
 */
async function editBox(
  ctx: AgentContext,
  form: { title: RegExp; link: ResilientSelector; box: ResilientSelector; label: string },
  text: string,
): Promise<'changed' | 'already set'> {
  const { page } = ctx;
  await goToOwnProfile(page);

  const link = await resolveSelector(page, form.link, { timeoutMs: 10_000 });
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.waitForTimeout(500 + Math.random() * 800);
  await link.click();

  const dialog = page.getByRole('dialog', { name: form.title }).first();
  await dialog.waitFor({ timeout: 15_000 }).catch(async () => {
    await ctx.captureArtifact('screenshot', `${form.label}: form did not open`);
    throw new PhantomForgeError('SELECTOR_NOT_FOUND', `The ${form.label} form did not open`);
  });
  await assertSafeToContinue(page);
  await page.waitForTimeout(800 + Math.random() * 700);

  const box: Locator = await resolveSelector(dialog, form.box, { timeoutMs: 10_000 });
  const before = (await box.innerText()).trim();
  ctx.log('info', `${form.label} before: "${before}"`);
  if (same(before, text)) {
    ctx.log('info', `${form.label} already says this - nothing to change`);
    return 'already set';
  }

  await box.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500 + Math.random() * 500);
  await typeLikeAPerson(page, text);
  await page.waitForTimeout(800);

  const typed = (await box.innerText()).trim();
  if (!same(typed, text)) {
    await ctx.captureArtifact('screenshot', `${form.label}: typed text does not match`);
    throw new PhantomForgeError('UNKNOWN', `The ${form.label} box does not show the approved text, so nothing was saved`, {
      context: { typed },
    });
  }
  await ctx.captureArtifact('screenshot', `${form.label}: filled, before saving`);

  const save = await resolveSelector(dialog, saveButton);
  await save.hover();
  await page.waitForTimeout(400 + Math.random() * 600);
  await save.click();

  // A saved form closes; one that stays open is showing an error.
  const closed = await dialog
    .waitFor({ state: 'detached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await assertSafeToContinue(page);
  if (!closed) {
    await ctx.captureArtifact('screenshot', `${form.label}: form stayed open after Save`);
    await ctx.captureArtifact('aria_snapshot', `${form.label}: form stayed open after Save`);
    throw new PhantomForgeError('UNKNOWN', `LinkedIn did not accept the ${form.label} - see the screenshot`);
  }
  ctx.log('info', `${form.label} saved`);
  return 'changed';
}

/** Reload the profile and check the new text is really on it. */
async function confirmOnProfile(ctx: AgentContext, label: string, text: string) {
  const { page } = ctx;
  await goToOwnProfile(page);
  // The first paragraph is enough to find the About section.
  const firstLine = text.split(/\n/)[0]!.trim();
  const shown = await page
    .locator('main')
    .getByText(firstLine.slice(0, 80), { exact: false })
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await ctx.captureArtifact('screenshot', `profile after ${label}`);
  if (!shown) {
    throw new PhantomForgeError('UNKNOWN', `Saved, but the new ${label} is not showing on the profile yet - check it`);
  }
  ctx.log('info', `Checked: the new ${label} shows on the profile`);
}

/**
 * Changes the owner's own headline and/or About. Only what is passed in is
 * touched, and only text the owner approved should ever be passed in - this
 * agent never writes anything of its own.
 */
export const updateProfileAgent = defineAgent({
  key: 'linkedin.update-profile',
  platform: 'linkedin',
  name: 'Update Profile',
  description: 'Sets the headline and/or About section to text the owner approved. Changes nothing else.',
  version: 1,
  inputSchema,
  quotaCost: {},
  readOnly: false,

  async execute(ctx, input) {
    const results: { part: string; status: string }[] = [];
    await goToOwnProfile(ctx.page);
    await ctx.captureArtifact('screenshot', 'profile before');

    if (input.headline !== undefined && !ctx.signal.aborted) {
      const status = await editBox(
        ctx,
        { title: /^edit intro$/i, link: editIntroLink, box: headlineBox, label: 'headline' },
        input.headline,
      );
      if (status === 'changed') await confirmOnProfile(ctx, 'headline', input.headline);
      results.push({ part: 'headline', status });
      await ctx.pace();
    }

    if (input.about !== undefined && !ctx.signal.aborted) {
      const status = await editBox(
        ctx,
        { title: /^edit about$/i, link: editAboutLink, box: aboutBox, label: 'About' },
        input.about,
      );
      if (status === 'changed') await confirmOnProfile(ctx, 'About', input.about);
      results.push({ part: 'About', status });
    }

    const changed = results.filter((r) => r.status === 'changed').length;
    return { processed: changed, skipped: results.length - changed, failed: 0, results };
  },
});
