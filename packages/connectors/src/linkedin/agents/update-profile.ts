import { z } from 'zod';
import type { Locator, Page } from 'playwright';
import { PhantomForgeError } from '@pf/core';
import { defineAgent } from '../../base/agent.js';
import type { AgentContext } from '../../base/context.js';
import { resolveSelector, type ResilientSelector } from '../../base/selector.js';
import { assertSafeToContinue, LINKEDIN_ORIGIN } from '../session.js';
import {
  aboutBox,
  addExperienceButton,
  addRoleMenuItem,
  currentlyWorkHereBox,
  deleteButton,
  editAboutLink,
  editIntroLink,
  employmentTypeSelect,
  headlineBox,
  industryBox,
  jobTitleBox,
  locationTypeSelect,
  notifyNetworkSwitch,
  organisationBox,
  saveButton,
  startMonthSelect,
  startYearSelect,
} from '../selectors/profile.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const jobSchema = z.object({
  title: z.string().trim().min(1).max(100),
  organization: z.string().trim().min(1).max(100),
  employmentType: z
    .enum(['Full-time', 'Part-time', 'Self-employed', 'Freelance', 'Contract', 'Internship', 'Apprenticeship'])
    .optional(),
  locationType: z.enum(['On-site', 'Hybrid', 'Remote']).optional(),
  startMonth: z.enum(MONTHS).optional(),
  startYear: z.number().int().min(1950).max(2100),
});

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
    addJob: jobSchema.optional().describe('A job to add as current (the owner must have approved every detail)'),
    removeJob: z
      .object({ title: z.string().trim().min(1), organization: z.string().trim().min(1) })
      .optional()
      .describe('A job to delete, matched by its exact title and organisation; removed only after addJob saved'),
    preview: z
      .boolean()
      .default(false)
      .describe('Fill the forms and take pictures, but never press Save'),
  })
  .refine((i) => [i.headline, i.industry, i.about, i.addJob, i.removeJob].some((v) => v !== undefined), {
    message: 'Give at least one thing to change',
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

async function openExperience(page: Page) {
  await page.goto(`${LINKEDIN_ORIGIN}/in/me/details/experience/`, { waitUntil: 'domcontentloaded' });
  await assertSafeToContinue(page);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

async function clickLikeAPerson(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await page.waitForTimeout(400 + Math.random() * 700);
  await target.click();
}

async function isOn(sw: Locator) {
  return (await sw.getAttribute('aria-checked')) === 'true' || (await sw.isChecked().catch(() => false));
}

/** "Notify network" is On by default; adding or removing a job must not announce anything. */
async function turnOffNotify(ctx: AgentContext, dialog: Locator) {
  const sw = await resolveSelector(dialog, notifyNetworkSwitch, { timeoutMs: 5_000 }).catch(() => null);
  if (!sw) {
    ctx.log('info', 'No "Notify network" switch on this form');
    return;
  }
  if (await isOn(sw)) {
    // Seen: the switch is a hidden checkbox; people click the drawn toggle
    // (its <label for=...>, or the element wrapping it).
    let toggle = sw;
    if (!(await sw.isVisible())) {
      const id = await sw.getAttribute('id');
      const label = id ? dialog.locator(`label[for="${id}"]`).first() : null;
      toggle = label && (await label.isVisible().catch(() => false)) ? label : sw.locator('xpath=..');
    }
    await clickLikeAPerson(ctx.page, toggle);
    await ctx.page.waitForTimeout(600);
  }
  if (await isOn(sw)) throw new PhantomForgeError('UNKNOWN', 'Could not turn off "Notify network", so nothing was saved');
  ctx.log('info', '"Notify network" is off');
}

async function pickFromSelect(dialog: Locator, which: ResilientSelector, label: string) {
  const select = await resolveSelector(dialog, which, { timeoutMs: 5_000 });
  await select.selectOption({ label });
  const chosen = await select.evaluate((el) => {
    const options = (el as unknown as { selectedOptions: ArrayLike<{ textContent: string | null }> }).selectedOptions;
    return options[0]?.textContent?.trim() ?? '';
  });
  if (chosen !== label) throw new PhantomForgeError('UNKNOWN', `Could not choose "${label}", so nothing was saved`);
}

/**
 * A free-text box that may show suggestions (job title, organisation): take
 * an exact suggestion if one appears, otherwise keep the typed text.
 */
async function typeAndSettle(ctx: AgentContext, dialog: Locator, which: ResilientSelector, label: string, value: string) {
  const { page } = ctx;
  const box = await resolveSelector(dialog, which, { timeoutMs: 5_000 });
  await clickLikeAPerson(page, box);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await typeLikeAPerson(page, value);
  await page.waitForTimeout(1500);
  const exact = page.getByRole('option', { name: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, 'i') }).first();
  if (await exact.isVisible().catch(() => false)) {
    await clickLikeAPerson(page, exact);
    ctx.log('info', `${label}: picked "${value}" from LinkedIn's suggestions`);
  } else {
    // Close any suggestion list by clicking the form's heading - never Escape, which can close the form.
    await dialog.getByRole('heading').first().click();
  }
  await page.waitForTimeout(700);
  const now = await readBox(box);
  if (!same(now, value)) {
    await ctx.captureArtifact('screenshot', `${label}: does not match`);
    throw new PhantomForgeError('UNKNOWN', `The ${label} box shows "${now}", not "${value}", so nothing was saved`);
  }
}

async function saveAndWait(ctx: AgentContext, dialog: Locator, label: string) {
  await clickLikeAPerson(ctx.page, await resolveSelector(dialog, saveButton));
  const closed = await dialog
    .waitFor({ state: 'detached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await assertSafeToContinue(ctx.page);
  if (!closed) {
    await ctx.captureArtifact('screenshot', `${label}: form stayed open after Save`);
    await ctx.captureArtifact('aria_snapshot', `${label}: form stayed open after Save`);
    const reasons = (await dialog.innerText().catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /required|can'?t be (empty|blank)|too long|try again|went wrong|verif/i.test(l));
    throw new PhantomForgeError(
      'UNKNOWN',
      `LinkedIn did not save the ${label}${reasons.length ? `: ${reasons.join('; ')}` : ' - see the screenshot'}. Nothing was changed.`,
    );
  }
}

/** Seen: each job has a link "Edit <title> at <organisation>" on the experience list. */
function editJobLink(page: Page, job: { title: string; organization: string }) {
  const name = new RegExp(`^edit ${escapeRegExp(job.title)} at ${escapeRegExp(job.organization)}$`, 'i');
  return page.locator('main').getByRole('link', { name }).first();
}

async function addJob(ctx: AgentContext, job: z.infer<typeof jobSchema>, preview: boolean): Promise<string> {
  const { page } = ctx;
  await openExperience(page);
  if (await editJobLink(page, job).isVisible().catch(() => false)) {
    ctx.log('info', `"${job.title}" at ${job.organization} is already on the profile`);
    return 'already set';
  }
  // Seen: the + button opens a menu with "Add role" / "Add career break".
  await clickLikeAPerson(page, await resolveSelector(page, addExperienceButton, { timeoutMs: 10_000 }));
  await page.waitForTimeout(800);
  await clickLikeAPerson(page, await resolveSelector(page, addRoleMenuItem, { timeoutMs: 5_000 }));

  const dialog = page.getByRole('dialog', { name: /add a role|add experience|add position/i }).first();
  await dialog.waitFor({ timeout: 15_000 }).catch(async () => {
    await ctx.captureArtifact('screenshot', 'add job: form did not open');
    throw new PhantomForgeError('SELECTOR_NOT_FOUND', 'The add-job form did not open');
  });
  await assertSafeToContinue(page);
  await page.waitForTimeout(800 + Math.random() * 600);

  await turnOffNotify(ctx, dialog);
  await typeAndSettle(ctx, dialog, jobTitleBox, 'job title', job.title);
  await typeAndSettle(ctx, dialog, organisationBox, 'organisation', job.organization);
  if (job.employmentType) await pickFromSelect(dialog, employmentTypeSelect, job.employmentType);
  if (job.locationType) await pickFromSelect(dialog, locationTypeSelect, job.locationType);
  const current = await resolveSelector(dialog, currentlyWorkHereBox, { timeoutMs: 5_000 });
  if (!(await current.isChecked())) await clickLikeAPerson(page, current);
  if (job.startMonth) await pickFromSelect(dialog, startMonthSelect, job.startMonth);
  await pickFromSelect(dialog, startYearSelect, String(job.startYear));
  // The switch could flip back as the form changes - check it again last.
  await turnOffNotify(ctx, dialog);

  await ctx.captureArtifact('screenshot', 'add job: filled, before saving');
  if (preview) {
    await ctx.captureArtifact('aria_snapshot', 'add job: filled, before saving');
    ctx.log('info', 'Preview: add-job form filled but NOT saved');
    return 'previewed';
  }
  await saveAndWait(ctx, dialog, 'new job');

  await openExperience(page);
  const shown = await editJobLink(page, job)
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await ctx.captureArtifact('screenshot', 'experience after adding the job');
  if (!shown) throw new PhantomForgeError('UNKNOWN', 'Saved, but the new job is not on the experience list - check it');
  ctx.log('info', `Added "${job.title}" at ${job.organization}`);
  return 'changed';
}

async function removeJob(ctx: AgentContext, job: { title: string; organization: string }, preview: boolean): Promise<string> {
  const { page } = ctx;
  await openExperience(page);
  const link = editJobLink(page, job);
  if (!(await link.isVisible().catch(() => false))) {
    ctx.log('info', `"${job.title}" at ${job.organization} is not on the profile`);
    return 'already set';
  }
  await clickLikeAPerson(page, link);
  const dialog = page.getByRole('dialog', { name: /edit (role|experience|position)/i }).first();
  await dialog.waitFor({ timeout: 15_000 }).catch(async () => {
    await ctx.captureArtifact('screenshot', 'remove job: form did not open');
    throw new PhantomForgeError('SELECTOR_NOT_FOUND', 'The edit-job form did not open');
  });
  await assertSafeToContinue(page);
  await page.waitForTimeout(800 + Math.random() * 600);

  // Only the matching job may be deleted: the form must show its title.
  const title = await readBox(await resolveSelector(dialog, jobTitleBox, { timeoutMs: 5_000 }));
  if (!same(title, job.title)) {
    throw new PhantomForgeError('UNKNOWN', `The form opened for "${title}", not "${job.title}" - nothing was deleted`);
  }
  await turnOffNotify(ctx, dialog);
  await ctx.captureArtifact('screenshot', 'remove job: form open, before Delete');
  if (preview) {
    ctx.log('info', 'Preview: would press Delete here - NOT pressed');
    return 'previewed';
  }

  await clickLikeAPerson(page, await resolveSelector(dialog, deleteButton));
  // LinkedIn asks "are you sure" in a second dialog.
  await page.waitForTimeout(1200);
  await ctx.captureArtifact('aria_snapshot', 'remove job: delete confirmation');
  const confirm = page
    .locator('[role="alertdialog"], [role="dialog"]')
    .filter({ hasText: /delete/i })
    .last()
    .getByRole('button', { name: /^delete\b/i })
    .last();
  if (await confirm.isVisible().catch(() => false)) await clickLikeAPerson(page, confirm);
  await page.waitForTimeout(2000);
  await assertSafeToContinue(page);

  await openExperience(page);
  const stillThere = await editJobLink(page, job).isVisible().catch(() => false);
  await ctx.captureArtifact('screenshot', 'experience after removing the job');
  if (stillThere) throw new PhantomForgeError('UNKNOWN', `"${job.title}" is still on the profile - see the screenshots`);
  ctx.log('info', `Removed "${job.title}" at ${job.organization}`);
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

    // Add the new job before removing the old one, so a failure never leaves the profile with no job.
    if (input.addJob && !ctx.signal.aborted) {
      results.push({ part: 'add job', status: await addJob(ctx, input.addJob, input.preview) });
      await ctx.pace();
    }
    if (input.removeJob && !ctx.signal.aborted) {
      const added = results.find((r) => r.part === 'add job');
      if (added && !input.preview && added.status !== 'changed' && added.status !== 'already set') {
        throw new PhantomForgeError('UNKNOWN', 'The new job was not added, so the old one was kept');
      }
      results.push({ part: 'remove job', status: await removeJob(ctx, input.removeJob, input.preview) });
    }

    const changed = results.filter((r) => r.status === 'changed').length;
    return { processed: changed, skipped: results.length - changed, failed: 0, results };
  },
});
