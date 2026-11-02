import { z } from 'zod';
import type { Locator, Page } from 'playwright';
import { PhantomForgeError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { resolveSelector, type ResilientSelector } from '../../base/selector.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';
import {
  aboutBox,
  editAboutLink,
  editIntroLink,
  headlineBox,
  industryBox,
  saveButton,
} from '../selectors/profile.js';

const inputSchema = z
  .object({
    headline: z.string().trim().min(1).max(220).optional().describe('New headline, exactly as approved'),
    industry: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Industry, exactly as LinkedIn's list names it (not shown on the profile, but the intro form needs it)"),
    about: z.string().trim().min(1).max(2600).optional().describe('New About text; a blank line starts a new paragraph'),
    preview: z
      .boolean()
      .default(false)
      .describe('Fill the forms and take pictures, but never press Save'),
  })
  .refine((i) => i.headline !== undefined || i.industry !== undefined || i.about !== undefined, {
    message: 'Give a headline, an industry, an About text, or several',
  });

/** Compare what a box shows with what was asked for, ignoring spacing. */
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Types like a person: one key at a time, uneven speed, a pause between paragraphs. */
async function typeLikeAPerson(page: Page, text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());
  for (const [i, para] of paragraphs.entries()) {
    if (i > 0) {
      // Seen: one Enter in the About box is a plain line break; a blank
      // line between paragraphs needs a second one.
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150 + Math.random() * 250);
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
 * One box in a form. 'text' boxes take free text (rich-text boxes like
 * Headline and About); 'pick' boxes only accept an entry from LinkedIn's own
 * list, chosen from the suggestions that appear while typing (Industry).
 */
interface Field {
  label: string;
  box: ResilientSelector;
  kind: 'text' | 'pick';
  value: string;
}

/** What a box currently holds: an input's value, or a rich-text box's text. */
async function readBox(box: Locator): Promise<string> {
  const isInput = await box.evaluate((el) => ['INPUT', 'TEXTAREA'].includes(el.tagName));
  return (isInput ? await box.inputValue() : await box.innerText()).trim();
}

async function fill(ctx: AgentContext, dialog: Locator, field: Field) {
  const { page } = ctx;
  const box = await resolveSelector(dialog, field.box, { timeoutMs: 10_000 });
  await box.scrollIntoViewIfNeeded();
  await box.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500 + Math.random() * 500);
  await typeLikeAPerson(page, field.value);
  await page.waitForTimeout(1200);

  if (field.kind === 'pick') {
    // The suggestion list sits outside the dialog, so look on the whole page.
    const option = page.getByRole('option', { name: new RegExp(`^\\s*${escapeRegExp(field.value)}\\s*$`, 'i') }).first();
    const found = await option
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) {
      await ctx.captureArtifact('screenshot', `${field.label}: suggestions`);
      await ctx.captureArtifact('aria_snapshot', `${field.label}: suggestions`);
      throw new PhantomForgeError(
        'INVALID_INPUT',
        `"${field.value}" is not in LinkedIn's ${field.label} list - nothing was saved. See the suggestions it showed.`,
      );
    }
    await option.hover();
    await page.waitForTimeout(300 + Math.random() * 500);
    await option.click();
    await page.waitForTimeout(800);
  }

  const now = await readBox(box);
  if (!same(now, field.value)) {
    await ctx.captureArtifact('screenshot', `${field.label}: does not match`);
    throw new PhantomForgeError('UNKNOWN', `The ${field.label} box does not show the approved text, so nothing was saved`, {
      context: { shown: now },
    });
  }
}

/**
 * Opens one of the profile forms, fills the given boxes, and saves.
 * Nothing is saved unless every box shows exactly the approved text first;
 * if anything looks wrong the run stops with the form unsaved.
 */
async function editForm(
  ctx: AgentContext,
  form: { title: RegExp; link: ResilientSelector; label: string },
  fields: Field[],
  preview: boolean,
): Promise<'changed' | 'already set' | 'previewed'> {
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

  const toChange: Field[] = [];
  for (const field of fields) {
    const box = await resolveSelector(dialog, field.box, { timeoutMs: 10_000 });
    const before = await readBox(box);
    ctx.log('info', `${field.label} before: "${before}"`);
    if (same(before, field.value)) ctx.log('info', `${field.label} already says this - nothing to change`);
    else toChange.push(field);
  }
  if (toChange.length === 0) return 'already set';

  for (const field of toChange) {
    await fill(ctx, dialog, field);
    await page.waitForTimeout(600 + Math.random() * 900);
  }
  await ctx.captureArtifact('screenshot', `${form.label}: filled, before saving`);

  if (preview) {
    // Leave without saving: the run ends and the unsaved form goes with it.
    await ctx.captureArtifact('aria_snapshot', `${form.label}: filled, before saving`);
    ctx.log('info', `Preview: ${form.label} filled but NOT saved`);
    return 'previewed';
  }

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
    // Seen: "Industry is a required field" - the whole form must be valid, not just our box.
    const reasons = (await dialog.innerText().catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /required field|is required|can'?t be (empty|blank)|too long|try again|went wrong/i.test(l));
    throw new PhantomForgeError(
      'UNKNOWN',
      `LinkedIn did not save the ${form.label}${reasons.length ? `: ${reasons.join('; ')}` : ' - see the screenshot'}. Nothing was changed.`,
    );
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
 * Changes the owner's own headline, industry and/or About. Only what is
 * passed in is touched, and only text the owner approved should ever be
 * passed in - this agent never writes anything of its own.
 */
export const updateProfileAgent = defineAgent({
  key: 'linkedin.update-profile',
  platform: 'linkedin',
  name: 'Update Profile',
  description:
    'Sets the headline, industry and/or About section to text the owner approved. Changes nothing else. Preview fills the forms without saving.',
  version: 1,
  inputSchema,
  quotaCost: {},
  readOnly: false,

  async execute(ctx, input) {
    const results: { part: string; status: string }[] = [];
    await goToOwnProfile(ctx.page);
    await ctx.captureArtifact('screenshot', 'profile before');

    // Headline and industry live in the same intro form and are saved together.
    const intro: Field[] = [];
    if (input.headline !== undefined) intro.push({ label: 'headline', box: headlineBox, kind: 'text', value: input.headline });
    if (input.industry !== undefined) intro.push({ label: 'industry', box: industryBox, kind: 'pick', value: input.industry });
    if (intro.length && !ctx.signal.aborted) {
      const status = await editForm(ctx, { title: /^edit intro$/i, link: editIntroLink, label: 'intro' }, intro, input.preview);
      if (status === 'changed' && input.headline !== undefined) await confirmOnProfile(ctx, 'headline', input.headline);
      for (const f of intro) results.push({ part: f.label, status });
      await ctx.pace();
    }

    if (input.about !== undefined && !ctx.signal.aborted) {
      const status = await editForm(
        ctx,
        { title: /^edit about$/i, link: editAboutLink, label: 'About' },
        [{ label: 'About', box: aboutBox, kind: 'text', value: input.about }],
        input.preview,
      );
      if (status === 'changed') await confirmOnProfile(ctx, 'About', input.about);
      results.push({ part: 'About', status });
    }

    const changed = results.filter((r) => r.status === 'changed').length;
    return { processed: changed, skipped: results.length - changed, failed: 0, results };
  },
});
